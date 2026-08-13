import { readFile, writeFile } from "node:fs/promises";

const cssPath = "public/main-box-white.css";
const pagePath = "src/page.js";
const testPath = "test/main-box-text-color.test.mjs";
const assetVersion = "20260805-2";
const marker = "/* Translucent gray reading surfaces */";

const graySurfaceStyles = `

${marker}
.seo-intro,
.assistant-output {
  border: 1px solid rgba(255, 255, 255, 0.42);
  background: rgba(42, 47, 46, 0.68);
  box-shadow: 0 10px 30px rgba(4, 13, 10, 0.24);
  -webkit-backdrop-filter: blur(10px) saturate(0.82);
  backdrop-filter: blur(10px) saturate(0.82);
}
`;

const cssBefore = await readFile(cssPath, "utf8");
let cssAfter = cssBefore;
const markerIndex = cssAfter.indexOf(marker);
if (markerIndex >= 0) {
  cssAfter = cssAfter.slice(0, Math.max(0, markerIndex - 2)).trimEnd() + "\n";
}
cssAfter = cssAfter.trimEnd() + graySurfaceStyles;
if (cssAfter !== cssBefore) await writeFile(cssPath, cssAfter);

const pageBefore = await readFile(pagePath, "utf8");
const pageAfter = pageBefore.replace(
  /\/main-box-white\.css\?v=[A-Za-z0-9._-]+/g,
  `/main-box-white.css?v=${assetVersion}`,
);
if (!pageAfter.includes(`/main-box-white.css?v=${assetVersion}`)) {
  throw new Error("Could not cache-bust the gray reading-surface stylesheet");
}
if (pageAfter !== pageBefore) await writeFile(pagePath, pageAfter);

const testBefore = await readFile(testPath, "utf8");
let testAfter = testBefore.replace(
  /\/main-box-white\.css\?v=[A-Za-z0-9._-]+/g,
  `/main-box-white.css?v=${assetVersion}`,
);
if (!testAfter.includes("Translucent gray reading surfaces")) {
  const assertionAnchor = "  assert.match(styles, /color:\\s*#fffef8;/);";
  if (!testAfter.includes(assertionAnchor)) {
    throw new Error("Could not align the main-box readability regression test");
  }
  testAfter = testAfter.replace(
    assertionAnchor,
    `${assertionAnchor}\n  assert.match(styles, /\\/\\* Translucent gray reading surfaces \\*\\//);\n  assert.match(\n    styles,\n    /\\.seo-intro,[\\s\\S]*\\.assistant-output \\{[\\s\\S]*background:\\s*rgba\\(42, 47, 46, 0\\.68\\);[\\s\\S]*backdrop-filter:\\s*blur\\(10px\\)/,\n  );`,
  );
}
if (testAfter !== testBefore) await writeFile(testPath, testAfter);

console.log("Restored translucent gray reading boxes behind the white main text.");
