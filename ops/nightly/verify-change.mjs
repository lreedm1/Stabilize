import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ALLOWED_FILES = new Set([
  "public/product.css",
  "public/guides.css",
]);

const MAX_CHANGED_LINES = 120;
const MAX_DIFF_LINE_LENGTH = 500;
const ALLOWED_PROPERTIES = {
  font_size: new Set(["font-size"]),
  line_height: new Set(["line-height"]),
  spacing: new Set([
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "padding",
    "padding-top",
    "padding-right",
    "padding-bottom",
    "padding-left",
    "gap",
    "row-gap",
    "column-gap",
  ]),
  color_contrast: new Set([
    "color",
    "background",
    "background-color",
    "border-color",
    "outline-color",
  ]),
  focus_outline: new Set([
    "outline",
    "outline-color",
    "outline-width",
    "outline-style",
    "outline-offset",
    "box-shadow",
  ]),
};
const DANGEROUS_ADDITION_PATTERNS = [
  /@(?:import|font-face|keyframes|supports|layer|property)\b/i,
  /\burl\s*\(/i,
  /\b(?:image-set|cross-fade)\s*\(/i,
  /\b(?:calc|min|max|clamp)\s*\(/i,
  /-?\d+(?:\.\d+)?\s*(?:vh|vw|vmin|vmax)\b/i,
  /\b(?:src|content)\s*:/i,
  /\bdisplay\s*:\s*none\b/i,
  /\bvisibility\s*:\s*hidden\b/i,
  /\bopacity\s*:\s*0(?:\D|$)/i,
  /\bpointer-events\s*:\s*none\b/i,
  /\bposition\s*:\s*(?:fixed|absolute|sticky)\b/i,
  /\b(?:z-index|clip|clip-path|transform|animation|transition|filter|all)\s*:/i,
  /\bfont-size\s*:\s*0\b/i,
  /\b(?:height|width|max-height|max-width)\s*:\s*0(?:\D|$)/i,
  /\boverflow\s*:\s*hidden\b/i,
  /\bcolor\s*:\s*transparent\b/i,
  /!important\b/i,
  /\boutline\s*:\s*(?:none|0)\b/i,
  /\boutline-width\s*:\s*0(?:\D|$)/i,
  /\b(?:github_pat_|ghp_|sk-[A-Za-z0-9_-]{12,})/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/i,
];

function git(repo, args, options = {}) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: options.encoding ?? "utf8",
    maxBuffer: options.maxBuffer ?? 4 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function nulList(buffer) {
  return buffer
    .toString("utf8")
    .split("\0")
    .filter(Boolean);
}

export function validateAnalysisPlan(plan) {
  const keys = ["outcome", "theme", "targetFile", "changeKind", "evidenceStrength"].sort();
  if (
    !plan ||
    typeof plan !== "object" ||
    Array.isArray(plan) ||
    JSON.stringify(Object.keys(plan).sort()) !== JSON.stringify(keys)
  ) {
    throw new Error("Analysis plan does not match the required shape");
  }
  const values = {
    outcome: ["no_change", "proposed_change", "private_review"],
    theme: ["none", "readability", "spacing", "contrast", "focus_visibility"],
    targetFile: ["none", ...ALLOWED_FILES],
    changeKind: ["none", "font_size", "line_height", "spacing", "color_contrast", "focus_outline"],
    evidenceStrength: ["none", "weak", "conflicting", "single_clear", "repeated"],
  };
  for (const [key, allowed] of Object.entries(values)) {
    if (!allowed.includes(plan[key])) throw new Error(`Invalid analysis field: ${key}`);
  }
  if (plan.outcome === "proposed_change") {
    if (
      plan.theme === "none" ||
      plan.targetFile === "none" ||
      plan.changeKind === "none" ||
      !["single_clear", "repeated"].includes(plan.evidenceStrength)
    ) {
      throw new Error("Proposed change lacks a bounded, sufficiently supported plan");
    }
  } else if (
    plan.theme !== "none" ||
    plan.targetFile !== "none" ||
    plan.changeKind !== "none" ||
    ["single_clear", "repeated"].includes(plan.evidenceStrength)
  ) {
    throw new Error("Non-change plan contains editing instructions");
  }
  return plan;
}

export function validateEditResult(result, plan, hasChanges) {
  const keys = ["outcome", "targetFile", "changeKind"].sort();
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(keys)
  ) {
    throw new Error("Edit result does not match the required shape");
  }
  if (!["implemented", "unable"].includes(result.outcome)) {
    throw new Error("Edit result has an invalid outcome");
  }
  if (result.outcome === "implemented") {
    if (
      !hasChanges ||
      result.targetFile !== plan.targetFile ||
      result.changeKind !== plan.changeKind
    ) {
      throw new Error("Implemented result does not match the approved plan and diff");
    }
  } else if (hasChanges || result.targetFile !== "none" || result.changeKind !== "none") {
    throw new Error("Unable result must leave no diff and no target");
  }
  return result;
}

function addedLines(diffText) {
  return diffText
    .split("\n")
    .filter(
      (line) =>
        line.startsWith("+") &&
        !line.startsWith("+++") &&
        !line.startsWith("+@@"),
    )
    .map((line) => line.slice(1));
}

function changedContentLines(diffText) {
  return diffText
    .split("\n")
    .filter(
      (line) =>
        (line.startsWith("+") || line.startsWith("-")) &&
        !line.startsWith("+++") &&
        !line.startsWith("---"),
    )
    .map((line) => ({ kind: line[0], value: line.slice(1) }));
}

export function validateCssAdditions(diffText) {
  for (const line of addedLines(diffText)) {
    for (const pattern of DANGEROUS_ADDITION_PATTERNS) {
      if (pattern.test(line)) {
        throw new Error(`Disallowed CSS addition matched ${pattern}`);
      }
    }
  }
}

function boundedLength(token, { minimum = 0, maximumPx = 64, maximumRelative = 4 } = {}) {
  if (token === "0") return minimum === 0;
  const match = token.match(/^(?:\d+(?:\.\d+)?|\.\d+)(px|rem|em|%)$/i);
  if (!match) return false;
  const number = Number(token.slice(0, -match[1].length));
  const unit = match[1].toLowerCase();
  const maximum = unit === "px" ? maximumPx : unit === "%" ? 200 : maximumRelative;
  const normalizedMinimum =
    unit === "px"
      ? minimum
      : minimum === 0
        ? 0
        : unit === "%"
          ? (minimum / 16) * 100
          : minimum / 16;
  return Number.isFinite(number) && number >= normalizedMinimum && number <= maximum;
}

function boundedLengthList(value, maximumItems = 4) {
  const parts = value.split(/\s+/);
  return (
    parts.length >= 1 &&
    parts.length <= maximumItems &&
    parts.every((part) => boundedLength(part))
  );
}

function boundedColor(value) {
  if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/i.test(value)) return true;
  if (/^(?:white|black|currentcolor)$/i.test(value)) return true;
  if (/^var\(--[a-z0-9-]+\)$/i.test(value)) return true;
  const functional = value.match(/^rgba?\(([^)]+)\)$/i);
  if (!functional) return false;
  const parts = functional[1].split(",").map((part) => part.trim());
  const expectsAlpha = /^rgba/i.test(value);
  if (parts.length !== (expectsAlpha ? 4 : 3)) return false;
  if (
    !parts.slice(0, 3).every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255)
  ) {
    return false;
  }
  if (!expectsAlpha) return true;
  if (!/^(?:0(?:\.\d+)?|1(?:\.0+)?)$/.test(parts[3])) return false;
  const alpha = Number(parts[3]);
  return alpha >= 0.2 && alpha <= 1;
}

function boundedFocusValue(property, value) {
  if (/\b(?:none|hidden)\b/i.test(value)) return false;
  if (property === "outline-color") return boundedColor(value);
  if (property === "outline-style") {
    return /^(?:solid|dashed|dotted|double)$/i.test(value);
  }
  if (property === "outline-width") {
    return boundedLength(value, { minimum: 1, maximumPx: 16, maximumRelative: 1 });
  }
  if (property === "outline-offset") {
    return boundedLength(value, { maximumPx: 16, maximumRelative: 1 });
  }
  if (property === "outline") {
    const match = value.match(/^(\S+)\s+(solid|dashed|dotted|double)\s+(.+)$/i);
    return Boolean(
      match &&
        boundedLength(match[1], { minimum: 1, maximumPx: 16, maximumRelative: 1 }) &&
        boundedColor(match[3]),
    );
  }
  if (property === "box-shadow") {
    const match = value.match(/^(.+?)\s+(#[0-9a-f]{3,6}|(?:rgba?|var)\(.+\)|white|black)$/i);
    if (!match || !boundedColor(match[2])) return false;
    const lengths = match[1].split(/\s+/);
    return (
      lengths.length === 4 &&
      lengths.every((part) =>
        boundedLength(part, { maximumPx: 32, maximumRelative: 2 }),
      )
    );
  }
  return false;
}

function validateAddedValue(changeKind, property, value) {
  if (changeKind === "spacing") {
    if (!boundedLengthList(value)) throw new Error("Spacing must use bounded length values");
    return;
  }
  if (changeKind === "line_height") {
    if (value.toLowerCase() === "normal") return;
    if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value)) {
      throw new Error("Line height must use one bounded unitless value");
    }
    const number = Number(value);
    if (number < 1 || number > 2.2) throw new Error("Line height is outside the bounded range");
    return;
  }
  if (changeKind === "font_size") {
    if (!boundedLength(value, { minimum: 10, maximumPx: 64, maximumRelative: 4 })) {
      throw new Error("Font size must use one bounded numeric value");
    }
    return;
  }
  if (changeKind === "color_contrast") {
    if (!boundedColor(value)) throw new Error("Color must use one bounded local color value");
    return;
  }
  if (changeKind === "focus_outline") {
    if (!boundedFocusValue(property, value)) {
      throw new Error("Focus styling must use one visible bounded value");
    }
    return;
  }
  throw new Error("Unknown CSS change kind");
}

export function validateCssChangeShape(diffText, changeKind) {
  const allowed = ALLOWED_PROPERTIES[changeKind];
  if (!allowed) throw new Error("Unknown CSS change kind");
  let addedDeclarations = 0;
  for (const { kind, value } of changedContentLines(diffText)) {
    if (value.length > MAX_DIFF_LINE_LENGTH) {
      throw new Error("CSS diff contains an oversized line");
    }
    if (!value.trim()) continue;
    if (/[\\{}]/.test(value) || /\/\*|\*\//.test(value)) {
      throw new Error("CSS changes cannot contain escapes, braces, or comments");
    }
    const declaration = value.match(/^\s*([a-z-]+)\s*:\s*([^;{}]+)\s*;\s*$/i);
    if (!declaration) {
      throw new Error(
        "CSS changes must modify exactly one declaration inside an existing rule",
      );
    }
    const property = declaration[1].toLowerCase();
    if (!allowed.has(property)) {
      throw new Error(`CSS property is outside the approved change kind: ${property}`);
    }
    if (kind === "+") {
      addedDeclarations += 1;
      if (/(?:^|[^\w])-\d/.test(value)) {
        throw new Error("Negative CSS values are not allowed");
      }
      validateAddedValue(changeKind, property, declaration[2].trim());
    }
  }
  if (addedDeclarations === 0) {
    throw new Error("A CSS proposal must add at least one bounded declaration value");
  }
}

export function verifyChange({
  repo,
  planPath,
  resultPath,
  expectedHead,
  strictUntracked = false,
}) {
  const actualHead = git(repo, ["rev-parse", "HEAD"]).trim();
  if (actualHead !== expectedHead) throw new Error("Repository HEAD changed unexpectedly");

  const ordinaryUntracked = nulList(
    git(repo, ["ls-files", "--others", "--exclude-standard", "-z"], {
      encoding: "buffer",
    }),
  );
  const ignoredUntracked = strictUntracked
    ? nulList(
        git(repo, ["ls-files", "--others", "--ignored", "--exclude-standard", "-z"], {
          encoding: "buffer",
        }),
      )
    : [];
  const unexpected = [...ordinaryUntracked, ...ignoredUntracked];
  if (unexpected.length) {
    throw new Error(`Untracked or ignored files are not allowed: ${unexpected.slice(0, 5).join(", ")}`);
  }

  const summary = git(repo, ["diff", "HEAD", "--summary", "--"]).trim();
  if (summary) throw new Error("Mode, rename, or file-type changes are not allowed");

  const changedFiles = nulList(
    git(repo, ["diff", "HEAD", "--name-only", "-z", "--"], {
      encoding: "buffer",
    }),
  );
  if (changedFiles.length > 1) throw new Error("Only one CSS file may change");

  const plan = validateAnalysisPlan(JSON.parse(readFileSync(planPath, "utf8")));
  const statuses = git(repo, ["diff", "HEAD", "--name-status", "--no-renames", "--"])
    .trim()
    .split("\n")
    .filter(Boolean);
  for (const line of statuses) {
    const [status, filePath] = line.split("\t");
    if (status !== "M" || !ALLOWED_FILES.has(filePath) || filePath !== plan.targetFile) {
      throw new Error(`Out-of-scope change: ${line}`);
    }
    const stat = lstatSync(path.join(repo, filePath));
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`Changed path is not a regular file: ${filePath}`);
    }
  }

  let changedLines = 0;
  for (const line of git(repo, ["diff", "HEAD", "--numstat", "--"])
    .trim()
    .split("\n")
    .filter(Boolean)) {
    const [added, deleted] = line.split("\t");
    if (added === "-" || deleted === "-") throw new Error("Binary changes are not allowed");
    changedLines += Number(added) + Number(deleted);
  }
  if (changedLines > MAX_CHANGED_LINES) {
    throw new Error(`Diff exceeds ${MAX_CHANGED_LINES} changed lines`);
  }

  const diffText = git(repo, ["diff", "--no-ext-diff", "--binary", "HEAD", "--"]);
  const result = validateEditResult(
    JSON.parse(readFileSync(resultPath, "utf8")),
    plan,
    changedFiles.length > 0,
  );
  if (result.outcome === "implemented") {
    validateCssAdditions(diffText);
    validateCssChangeShape(diffText, plan.changeKind);
  }
  const diffSha256 = createHash("sha256").update(diffText).digest("hex");
  return { changedFiles, changedLines, diffText, diffSha256, plan, result };
}

function parseArgs(argv) {
  const args = { strictUntracked: false };
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === "--strict-untracked") {
      args.strictUntracked = true;
      continue;
    }
    if (!["--repo", "--plan", "--result", "--expected-head"].includes(name)) {
      throw new Error(`Unknown argument: ${name}`);
    }
    args[name.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!args.repo || !args.plan || !args.result || !args["expected-head"]) {
    throw new Error(
      "Usage: verify-change.mjs --repo PATH --plan FILE --result FILE --expected-head SHA [--strict-untracked]",
    );
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const verified = verifyChange({
    repo: args.repo,
    planPath: args.plan,
    resultPath: args.result,
    expectedHead: args["expected-head"],
    strictUntracked: args.strictUntracked,
  });
  process.stdout.write(
    `${JSON.stringify({
      files: verified.changedFiles,
      lines: verified.changedLines,
      diffSha256: verified.diffSha256,
    })}\n`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
