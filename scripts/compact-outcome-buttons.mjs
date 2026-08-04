import { readFile, writeFile } from "node:fs/promises";

const cssPath = "public/product.css";
const pagePath = "src/page.js";
const productTestPath = "test/product.test.mjs";
const marker = "/* compact horizontal outcome buttons */";
const assetVersion = "20260804-compact-outcomes-2";

const compactStyles = `

${marker}
.outcome-tray {
  width: min(760px, 100%);
  margin: 0 auto 7px;
  overflow-x: auto;
  scrollbar-width: none;
}

.outcome-tray::-webkit-scrollbar {
  display: none;
}

.outcome-check {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
  backdrop-filter: none;
}

.outcome-question {
  display: none;
}

.outcome-actions {
  display: flex;
  flex-wrap: nowrap;
  justify-content: flex-start;
  gap: 6px;
  margin: 0;
  width: max-content;
  min-width: 100%;
}

.outcome-button {
  width: auto;
  min-height: 30px;
  flex: 0 0 auto;
  border-radius: 999px;
  padding: 5px 10px;
  font-size: 0.69rem;
  line-height: 1.1;
  white-space: nowrap;
}
`;

const cssSource = await readFile(cssPath, "utf8");
let nextCss = cssSource;
const markerStart = nextCss.indexOf(marker);
if (markerStart >= 0) {
  nextCss = nextCss.slice(0, Math.max(0, markerStart - 2)).trimEnd() + "\n";
}
nextCss += compactStyles;
if (nextCss !== cssSource) await writeFile(cssPath, nextCss);

const pageSource = await readFile(pagePath, "utf8");
const nextPage = pageSource.replace(
  /href="\/product\.css(?:\?v=[^"]*)?"/,
  `href="/product.css?v=${assetVersion}"`,
);
if (!nextPage.includes(`/product.css?v=${assetVersion}`)) {
  throw new Error("Could not cache-bust the product stylesheet");
}
if (nextPage !== pageSource) await writeFile(pagePath, nextPage);

const productTestSource = await readFile(productTestPath, "utf8");
const expectedAssertion = `  assert.match(
    pageSource,
    /href="\\/product\\.css\\?v=${assetVersion}"/,
  );`;
let nextProductTest = productTestSource;
if (!nextProductTest.includes(expectedAssertion)) {
  const oldAssertion =
    '  assert.match(pageSource, /href="\\/product\\.css"/);';
  if (!nextProductTest.includes(oldAssertion)) {
    throw new Error("Could not align the product stylesheet regression check");
  }
  nextProductTest = nextProductTest.replace(oldAssertion, expectedAssertion);
}
if (nextProductTest !== productTestSource) {
  await writeFile(productTestPath, nextProductTest);
}

console.log("Compacted follow-up prompts and cache-busted their stylesheet.");
