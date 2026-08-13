#!/usr/bin/env node

import { writeFile, readFile } from "node:fs/promises";

const imageUrl = new URL(
  "../public/scenes/mobile-golden-alpine-v2.webp",
  import.meta.url,
);
const sourceUrl =
  "https://filebin.net/stabilize-mobile-bg-20260803-5ffe5cad/mobile-golden-alpine-v2.webp";

function webpInfo(buffer) {
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Downloaded mobile background is not a WebP image");
  }

  const declaredLength = buffer.readUInt32LE(4) + 8;
  if (declaredLength !== buffer.byteLength) {
    throw new Error(
      `WebP length mismatch: declared ${declaredLength}, received ${buffer.byteLength}`,
    );
  }

  let width;
  let height;
  let animated = false;
  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString("ascii");
    const size = buffer.readUInt32LE(offset + 4);
    const data = offset + 8;
    const end = data + size;
    if (end > buffer.length) throw new Error(`Truncated WebP chunk: ${type}`);

    if (type === "ANIM") animated = true;
    if (type === "VP8X" && data + 10 <= buffer.length) {
      width = 1 + buffer.readUIntLE(data + 4, 3);
      height = 1 + buffer.readUIntLE(data + 7, 3);
    } else if (
      type === "VP8 " &&
      data + 10 <= buffer.length &&
      buffer[data + 3] === 0x9d &&
      buffer[data + 4] === 0x01 &&
      buffer[data + 5] === 0x2a
    ) {
      width ??= buffer.readUInt16LE(data + 6) & 0x3fff;
      height ??= buffer.readUInt16LE(data + 8) & 0x3fff;
    } else if (
      type === "VP8L" &&
      data + 5 <= buffer.length &&
      buffer[data] === 0x2f
    ) {
      const bits = buffer.readUInt32LE(data + 1);
      width ??= 1 + (bits & 0x3fff);
      height ??= 1 + ((bits >>> 14) & 0x3fff);
    }

    offset = end + (size % 2);
  }

  return { width, height, animated };
}

const response = await fetch(sourceUrl, {
  headers: { "User-Agent": "Stabilize-build/1.0" },
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) {
  throw new Error(`Mobile background download failed: HTTP ${response.status}`);
}
const image = Buffer.from(await response.arrayBuffer());
if (image.byteLength < 100_000 || image.byteLength > 5_000_000) {
  throw new Error(`Unexpected mobile background size: ${image.byteLength} bytes`);
}
const info = webpInfo(image);
if (info.width !== 853 || info.height !== 1844 || info.animated) {
  throw new Error(
    `Unexpected mobile background: ${info.width}x${info.height}, animated=${info.animated}`,
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
  throw new Error("New mobile background reference was not installed");
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
  `Installed mobile background: ${info.width}x${info.height}, ${image.byteLength} bytes`,
);
