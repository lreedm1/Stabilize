import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("the lower-left model button opens model, new chat, and private chat sections", async () => {
  const [worker, client, css, packageSource] = await Promise.all([
    read("src/paid-worker.js"),
    read("public/billing-client.js"),
    read("public/billing.css"),
    read("package.json"),
  ]);

  assert.match(worker, /composer-quick-model-heading">Model/);
  assert.match(worker, /composer-quick-new-heading">New chat/);
  assert.match(worker, /composer-quick-private-heading">New private chat/);
  assert.match(worker, /data-composer-new-chat/);
  assert.match(worker, /data-composer-new-private-chat/);
  assert.match(worker, /Open model and chat controls\. Current model:/);
  assert.match(
    worker,
    /billing-client\.js\?v=20260805-composer-chat-sections-1/,
  );

  assert.match(client, /function startComposerNewChat\(/);
  assert.match(client, /function startComposerPrivateChat\(/);
  assert.match(
    client,
    /privateChat\?\.getAttribute\("aria-pressed"\) === "true"[\s\S]*privateChat\.click\(\)[\s\S]*newConversation\.click\(\)/,
  );
  assert.match(
    client,
    /privateChat\.getAttribute\("aria-pressed"\) !== "true"[\s\S]*privateChat\.click\(\)[\s\S]*return;/,
  );
  assert.match(client, /Wait for the current response to finish/);

  assert.match(css, /\/\* Composer chat sections \*\//);
  assert.match(css, /\.composer-quick-section\s*{/);
  assert.match(css, /\.composer-quick-private-action\s*{/);
  assert.match(css, /max-height:\s*min\(68dvh, 470px\)/);

  assert.match(
    packageSource,
    /node scripts\/add-composer-chat-sections\.mjs/,
  );
});
