import { readFile, writeFile } from "node:fs/promises";

const ASSET_VERSION = "20260807-free-gpt56-first-50-1";

async function update(path, transform, { optional = false } = {}) {
  let before;
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (optional && error?.code === "ENOENT") return;
    throw error;
  }
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Free GPT-5.6 UI compatibility could not find ${label}`);
  }
}

await update("src/paid-worker.js", (source) => {
  let text = source.replace(
    `  if (url.searchParams.get("model") === "saved") {
    return "Your AI model choice was saved.";
  }
`,
    "",
  );
  text = text.replaceAll(
    '<a class="billing-primary billing-link" href="/auth/google">Sign in</a>',
    '<a class="billing-primary billing-link" href="/auth/google">Sign in to choose a model</a>',
  );
  if (text.includes("Your AI model choice was saved.")) {
    throw new Error("The suppressed model-saved notice was restored");
  }
  requireText(
    text,
    'href="/auth/google">Sign in to choose a model',
    "the guest model sign-in action",
  );
  return text;
});

await update(
  "test/composer-chat-sections.test.mjs",
  (source) =>
    source.replace(
      /billing-client\\\.js\\\?v=[A-Za-z0-9._-]+/,
      `billing-client\\.js\\?v=${ASSET_VERSION}`,
    ),
  { optional: true },
);

await update(
  "test/composer-placeholder-alignment.test.mjs",
  (source) =>
    source.replace(
      /\\\/billing\\\.css\\\?v=[A-Za-z0-9._-]+/,
      `\\/billing\\.css\\?v=${ASSET_VERSION}`,
    ),
  { optional: true },
);

await update(
  "test/paid-model-choice.test.mjs",
  (source) =>
    source.replace(
      "  assert.match(workerSource, /50 free GPT-5.6 Instant messages/);",
      "  assert.match(workerSource, /freeLimit[\\s\\S]*GPT-5\\.6 Instant messages/);",
    ),
  { optional: true },
);

await update(
  "test/prompt-policy-idempotency.test.mjs",
  (source) => {
    const path = "scripts/finalize-free-gpt56-ui-compat.mjs";
    if (source.includes(`"${path}"`)) return source;
    const marker = '  "scripts/align-free-gpt56-tests.mjs",\n';
    requireText(source, marker, "the free-plan test alignment fixture");
    return source.replace(marker, `${marker}  "${path}",\n`);
  },
  { optional: true },
);

console.log("Preserved the free GPT-5.6 UI and existing navigation contracts.");
