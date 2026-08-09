import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the true-HD mobile scene records its original 4K source and license", async () => {
  const source = await readFile(
    new URL(
      "../public/scenes/mobile-forest-stream-v20-license.txt",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(source, /Original resolution: 3840 x 2160/);
  assert.match(source, /pexels\.com\/video\/a-narrow-trail-beside-a-flowing-stream-4333152/);
  assert.match(source, /pexels\.com\/license/);
  assert.match(source, /1440 x 2560 MP4 and WebP poster/);
});
