import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import {
  sanitizePrivateReview,
  validateCheckpoint,
  validateStoredPrivateReview,
} from "./cloud-state.mjs";
import { validatePendingReview } from "./pending-review.mjs";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;
const DIGEST_PATTERN = /^[0-9a-f]{64}$/i;
const RUN_ID_PATTERN = /^[0-9]{8}T[0-9]{6}-[0-9]+$/;
const ALLOWED_FILES = new Set(["public/product.css", "public/guides.css"]);
const CATEGORY_KEYS = ["bug", "experience", "idea", "other"];
const STATE_FILES = [
  "feedback-checkpoint",
  "pending-review.json",
  "pending-private-review.json",
];
const PROPOSAL_FILES = ["change.patch", "plan.json", "edit-result.json"];
const ROOT_FILE_LIMITS = new Map([
  ["manifest.json", 16 * 1024],
  ["change.patch", 256 * 1024],
  ["plan.json", 8 * 1024],
  ["edit-result.json", 8 * 1024],
]);
const STATE_FILE_LIMITS = new Map([
  ["feedback-checkpoint", 128],
  ["pending-review.json", 8 * 1024],
  ["pending-private-review.json", 1024],
]);
const LOCAL_PRIVATE_REVIEW_LIMIT = 64 * 1024;
const TRANSITION_KINDS = new Set([
  "noop",
  "proposal",
  "advance_checkpoint",
  "open_private_review",
  "complete_publication",
  "complete_review",
  "abandon_publication",
]);
const PLAN_KEYS = ["outcome", "theme", "targetFile", "changeKind", "evidenceStrength"].sort();

function validateCloudPlan(plan) {
  if (
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(PLAN_KEYS)
  ) {
    throw new Error("Cloud proposal plan does not match the required shape");
  }
  const allowed = {
    outcome: ["no_change", "proposed_change", "private_review"],
    theme: ["none", "readability", "spacing", "contrast", "focus_visibility"],
    targetFile: ["none", ...ALLOWED_FILES],
    changeKind: [
      "none",
      "font_size",
      "line_height",
      "spacing",
      "color_contrast",
      "focus_outline",
    ],
    evidenceStrength: ["none", "weak", "conflicting", "single_clear", "repeated"],
  };
  for (const [key, values] of Object.entries(allowed)) {
    if (!values.includes(plan[key])) throw new Error(`Invalid cloud proposal plan field: ${key}`);
  }
  if (
    plan.outcome !== "proposed_change" ||
    plan.theme === "none" ||
    plan.targetFile === "none" ||
    plan.changeKind === "none" ||
    !["single_clear", "repeated"].includes(plan.evidenceStrength)
  ) {
    throw new Error("Cloud proposal plan is not a bounded change");
  }
  return plan;
}

function statOrNull(filePath) {
  try {
    return lstatSync(filePath);
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function assertDirectory(directory, label, { create = false, exclusive = false } = {}) {
  if (create) mkdirSync(directory, { recursive: !exclusive, mode: 0o700 });
  const stats = statOrNull(directory);
  if (!stats || !stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular directory`);
  }
  chmodSync(directory, 0o700);
}

function regularFileExists(filePath, label) {
  const stats = statOrNull(filePath);
  if (!stats) return false;
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is not a regular file`);
  }
  return true;
}

function readText(filePath, label, maximumBytes) {
  if (!regularFileExists(filePath, label)) throw new Error(`${label} is missing`);
  if (!Number.isSafeInteger(maximumBytes) || lstatSync(filePath).size > maximumBytes) {
    throw new Error(`${label} exceeds its bounded size`);
  }
  return readFileSync(filePath, "utf8");
}

function readJson(filePath, label, maximumBytes) {
  return JSON.parse(readText(filePath, label, maximumBytes));
}

function writeSecure(filePath, value) {
  const existing = statOrNull(filePath);
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`Refusing to replace a non-regular bundle file: ${filePath}`);
  }
  const temporaryPath = `${filePath}.tmp-${process.pid}-${randomUUID()}`;
  let descriptor = null;
  try {
    descriptor = openSync(
      temporaryPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW || 0),
      0o600,
    );
    writeFileSync(descriptor, value, { encoding: "utf8" });
    closeSync(descriptor);
    descriptor = null;
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (descriptor !== null) closeSync(descriptor);
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function writeJson(filePath, value) {
  writeSecure(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function validCategories(value) {
  return (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    JSON.stringify(Object.keys(value).sort()) === JSON.stringify(CATEGORY_KEYS) &&
    Object.values(value).every((count) => Number.isSafeInteger(count) && count >= 0)
  );
}

function categoryTotal(value) {
  return Object.values(value).reduce((total, count) => total + count, 0);
}

function validateProposal(value) {
  const expectedKeys = [
    "categoryCounts",
    "changedFile",
    "diffSha256",
    "feedbackCount",
    "feedbackHead",
    "mainHead",
    "runId",
  ].sort();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    !SHA_PATTERN.test(value.mainHead) ||
    !SHA_PATTERN.test(value.feedbackHead) ||
    !DIGEST_PATTERN.test(value.diffSha256) ||
    !RUN_ID_PATTERN.test(value.runId) ||
    !ALLOWED_FILES.has(value.changedFile) ||
    !Number.isSafeInteger(value.feedbackCount) ||
    value.feedbackCount < 1 ||
    !validCategories(value.categoryCounts) ||
    categoryTotal(value.categoryCounts) !== value.feedbackCount
  ) {
    throw new Error("Cloud proposal manifest is invalid");
  }
  return {
    ...value,
    mainHead: value.mainHead.toLowerCase(),
    feedbackHead: value.feedbackHead.toLowerCase(),
    diffSha256: value.diffSha256.toLowerCase(),
  };
}

export function validateBundleManifest(value) {
  const expectedKeys = [
    "createdAt",
    "kind",
    "proposal",
    "schemaVersion",
    "stateHead",
    "transition",
  ].sort();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(expectedKeys) ||
    value.schemaVersion !== 1 ||
    !["state", "proposal"].includes(value.kind) ||
    !SHA_PATTERN.test(value.stateHead) ||
    !Number.isFinite(Date.parse(value.createdAt))
  ) {
    throw new Error("Cloud review bundle manifest is invalid");
  }
  if (value.kind === "state" && value.proposal !== null) {
    throw new Error("State-only bundle cannot contain a proposal");
  }
  if (value.kind === "proposal") value.proposal = validateProposal(value.proposal);
  const transition = validateStateTransition(value.transition);
  if ((value.kind === "proposal") !== (transition.kind === "proposal")) {
    throw new Error("Cloud bundle kind does not match its state transition");
  }
  return { ...value, stateHead: value.stateHead.toLowerCase(), transition };
}

export function validateStateTransition(value) {
  const keys = ["fromSha256", "kind", "toSha256"].sort();
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(keys) ||
    !TRANSITION_KINDS.has(value.kind) ||
    !DIGEST_PATTERN.test(value.fromSha256) ||
    !DIGEST_PATTERN.test(value.toSha256)
  ) {
    throw new Error("Cloud state transition is invalid");
  }
  return {
    kind: value.kind,
    fromSha256: value.fromSha256.toLowerCase(),
    toSha256: value.toSha256.toLowerCase(),
  };
}

function validatedStateFromDirectory(stateDirectory, { allowPrivateDetails = false } = {}) {
  assertDirectory(stateDirectory, "Bundle state directory");
  const state = {};
  const checkpointPath = path.join(stateDirectory, "feedback-checkpoint");
  if (regularFileExists(checkpointPath, "Bundled feedback checkpoint")) {
    state["feedback-checkpoint"] = `${validateCheckpoint(
      readText(checkpointPath, "Bundled feedback checkpoint", 128),
    )}\n`;
  }
  const pendingPath = path.join(stateDirectory, "pending-review.json");
  if (regularFileExists(pendingPath, "Bundled pending review")) {
    state["pending-review.json"] = `${JSON.stringify(
      validatePendingReview(readJson(pendingPath, "Bundled pending review", 8 * 1024)),
      null,
      2,
    )}\n`;
  }
  const privatePath = path.join(stateDirectory, "pending-private-review.json");
  if (regularFileExists(privatePath, "Bundled private-review marker")) {
    const privateReview = readJson(
      privatePath,
      "Bundled private-review marker",
      allowPrivateDetails ? LOCAL_PRIVATE_REVIEW_LIMIT : 1024,
    );
    state["pending-private-review.json"] = `${JSON.stringify(
      allowPrivateDetails
        ? sanitizePrivateReview(privateReview)
        : validateStoredPrivateReview(privateReview),
      null,
      2,
    )}\n`;
  }
  if (state["pending-review.json"] && state["pending-private-review.json"]) {
    throw new Error("Cloud state cannot contain two simultaneous pending markers");
  }
  return state;
}

export function captureCloudState(stateDirectory) {
  return validatedStateFromDirectory(stateDirectory);
}

export function cloudStateDigest(state) {
  if (!state || typeof state !== "object" || Array.isArray(state)) {
    throw new Error("Cloud state snapshot is invalid");
  }
  const entries = Object.entries(state).sort(([left], [right]) => left.localeCompare(right));
  if (
    entries.some(
      ([filename, value]) => !STATE_FILES.includes(filename) || typeof value !== "string",
    )
  ) {
    throw new Error("Cloud state snapshot contains an invalid entry");
  }
  return createHash("sha256").update(JSON.stringify(entries)).digest("hex");
}

function stateValue(state, filename) {
  return Object.prototype.hasOwnProperty.call(state, filename) ? state[filename] : null;
}

function stateValuesEqual(left, right, filenames = STATE_FILES) {
  return filenames.every((filename) => stateValue(left, filename) === stateValue(right, filename));
}

function pendingFromState(state) {
  const value = stateValue(state, "pending-review.json");
  return value === null ? null : validatePendingReview(JSON.parse(value));
}

function privateFromState(state) {
  const value = stateValue(state, "pending-private-review.json");
  return value === null ? null : validateStoredPrivateReview(JSON.parse(value));
}

function checkpointFromState(state) {
  const value = stateValue(state, "feedback-checkpoint");
  return value === null ? null : validateCheckpoint(value);
}

function samePublishingIdentity(before, after) {
  if (!before || !after) return false;
  const expected = {
    ...before,
    phase: "review",
    pullRequest: after.pullRequest,
    url: after.url,
  };
  return JSON.stringify(expected) === JSON.stringify(after);
}

export function inferStateTransition({ initialState, finalState, proposal = false }) {
  const beforeDigest = cloudStateDigest(initialState);
  const afterDigest = cloudStateDigest(finalState);
  const beforePending = pendingFromState(initialState);
  const afterPending = pendingFromState(finalState);
  const beforePrivate = privateFromState(initialState);
  const afterPrivate = privateFromState(finalState);
  const beforeCheckpoint = checkpointFromState(initialState);
  const afterCheckpoint = checkpointFromState(finalState);
  let kind = null;

  if (proposal) {
    if (
      beforeDigest !== afterDigest ||
      beforePending ||
      afterPending ||
      beforePrivate ||
      afterPrivate
    ) {
      throw new Error("A cloud proposal cannot also change durable review state");
    }
    kind = "proposal";
  } else if (beforeDigest === afterDigest) {
    kind = "noop";
  } else if (
    !beforePending &&
    !afterPending &&
    !beforePrivate &&
    afterPrivate &&
    beforeCheckpoint === afterCheckpoint
  ) {
    kind = "open_private_review";
  } else if (
    beforePending?.phase === "publishing" &&
    afterPending?.phase === "review" &&
    !beforePrivate &&
    !afterPrivate &&
    beforeCheckpoint === afterCheckpoint &&
    samePublishingIdentity(beforePending, afterPending)
  ) {
    kind = "complete_publication";
  } else if (
    beforePending?.phase === "review" &&
    !afterPending &&
    !beforePrivate &&
    !afterPrivate &&
    afterCheckpoint === beforePending.feedbackHead
  ) {
    kind = "complete_review";
  } else if (
    beforePending?.phase === "publishing" &&
    !afterPending &&
    !beforePrivate &&
    !afterPrivate &&
    beforeCheckpoint === afterCheckpoint
  ) {
    kind = "abandon_publication";
  } else if (
    !beforePending &&
    !afterPending &&
    !beforePrivate &&
    !afterPrivate &&
    beforeCheckpoint !== afterCheckpoint &&
    afterCheckpoint
  ) {
    kind = "advance_checkpoint";
  }

  if (!kind) throw new Error("Cloud state change is not an allowed atomic transition");
  return { kind, fromSha256: beforeDigest, toSha256: afterDigest };
}

export function assertStateTransition({ transition, initialState, finalState, proposal = false }) {
  const normalized = validateStateTransition(transition);
  const inferred = inferStateTransition({ initialState, finalState, proposal });
  if (JSON.stringify(normalized) !== JSON.stringify(inferred)) {
    throw new Error("Cloud state transition does not match the bounded state snapshots");
  }
  return normalized;
}

function assertTransitionMatchesFinal({ transition, finalState, proposal }) {
  if (transition.toSha256 !== cloudStateDigest(finalState)) {
    throw new Error("Cloud bundle state does not match its transition digest");
  }
  if (proposal) {
    if (
      transition.kind !== "proposal" ||
      transition.fromSha256 !== transition.toSha256 ||
      stateValue(finalState, "pending-review.json") ||
      stateValue(finalState, "pending-private-review.json")
    ) {
      throw new Error("Cloud proposal contains an incompatible durable state transition");
    }
  }
}

function assertExactBundlePaths(bundleDir, manifest) {
  const allowedRoot = new Set(["manifest.json", "state"]);
  if (manifest.kind === "proposal") {
    for (const filename of PROPOSAL_FILES) allowedRoot.add(filename);
  }
  const rootEntries = readdirSync(bundleDir, { withFileTypes: true });
  for (const entry of rootEntries) {
    if (!allowedRoot.has(entry.name)) {
      throw new Error(`Cloud review bundle contains an extra path: ${entry.name}`);
    }
    if (entry.name === "state") {
      if (!entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error("Cloud review bundle state path is not a regular directory");
      }
    } else if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Cloud review bundle path is not a regular file: ${entry.name}`);
    } else if (lstatSync(path.join(bundleDir, entry.name)).size > ROOT_FILE_LIMITS.get(entry.name)) {
      throw new Error(`Cloud review bundle path exceeds its bounded size: ${entry.name}`);
    }
  }
  for (const required of allowedRoot) {
    if (!rootEntries.some((entry) => entry.name === required)) {
      throw new Error(`Cloud review bundle is missing: ${required}`);
    }
  }
  const stateEntries = readdirSync(path.join(bundleDir, "state"), { withFileTypes: true });
  for (const entry of stateEntries) {
    if (!STATE_FILES.includes(entry.name) || !entry.isFile() || entry.isSymbolicLink()) {
      throw new Error(`Cloud review bundle contains an invalid state path: ${entry.name}`);
    }
    if (
      lstatSync(path.join(bundleDir, "state", entry.name)).size >
      STATE_FILE_LIMITS.get(entry.name)
    ) {
      throw new Error(`Cloud review state path exceeds its bounded size: ${entry.name}`);
    }
  }
}

export function createCloudBundle({
  bundleDir,
  stateDir,
  stateHead,
  proposal = null,
  initialState = null,
  transition = null,
}) {
  if (!path.isAbsolute(bundleDir) || !path.isAbsolute(stateDir)) {
    throw new Error("Cloud bundle paths must be absolute");
  }
  if (!SHA_PATTERN.test(stateHead)) throw new Error("Cloud bundle state head is invalid");
  assertDirectory(stateDir, "Private state directory");
  assertDirectory(bundleDir, "Cloud bundle directory", { create: true, exclusive: true });
  const bundleStateDirectory = path.join(bundleDir, "state");
  assertDirectory(bundleStateDirectory, "Cloud bundle state directory", { create: true, exclusive: true });

  const sourceState = validatedStateFromDirectory(stateDir, { allowPrivateDetails: true });
  if (proposal && (sourceState["pending-review.json"] || sourceState["pending-private-review.json"])) {
    throw new Error("Cloud proposal cannot be created while another review is pending");
  }
  for (const [filename, value] of Object.entries(sourceState)) {
    writeSecure(path.join(bundleStateDirectory, filename), value);
  }

  let normalizedProposal = null;
  if (proposal) {
    normalizedProposal = validateProposal(proposal.manifest);
    const plan = validateCloudPlan(
      readJson(proposal.planPath, "Cloud proposal plan", 8 * 1024),
    );
    if (plan.targetFile !== normalizedProposal.changedFile) {
      throw new Error("Cloud proposal plan does not match its manifest");
    }
    writeSecure(
      path.join(bundleDir, "change.patch"),
      readText(proposal.patchPath, "Cloud proposal patch", 256 * 1024),
    );
    writeJson(path.join(bundleDir, "plan.json"), plan);
    writeSecure(
      path.join(bundleDir, "edit-result.json"),
      readText(proposal.editResultPath, "Cloud proposal edit result", 8 * 1024),
    );
  }

  const normalizedTransition = transition
    ? validateStateTransition(transition)
    : inferStateTransition({
        initialState: initialState || sourceState,
        finalState: sourceState,
        proposal: Boolean(normalizedProposal),
      });
  assertTransitionMatchesFinal({
    transition: normalizedTransition,
    finalState: sourceState,
    proposal: Boolean(normalizedProposal),
  });

  writeJson(path.join(bundleDir, "manifest.json"), {
    schemaVersion: 1,
    kind: normalizedProposal ? "proposal" : "state",
    stateHead: stateHead.toLowerCase(),
    createdAt: new Date().toISOString(),
    proposal: normalizedProposal,
    transition: normalizedTransition,
  });
}

export function loadCloudBundle(bundleDir) {
  if (!path.isAbsolute(bundleDir)) throw new Error("Cloud bundle path must be absolute");
  assertDirectory(bundleDir, "Cloud bundle directory");
  const manifest = validateBundleManifest(
    readJson(
      path.join(bundleDir, "manifest.json"),
      "Cloud bundle manifest",
      16 * 1024,
    ),
  );
  assertExactBundlePaths(bundleDir, manifest);
  const state = validatedStateFromDirectory(path.join(bundleDir, "state"));
  assertTransitionMatchesFinal({
    transition: manifest.transition,
    finalState: state,
    proposal: manifest.kind === "proposal",
  });
  const result = { manifest, state, proposal: null };
  if (manifest.kind === "proposal") {
    const plan = validateCloudPlan(
      readJson(path.join(bundleDir, "plan.json"), "Cloud plan", 8 * 1024),
    );
    if (plan.targetFile !== manifest.proposal.changedFile) {
      throw new Error("Bundled plan does not match the proposal manifest");
    }
    result.proposal = {
      patchPath: path.join(bundleDir, "change.patch"),
      planPath: path.join(bundleDir, "plan.json"),
      editResultPath: path.join(bundleDir, "edit-result.json"),
    };
  }
  return result;
}

export function restoreBundledState({ bundleDir, stateDir }) {
  const bundle = loadCloudBundle(bundleDir);
  assertDirectory(stateDir, "Publication state directory", { create: true });
  for (const filename of STATE_FILES) {
    const target = path.join(stateDir, filename);
    if (regularFileExists(target, `Publication state file ${filename}`)) rmSync(target);
  }
  for (const [filename, value] of Object.entries(bundle.state)) {
    writeSecure(path.join(stateDir, filename), value);
  }
  return bundle;
}
