import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/add-memory-deletion-and-guest-session.mjs";
let source = readFileSync(path, "utf8");

const oldBlock = [
  "replaceOnce(",
  "  pagePath,",
  "  `/app.js?v=20260806-static-mobile-background-1`,",
  "  `/app.js?v=20260808-memory-controls-1`,",
  '  "app cache version",',
  ");",
].join("\n");

const structuralBlock = [
  "{",
  "  const pageSource = read(pagePath);",
  '  const memoryAppAsset = "/app.js?v=20260808-memory-controls-1";',
  "  if (!pageSource.includes(memoryAppAsset)) {",
  "    const appAssets =",
  "      pageSource.match(/\\/app\\.js\\?v=[A-Za-z0-9._-]+/g) || [];",
  "    if (appAssets.length !== 1) {",
  '      throw new Error("Expected exactly one app cache version in " + pagePath);',
  "    }",
  "    write(pagePath, pageSource.replace(appAssets[0], memoryAppAsset));",
  "  }",
  "}",
].join("\n");

if (source.includes(oldBlock)) {
  source = source.replace(oldBlock, structuralBlock);
} else if (!source.includes(structuralBlock)) {
  throw new Error("Could not locate the app-cache generator block");
}

writeFileSync(path, source, "utf8");
