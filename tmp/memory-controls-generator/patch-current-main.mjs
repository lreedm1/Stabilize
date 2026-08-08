import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/add-memory-deletion-and-guest-session.mjs";
let source = readFileSync(path, "utf8");

const replacements = [
  [
    "/app.js?v=20260806-static-mobile-background-1",
    "/app.js?v=20260807-priority-latency-1",
  ],
];

for (const [from, to] of replacements) {
  if (!source.includes(from) && !source.includes(to)) {
    throw new Error(`Could not locate generator anchor: ${from}`);
  }
  source = source.split(from).join(to);
}

writeFileSync(path, source, "utf8");
