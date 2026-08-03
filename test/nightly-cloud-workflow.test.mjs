import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WORKFLOW_PATH = path.join(REPO_ROOT, ".github", "workflows", "nightly-review.yml");

function jobSection(workflow, name, nextName = null) {
  const start = workflow.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `missing ${name} job`);
  const end = nextName ? workflow.indexOf(`\n  ${nextName}:\n`, start + 1) : workflow.length;
  assert.notEqual(end, -1, `missing ${nextName} job boundary`);
  return workflow.slice(start, end);
}

test("nightly workflow pins actions and isolates credentials by job", () => {
  const workflow = readFileSync(WORKFLOW_PATH, "utf8");
  const approvedPins = new Map([
    ["actions/checkout", "3d3c42e5aac5ba805825da76410c181273ba90b1"],
    ["actions/setup-node", "820762786026740c76f36085b0efc47a31fe5020"],
    ["actions/upload-artifact", "043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"],
    ["actions/download-artifact", "3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"],
    ["openai/codex-action", "52fe01ec70a42f454c9d2ebd47598f9fd6893d56"],
  ]);
  const usesLines = [...workflow.matchAll(/^\s+uses:\s+([^@\s]+)@([^\s]+)(?:\s+#.*)?$/gm)];
  assert.ok(usesLines.length > 0);
  for (const [, action, pin] of usesLines) {
    assert.equal(pin, approvedPins.get(action), `unreviewed action pin for ${action}`);
    assert.match(pin, /^[0-9a-f]{40}$/);
  }
  const checkoutCount = usesLines.filter((match) => match[1] === "actions/checkout").length;
  assert.equal((workflow.match(/persist-credentials: false/g) || []).length, checkoutCount);

  const prepare = jobSection(workflow, "prepare", "verify");
  const verify = jobSection(workflow, "verify", "publish");
  const publish = jobSection(workflow, "publish", "acknowledge");
  const acknowledge = jobSection(workflow, "acknowledge");
  assert.equal((workflow.match(/secrets\.OPENAI_API_KEY/g) || []).length, 2);
  assert.equal(
    (workflow.match(/\$\{\{ secrets\.OPENAI_API_KEY \}\}/g) || []).length,
    1,
  );
  assert.match(
    prepare,
    /OPENAI_API_KEY_CONFIGURED: \$\{\{ secrets\.OPENAI_API_KEY != '' \}\}/,
  );
  assert.match(prepare, /Missing repository Actions secret/);
  assert.ok(
    prepare.indexOf("Require the repository OpenAI API key") <
      prepare.indexOf("Start the protected Codex API proxy"),
  );
  assert.ok(
    prepare.indexOf("Require the repository OpenAI API key") <
      prepare.indexOf("Check out bounded durable state without credentials"),
  );
  assert.match(prepare, /openai-api-key: \$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  assert.doesNotMatch(prepare, /OPENAI_API_KEY:\s*\$\{\{ secrets\.OPENAI_API_KEY \}\}/);
  for (const section of [verify, publish, acknowledge]) {
    assert.doesNotMatch(section, /OPENAI_API_KEY|secrets\./);
  }
  assert.match(verify, /env -i/);
  assert.doesNotMatch(verify, /GH_TOKEN/);
  assert.doesNotMatch(publish, /npm\s+(?:test|run)|codex-action|run-nightly\.mjs/);
  assert.equal((workflow.match(/contents: write/g) || []).length, 2);
  assert.equal((workflow.match(/pull-requests: write/g) || []).length, 2);
  assert.match(verify, /needs: prepare/);
  assert.match(publish, /needs: verify/);
  assert.match(workflow, /group: nightly-stabilize-review-\$\{\{ github\.event_name == 'pull_request'/);
  assert.match(workflow, /queue: max/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /timezone: "America\/Chicago"/);
  assert.match(publish, /publish-cloud-review\.mjs/);
  assert.match(acknowledge, /STABILIZE_NIGHTLY_SKIP_CODEX: "1"/);
});

test("verification profile and executable smoke probe enforce a writable root", () => {
  const profile = readFileSync(path.join(REPO_ROOT, "ops", "nightly", "verification.sb"), "utf8");
  assert.match(profile, /\(deny file-write\*\)/);
  assert.match(profile, /\(subpath \(param "WRITABLE_ROOT"\)\)/);
  assert.match(profile, /\(literal "\/dev\/null"\)/);
  assert.match(profile, /\(deny process-info\*\)/);
  assert.match(profile, /\(allow process-info\* \(target same-sandbox\)\)/);
  assert.match(profile, /\(deny network\*\)/);
  const probe = path.join(REPO_ROOT, "ops", "nightly", "test-verification-sandbox.zsh");
  assert.notEqual(statSync(probe).mode & 0o111, 0);
  const probeSource = readFileSync(probe, "utf8");
  assert.match(probeSource, /probe_root="\$\{probe_root:A\}"/);
  assert.match(probeSource, /outside_root="\$\{outside_root:A\}"/);
});
