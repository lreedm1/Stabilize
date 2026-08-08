import { readFileSync, writeFileSync } from "node:fs";

const path = "scripts/add-memory-deletion-and-guest-session.mjs";
let source = readFileSync(path, "utf8");

function replaceGeneratorBlock(oldBlock, structuralBlock, label) {
  if (source.includes(oldBlock)) {
    source = source.replace(oldBlock, structuralBlock);
    return;
  }
  if (!source.includes(structuralBlock)) {
    throw new Error(`Could not locate the ${label} generator block`);
  }
}

replaceGeneratorBlock(
  [
    "replaceOnce(",
    "  pagePath,",
    "  `/app.js?v=20260806-static-mobile-background-1`,",
    "  `/app.js?v=20260808-memory-controls-1`,",
    '  "app cache version",',
    ");",
  ].join("\n"),
  [
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
  ].join("\n"),
  "app cache",
);

replaceGeneratorBlock(
  [
    "replaceOnce(",
    "  pagePath,",
    "  `/seo.css?v=20260804-private-chat-1`,",
    "  `/seo.css?v=20260808-memory-controls-1`,",
    '  "memory controls stylesheet cache version",',
    ");",
  ].join("\n"),
  [
    "{",
    "  const pageSource = read(pagePath);",
    '  const memorySeoAsset = "/seo.css?v=20260808-memory-controls-1";',
    "  if (!pageSource.includes(memorySeoAsset)) {",
    "    const seoAssets =",
    "      pageSource.match(/\\/seo\\.css\\?v=[A-Za-z0-9._-]+/g) || [];",
    "    if (seoAssets.length !== 1) {",
    '      throw new Error("Expected exactly one SEO cache version in " + pagePath);',
    "    }",
    "    write(pagePath, pageSource.replace(seoAssets[0], memorySeoAsset));",
    "  }",
    "}",
  ].join("\n"),
  "SEO cache",
);

writeFileSync(path, source, "utf8");
