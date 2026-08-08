import { readdir, readFile, writeFile } from "node:fs/promises";

const OLD =
  "node scripts/use-mobile-forest-stream.mjs && node scripts/apply-decision-grade-impact.mjs";
const NEXT =
  "node scripts/use-mobile-forest-stream.mjs && node scripts/apply-mobile-video.mjs && node scripts/apply-decision-grade-impact.mjs";

async function textFiles(directory) {
  const output = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = `${directory}/${entry.name}`;
    if (entry.isDirectory()) {
      output.push(...(await textFiles(path)));
    } else if (/\.(?:js|mjs|json|md|yml|yaml)$/.test(entry.name)) {
      output.push(path);
    }
  }
  return output;
}

const paths = [
  "package.json",
  ...(await textFiles("test")),
  ...(await textFiles("scripts")),
];
let replacements = 0;
for (const path of paths) {
  const before = await readFile(path, "utf8");
  const occurrences = before.split(OLD).length - 1;
  if (!occurrences) continue;
  const after = before.replaceAll(OLD, NEXT);
  await writeFile(path, after, "utf8");
  replacements += occurrences;
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (
  !packageJson.scripts["apply:prompt-policy"].includes(
    "node scripts/apply-mobile-video.mjs",
  )
) {
  throw new Error("Mobile video helper was not added to apply:prompt-policy");
}
if (
  !replacements &&
  !packageJson.scripts["apply:prompt-policy"].includes(NEXT)
) {
  throw new Error("No canonical mobile video pipeline insertion point was found");
}

console.log(
  `Enabled the mobile video helper in ${replacements} canonical command reference(s).`,
);
