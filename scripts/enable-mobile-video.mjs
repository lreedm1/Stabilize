import { readdir, readFile, writeFile } from "node:fs/promises";

const OLD =
  "node scripts/use-mobile-forest-stream.mjs && node scripts/apply-decision-grade-impact.mjs";
const NEXT =
  "node scripts/use-mobile-forest-stream.mjs && node scripts/apply-mobile-video.mjs && node scripts/apply-decision-grade-impact.mjs";

const FINAL_VIDEO_BYTES_JS = "43_100";
const FINAL_VIDEO_BYTES_TEXT = "43100";
const FINAL_VIDEO_SHA =
  "c1258ba20e6aa01554b9f946d47b449a2688b7630708bb85f902597bfe283326";
const OLD_VIDEO_SHAS = [
  "e5d824a487d3d423c5a6e70d84b45dbc2cee7afcbd3b618db0446ff002054e16",
  "48d1cc54b69de9a5b5c0c1b62938fddb6cef3f59ae5b1deb3f73e54aeb55e0c6",
];

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
  let after = before.replaceAll(OLD, NEXT);
  for (const oldValue of ["602_638", "122_770"]) {
    after = after.replaceAll(oldValue, FINAL_VIDEO_BYTES_JS);
  }
  for (const oldValue of ["602638", "122770"]) {
    after = after.replaceAll(oldValue, FINAL_VIDEO_BYTES_TEXT);
  }
  for (const oldSha of OLD_VIDEO_SHAS) {
    after = after.replaceAll(oldSha, FINAL_VIDEO_SHA);
  }
  if (after === before) continue;
  await writeFile(path, after, "utf8");
  replacements += 1;
}

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (
  !packageJson.scripts["apply:prompt-policy"].includes(
    "node scripts/apply-mobile-video.mjs",
  )
) {
  throw new Error("Mobile video helper was not added to apply:prompt-policy");
}

const helper = await readFile("scripts/apply-mobile-video.mjs", "utf8");
if (
  !helper.includes(FINAL_VIDEO_BYTES_JS) ||
  !helper.includes(FINAL_VIDEO_SHA) ||
  OLD_VIDEO_SHAS.some((oldSha) => helper.includes(oldSha))
) {
  throw new Error("Mobile video helper did not receive the final MP4 identity");
}

console.log(
  `Enabled the mobile video helper and aligned ${replacements} canonical file(s).`,
);
