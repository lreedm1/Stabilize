import { spawnSync } from "node:child_process";

function runGit(args) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (result.error) {
    throw new Error(`Could not run git: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    throw new Error(
      `git ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`,
    );
  }

  return String(result.stdout || "");
}

try {
  const insideWorkTree = runGit(["rev-parse", "--is-inside-work-tree"]).trim();
  if (insideWorkTree !== "true") {
    throw new Error("The current directory is not a Git work tree.");
  }

  const status = runGit([
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]).trimEnd();

  if (!status) {
    console.log(
      "Repository is clean after generation, tests, and build validation.",
    );
    process.exit(0);
  }

  console.error(
    "Repository changed during generation, tests, or build validation.",
  );
  console.error(
    "Commit the canonical generated output or make the responsible step read-only; do not weaken this guard.",
  );
  console.error("");
  console.error(status);

  const diffStat = runGit(["diff", "--stat", "--", "."]).trimEnd();
  if (diffStat) {
    console.error("");
    console.error("Tracked-file diff summary:");
    console.error(diffStat);
  }

  process.exit(1);
} catch (error) {
  console.error(
    `Clean-tree verification could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exit(1);
}
