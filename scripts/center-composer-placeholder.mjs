import { readFile, writeFile } from "node:fs/promises";

const ASSET_VERSION = "20260805-centered-placeholder-2";
const STYLE_MARKER = "/* Horizontally centered composer placeholder */";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Composer placeholder alignment could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/paid-worker.js", (source) => {
  const text = source
    .replace(
      /\/billing\.css\?v=[A-Za-z0-9._-]+/g,
      `/billing.css?v=${ASSET_VERSION}`,
    )
    .replace(
      /\/billing-client\.js\?v=[A-Za-z0-9._-]+/g,
      `/billing-client.js?v=${ASSET_VERSION}`,
    );

  requireText(
    text,
    `/billing.css?v=${ASSET_VERSION}`,
    "the centered composer stylesheet cache key",
  );
  requireText(
    text,
    `/billing-client.js?v=${ASSET_VERSION}`,
    "the centered composer client cache key",
  );

  return text;
});

await update("public/billing.css", (source) => {
  if (source.includes(STYLE_MARKER)) return source;

  return `${source.trimEnd()}

${STYLE_MARKER}
.composer-dock textarea {
  text-align: left;
}

.composer-dock textarea::placeholder {
  text-align: center;
}
`;
});

console.log(
  "Centered the composer placeholder horizontally while keeping entered text left-aligned.",
);
