import { readFile, writeFile } from "node:fs/promises";

const ASSET_VERSION = "20260805-taller-composer-1";
const FAVICON_LINK =
  '    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />';
const STATIC_PAGES = [
  "public/about.html",
  "public/floor-first.html",
  "public/how-it-works.html",
  "public/privacy.html",
  "public/safety.html",
  "public/support.html",
  "public/sustainability.html",
];

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Model tile and favicon update could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/paid-worker.js", (source) => {
  let text = source;
  const helper = `function compactModelTileLabel(model) {
  const value = String(model || "").toLowerCase();
  if (value === "gpt-5-mini") return "5 mini";
  const match = value.match(/^gpt-(\\d+(?:\\.\\d+)?)/);
  return match?.[1] || "5.x";
}

`;
  text = text
    .replace(
      /\/billing\.css\?v=[A-Za-z0-9._-]+/g,
      `/billing.css?v=${ASSET_VERSION}`,
    )
    .replace(
      /\/billing-client\.js\?v=[A-Za-z0-9._-]+/g,
      `/billing-client.js?v=${ASSET_VERSION}`,
    );

  const anchor = "function composerModelPickerMarkup({";
  if (!text.includes("function compactModelTileLabel(")) {
    requireText(text, anchor, "the composer model picker");
    text = text.replace(anchor, helper + anchor);
  }

  const oldButtonLabel = `  const buttonLabel =
    choice.selected === defaultModel ? "Default" : choice.currentLabel;`;
  const newButtonLabel =
    "  const buttonLabel = compactModelTileLabel(choice.selected);";
  if (text.includes(oldButtonLabel)) {
    text = text.replace(oldButtonLabel, newButtonLabel);
  } else {
    requireText(text, newButtonLabel, "the compact model tile label");
  }

  requireText(
    text,
    `/billing.css?v=${ASSET_VERSION}`,
    "the taller composer stylesheet cache key",
  );
  requireText(
    text,
    `/billing-client.js?v=${ASSET_VERSION}`,
    "the taller composer client cache key",
  );

  return text;
});

await update("public/billing-client.js", (source) => {
  let text = source;
  const helper = `function compactModelTileLabel(model) {
  const value = String(model || "").toLowerCase();
  if (value === "gpt-5-mini") return "5 mini";
  const match = value.match(/^gpt-(\\d+(?:\\.\\d+)?)/);
  return match?.[1] || "5.x";
}

`;
  const anchor = "function showModelFallbackNotice(defaultModel) {";
  if (!text.includes("function compactModelTileLabel(")) {
    requireText(text, anchor, "the model fallback notice");
    text = text.replace(anchor, helper + anchor);
  }

  const oldFallbackLabel = 'current.textContent = "Default";';
  const newFallbackLabel =
    "current.textContent = compactModelTileLabel(defaultModel);";
  if (text.includes(oldFallbackLabel)) {
    text = text.replaceAll(oldFallbackLabel, newFallbackLabel);
  } else {
    requireText(text, newFallbackLabel, "the fallback model tile update");
  }

  return text;
});

await update("public/billing.css", (source) => {
  if (source.includes("/* Exact 5.x model tile */")) return source;
  return `${source.trimEnd()}

/* Exact 5.x model tile */
.composer-model-button {
  width: 66px;
  min-width: 66px;
  height: 64px;
  min-height: 64px;
  padding: 6px 5px;
}

.composer-model-current {
  margin-top: 3px;
  overflow: visible;
  font-size: clamp(0.9rem, 0.85rem + 0.25vw, 1rem);
  font-weight: 820;
  letter-spacing: -0.035em;
  text-overflow: clip;
}

@media (max-width: 600px) {
  .composer-model-button {
    width: 64px;
    min-width: 64px;
  }

  .composer-model-current {
    font-size: 0.95rem;
  }
}
`;
});

await update("public/billing.css", (source) => {
  const oldBlock = `/* Compact 32px composer bar */
.composer-model-button,
.composer-dock textarea,
.composer-dock #send-button {
  height: 32px;
  min-height: 32px;
  max-height: 32px;
}

.composer-model-button {
  border-radius: 10px;
  padding: 2px 5px;
}

.composer-model-kicker {
  display: none;
}

.composer-model-current {
  margin-top: 0;
  line-height: 1;
}

.composer-model-button::after {
  display: none;
  content: none;
}

.composer-dock textarea {
  border-radius: 10px;
  padding: 5px 10px;
  font-size: 1rem;
  line-height: 1.2;
}

.composer-dock textarea::placeholder {
  line-height: 1.2;
}

.composer-dock #send-button {
  border-radius: 10px;
  padding-inline: 14px;
}`;
  const newBlock = `/* Balanced 42px composer bar */
.composer-model-button,
.composer-dock textarea,
.composer-dock #send-button {
  height: 42px;
  min-height: 42px;
  max-height: 42px;
}

.composer-model-button {
  border-radius: 10px;
  padding: 2px 5px;
}

.composer-model-kicker {
  display: none;
}

.composer-model-current {
  margin-top: 0;
  line-height: 1;
}

.composer-model-button::after {
  display: none;
  content: none;
}

.composer-dock textarea {
  border-radius: 10px;
  padding: 5px 10px;
  font-size: 1rem;
  line-height: 1.2;
}

.composer-dock textarea::placeholder {
  line-height: 1.2;
}

.composer-dock #send-button {
  border-radius: 10px;
  padding-inline: 14px;
}`;

  if (source.includes(newBlock)) return source;
  if (source.includes(oldBlock)) return source.replace(oldBlock, newBlock);
  return `${source.trimEnd()}\n\n${newBlock}\n`;
});

await update("src/page.js", (source) => {
  if (source.includes('href="/favicon.svg"')) return source;
  const anchor = '    <meta name="theme-color" content="#173f31" />';
  requireText(source, anchor, "the main-page theme color");
  return source.replace(anchor, `${anchor}\n${FAVICON_LINK}`);
});

for (const path of STATIC_PAGES) {
  await update(path, (source) => {
    if (source.includes('href="/favicon.svg"')) return source;
    const themePattern = /(\s*<meta name="theme-color"[^>]*\/?>)/;
    if (themePattern.test(source)) {
      return source.replace(themePattern, `$1\n${FAVICON_LINK}`);
    }
    requireText(source, "</head>", `${path} head closing tag`);
    return source.replace("</head>", `${FAVICON_LINK}\n  </head>`);
  });
}

await update("test/paid-worker.test.mjs", (source) => {
  const oldExpectation = String.raw`/<span class="composer-model-current">GPT-5\.1<\/span>/,`;
  const newExpectation = String.raw`/<span class="composer-model-current">5\.1<\/span>/,`;
  if (source.includes(oldExpectation)) {
    return source.replace(oldExpectation, newExpectation);
  }
  requireText(source, newExpectation, "the compact model tile Worker test");
  return source;
});

console.log(
  "Made the model tile show the active 5.x version, set the composer to 42px, and added the Stabilize favicon.",
);
