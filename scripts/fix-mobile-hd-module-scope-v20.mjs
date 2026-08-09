import { readFile, writeFile } from "node:fs/promises";

const CLIENT_PATH =
  "/mobile-hd-background-v20.js?v=20260809-mobile-hd-background-v20-2";
const CLASSIC_TAG = `    <script src="${CLIENT_PATH}" defer></script>`;
const MODULE_TAG = `    <script type="module" src="${CLIENT_PATH}"></script>`;
const MODULE_ASSERTION =
  `  assert.ok(pageSource.includes('<script type="module" src="${CLIENT_PATH}"></script>'));`;

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

await update("src/page.js", (source) => {
  let next = source;
  if (!next.includes(MODULE_TAG)) {
    if (!next.includes(CLASSIC_TAG)) {
      throw new Error("Could not find the classic true-HD client script tag.");
    }
    next = next.replace(CLASSIC_TAG, MODULE_TAG);
  }

  if (next.split(MODULE_TAG).length - 1 !== 1) {
    throw new Error("Expected exactly one module-scoped true-HD client.");
  }
  if (next.includes(CLASSIC_TAG)) {
    throw new Error("The classic true-HD client tag is still present.");
  }
  return next;
});

await update("test/mobile-quality.test.mjs", (source) => {
  if (source.includes(MODULE_ASSERTION)) return source;

  const anchor =
    '  assert.match(pageSource, /id="mobile-hd-background"/);';
  if (!source.includes(anchor)) {
    throw new Error("Could not locate the true-HD page assertion.");
  }
  return source.replace(anchor, `${anchor}\n${MODULE_ASSERTION}`);
});

console.log(
  "Loaded the true-HD mobile client as an ES module so it cannot collide with legacy canvas globals.",
);
