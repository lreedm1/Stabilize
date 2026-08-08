import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const payloadDirectory = "materialize/mobile-forest-stream";
const outputPath = "public/scenes/mobile-forest-stream-v1-720.webp";

function webpInfo(buffer) {
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Mobile forest payload is not a WebP image");
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

const payloadFiles = (await readdir(payloadDirectory))
  .filter((name) => /^\d{3}\.b64$/.test(name))
  .sort();
if (!payloadFiles.length) {
  throw new Error("Mobile forest payload chunks are missing");
}

const encodedParts = await Promise.all(
  payloadFiles.map((name) =>
    readFile(`${payloadDirectory}/${name}`, "utf8"),
  ),
);
const encoded = encodedParts.join("").replace(/\s+/g, "");
if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
  throw new Error("Mobile forest payload is not valid base64 text");
}

const image = Buffer.from(encoded, "base64");
if (image.byteLength < 100_000 || image.byteLength > 500_000) {
  throw new Error(`Unexpected mobile forest image size: ${image.byteLength}`);
}

const info = webpInfo(image);
if (info.width !== 720 || info.height !== 1280 || info.animated) {
  throw new Error(
    `Unexpected mobile forest image: ${info.width}x${info.height}, animated=${info.animated}`,
  );
}

await mkdir("public/scenes", { recursive: true });
await writeFile(outputPath, image);
console.log(
  `Materialized ${outputPath}: ${info.width}x${info.height}, ${image.byteLength} bytes from ${payloadFiles.length} chunks`,
);
