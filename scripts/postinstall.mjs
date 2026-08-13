import { spawnSync } from "node:child_process";

if (process.env.WORKERS_CI === "1") {
  console.log(
    "Workers Builds detected: using policy artifacts already validated and committed by GitHub CI.",
  );
  process.exit(0);
}

const npmExecutable = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(npmExecutable, ["run", "apply:prompt-policy"], {
  env: process.env,
  stdio: "inherit",
});

if (result.error) {
  throw result.error;
}

process.exit(result.status ?? 1);
