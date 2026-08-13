import { readFileSync, writeFileSync } from "node:fs";

const path = "src/page.js";
const source = readFileSync(path, "utf8");
const finalVersion = "/app.js?v=20260808-full-guest-thread-1";
const legacyLine =
  '    <script type="module" src="/app.js?v=20260808-guest-summary-1"></script>';

if (!source.includes(finalVersion) && !source.includes(legacyLine)) {
  const scriptPattern =
    /    <script type="module" src="\/app\.js\?v=[^"]+"><\/script>/;
  if (!scriptPattern.test(source)) {
    throw new Error("Could not locate the generated app.js module script in src/page.js");
  }
  writeFileSync(path, source.replace(scriptPattern, legacyLine), "utf8");
}
