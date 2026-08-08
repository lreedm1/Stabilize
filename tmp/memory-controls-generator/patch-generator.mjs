import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/add-memory-deletion-and-guest-session.mjs";
const source = readFileSync(path, "utf8");
const target = "The signed HttpOnly cookie contains";
const replacement = "The signed \\`HttpOnly\\` cookie contains";

if (!source.includes(target)) {
  throw new Error("Could not locate the README HttpOnly generator anchor");
}

writeFileSync(path, source.replace(target, replacement), "utf8");
