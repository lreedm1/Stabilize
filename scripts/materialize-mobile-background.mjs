#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { readFile, writeFile } from "node:fs/promises";

const sourceUrl = new URL(
  "../public/scenes/mobile-golden-alpine-v2.b64",
  import.meta.url,
);
const imageUrl = new URL(
  "../public/scenes/mobile-golden-alpine-v2.webp",
  import.meta.url,
);

function assertWebpSignature(buffer) {
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Decoded mobile background is not a WebP image");
  }
}

function webpDimensions(buffer) {
  assertWebpSignature(buffer);

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const nextOffset = data + size + (size % 2);

    if (nextOffset > buffer.length) {
      throw new Error(`Truncated WebP chunk: ${type}`);
    }

    if (type === "VP8X" && data + 10 <= buffer.length) {
      return {
        width: 1 + buffer.readUIntLE(data + 4, 3),
        height: 1 + buffer.readUIntLE(data + 7, 3),
      };
    }

    if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      return {
        width: buffer.readUInt16LE(data + 6) & 0x3fff,
        height: buffer.readUInt16LE(data + 8) & 0x3fff,
      };
    }

    if (type === "VP8L" && data + 5 <= buffer.length && buffer[data] === 0x2f) {
      const bits = buffer.readUInt32LE(data + 1);
      return {
        width: 1 + (bits & 0x3fff),
        height: 1 + ((bits >>> 14) & 0x3fff),
      };
    }

    offset = nextOffset;
  }

  throw new Error("Decoded mobile background has no readable WebP dimensions");
}

const encoded = (await readFile(sourceUrl, "utf8")).replace(/\s+/g, "");
const decoded = Buffer.from(encoded, "base64");
assertWebpSignature(decoded);

// The GitHub text transport can leave harmless non-base64 suffix bytes in the
// encoded source. RIFF carries the canonical file length, so retain exactly the
// declared WebP payload and reject either truncation or an implausible size.
const declaredLength = decoded.readUInt32LE(4) + 8;
if (declaredLength < 100_000 || declaredLength > 5_000_000) {
  throw new Error(`Unexpected declared mobile background size: ${declaredLength} bytes`);
}
if (decoded.byteLength < declaredLength) {
  throw new Error(
    `Truncated mobile background: expected ${declaredLength} bytes, received ${decoded.byteLength}`,
  );
}
const image = decoded.subarray(0, declaredLength);
assertWebpSignature(image);

const dimensions = webpDimensions(image);
if (dimensions.width !== 853 || dimensions.height !== 1844) {
  throw new Error(
    `Unexpected mobile background dimensions: ${dimensions.width}x${dimensions.height}`,
  );
}
await writeFile(imageUrl, image);

const pageUrl = new URL("../src/page.js", import.meta.url);
let page = await readFile(pageUrl, "utf8");
page = page.replaceAll(
  "/scenes/mobile-woodland-spring-loop.webp?v=20260802-9",
  "/scenes/mobile-golden-alpine-v2.webp?v=20260803-13",
);
page = page.replaceAll(
  "mobile-golden-alpine-v2.webp?v=20260803-13 540w",
  "mobile-golden-alpine-v2.webp?v=20260803-13 853w",
);
page = page.replaceAll(
  "mobile-woodland-loop.css?v=20260802-9",
  "mobile-woodland-loop.css?v=20260803-13",
);
if (!page.includes("mobile-golden-alpine-v2.webp?v=20260803-13 853w")) {
  throw new Error("The generated mobile background was not installed in page.js");
}
await writeFile(pageUrl, page);

const cssUrl = new URL("../public/mobile-woodland-loop.css", import.meta.url);
await writeFile(
  cssUrl,
  `@media (max-width: 980px) and (orientation: portrait) {
  .photo-backdrop {
    overflow: hidden;
    background: #173f31;
    filter: none;
    transform: none;
    animation: none;
    will-change: auto;
  }

  .photo-backdrop img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 1;
    filter: none;
    transform: none !important;
    animation: none !important;
    will-change: auto;
  }

  .photo-backdrop::before,
  .photo-backdrop::after {
    display: none !important;
    content: none !important;
    animation: none !important;
  }

  .photo-background {
    display: none;
  }
}
`,
);

console.log(
  `Materialized mobile background: ${dimensions.width}x${dimensions.height}, ${image.byteLength} bytes`,
);
