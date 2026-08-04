import { readFile, writeFile } from "node:fs/promises";

const path = "public/app.js";
const before = await readFile(path, "utf8");
let after = before;

after = after.replaceAll(
  "if (offerOutcomeCheck) appendOutcomeCheck(article, reply, route);",
  "if (offerOutcomeCheck) renderOutcomeCheck(reply, route);\n  else clearOutcomeTray();",
);

after = after.replaceAll(
  "if (offerOutcomeCheck) appendOutcomeCheck(article, content, route);",
  "if (offerOutcomeCheck) renderOutcomeCheck(content, route);\n  else clearOutcomeTray();",
);

if (after !== before) await writeFile(path, after);
console.log("Prepared follow-up rendering for the composer tray.");
