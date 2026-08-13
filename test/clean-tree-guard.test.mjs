import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryFile = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");
const verifierPath = fileURLToPath(
  new URL("../scripts/verify-clean-tree.mjs", import.meta.url),
);

function git(cwd, args) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function verify(cwd) {
  return spawnSync(process.execPath, [verifierPath], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("the clean-tree verifier rejects tracked and untracked build drift", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stabilize-clean-tree-"));

  try {
    git(directory, ["init", "--quiet"]);
    git(directory, ["config", "user.name", "Stabilize Test"]);
    git(directory, ["config", "user.email", "test@stabilize.invalid"]);
    await writeFile(join(directory, "tracked.txt"), "canonical\n");
    git(directory, ["add", "tracked.txt"]);
    git(directory, ["commit", "--quiet", "-m", "Initial state"]);

    const clean = verify(directory);
    assert.equal(clean.status, 0, clean.stderr);
    assert.match(clean.stdout, /Repository is clean/);

    await writeFile(join(directory, "tracked.txt"), "generated drift\n");
    const trackedDrift = verify(directory);
    assert.equal(trackedDrift.status, 1);
    assert.match(trackedDrift.stderr, /Repository changed during generation/);
    assert.match(trackedDrift.stderr, /tracked\.txt/);

    git(directory, ["checkout", "--", "tracked.txt"]);
    await writeFile(join(directory, "unexpected.txt"), "unexpected output\n");
    const untrackedDrift = verify(directory);
    assert.equal(untrackedDrift.status, 1);
    assert.match(untrackedDrift.stderr, /\?\? unexpected\.txt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("normal validation and deployment finish with the clean-tree guard", async () => {
  const [
    packageSource,
    testWorkflow,
    deployWorkflow,
    contributing,
    verifier,
  ] = await Promise.all([
    repositoryFile("package.json"),
    repositoryFile(".github/workflows/test.yml"),
    repositoryFile(".github/workflows/deploy-cloudflare.yml"),
    repositoryFile("CONTRIBUTING.md"),
    repositoryFile("scripts/verify-clean-tree.mjs"),
  ]);
  const packageJson = JSON.parse(packageSource);

  assert.equal(
    packageJson.scripts["verify:clean"],
    "node scripts/verify-clean-tree.mjs",
  );
  assert.match(
    packageJson.scripts["test:node"],
    /test\/clean-tree-guard\.test\.mjs/,
  );

  assert.doesNotMatch(testWorkflow, /migrate-generated-mobile-photo/);
  assert.match(testWorkflow, /npm ci[\s\S]*npm test[\s\S]*npm run check/);
  assert.match(testWorkflow, /name: Verify repository stays clean/);
  assert.match(testWorkflow, /run: npm run verify:clean/);

  const buildStep = deployWorkflow.indexOf("name: Validate Worker build");
  const cleanStep = deployWorkflow.indexOf(
    "name: Verify repository stays clean",
  );
  const deployStep = deployWorkflow.indexOf(
    "name: Deploy current main commit with Wrangler",
  );
  assert.ok(buildStep >= 0);
  assert.ok(cleanStep > buildStep);
  assert.ok(deployStep > cleanStep);
  assert.match(contributing, /npm run verify:clean/);

  assert.match(verifier, /--porcelain=v1/);
  assert.match(verifier, /--untracked-files=all/);
  assert.match(verifier, /do not weaken this guard/);
});
