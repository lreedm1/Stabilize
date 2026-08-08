import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const path = process.argv[2] || "scripts/add-memory-deletion-and-guest-session.mjs";
let source = readFileSync(path, "utf8");

const target = "The signed HttpOnly cookie contains";
const replacement = "The signed \\`HttpOnly\\` cookie contains";
if (!source.includes(target) && !source.includes(replacement)) {
  throw new Error("Could not locate the README HttpOnly generator anchor");
}
source = source.split(target).join(replacement);

const here = dirname(fileURLToPath(import.meta.url));
const compatibilityBlock = readdirSync(here)
  .filter((name) => name.startsWith("compatibility-") && name.endsWith(".txt"))
  .sort()
  .map((name) => readFileSync(join(here, name), "utf8"))
  .join("");
const compatibilityMarker = 'const readmePath = "README.md";\n';
if (!source.includes(compatibilityBlock)) {
  if (!source.includes(compatibilityMarker)) {
    throw new Error("Could not locate the streaming compatibility insertion point");
  }
  source = source.replace(
    compatibilityMarker,
    compatibilityBlock + compatibilityMarker,
  );
}

writeFileSync(path, source, "utf8");
