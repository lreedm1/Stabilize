import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

function modulePayload(source) {
  const match = source.match(/^export default "([A-Za-z0-9+/=]+)";\s*$/);
  assert.ok(match, "mobile woodland data module should export base64 only");
  return match[1];
}

test("woodland animation is valid and loaded only for mobile portrait", async () => {
  const [loader, ...parts] = await Promise.all([
    readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-0.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-1.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-2.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-3.js", import.meta.url), "utf8"),
  ]);

  const encoded = parts.map(modulePayload).join("");
  const image = Buffer.from(encoded, "base64");

  assert.equal(image.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(image.subarray(8, 12).toString("ascii"), "WEBP");
  assert.match(loader, /\(max-width: 980px\) and \(orientation: portrait\)/);
  assert.match(loader, /prefers-reduced-motion: reduce/);
  assert.match(loader, /import\("\/mobile-woodland-0\.js"\)/);
  assert.match(loader, /data:image\/webp;base64/);
  assert.match(loader, /lake-valley-landscape-7680\.webp/);
  assert.ok(image.byteLength < 30_000);
});
