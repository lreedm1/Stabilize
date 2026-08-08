import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const assets = [
  {
    label: "mobile forest poster",
    payloadDirectory: "materialize/mobile-forest-stream",
    outputPath: "public/scenes/mobile-forest-stream-v1-540.webp",
    expectedBytes: 91_750,
    expectedSha256:
      "e2396c2f73018151c20f99130ebdde75a85db6248ed5459ea0039f03e84eb23c",
    validate: validatePoster,
  },
  {
    label: "mobile forest video",
    payloadDirectory: "materialize/mobile-forest-stream-video",
    outputPath: "public/scenes/mobile-forest-stream-v1.mp4",
    expectedBytes: 116_072,
    expectedSha256:
      "bee409f9e2306931c7cfe813d2a5717c22215bd97189a689692ddad30c2ddf34",
    validate: validateVideo,
  },
];

function webpInfo(buffer) {
  if (
    buffer.byteLength < 12 ||
    buffer.subarray(0, 4).toString("ascii") !== "RIFF" ||
    buffer.subarray(8, 12).toString("ascii") !== "WEBP"
  ) {
    throw new Error("Mobile forest poster is not a WebP image");
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

function validatePoster(image) {
  const info = webpInfo(image);
  if (info.width !== 540 || info.height !== 960 || info.animated) {
    throw new Error(
      `Unexpected mobile forest poster: ${info.width}x${info.height}, animated=${info.animated}`,
    );
  }
  return `${info.width}x${info.height} static WebP`;
}

function validateVideo(video) {
  const markers = ["ftyp", "moov", "mdat", "avc1", "vide"];
  for (const marker of markers) {
    if (!video.includes(Buffer.from(marker, "ascii"))) {
      throw new Error(`Mobile forest video is missing the ${marker} marker`);
    }
  }

  const moovOffset = video.indexOf(Buffer.from("moov", "ascii"));
  const mdatOffset = video.indexOf(Buffer.from("mdat", "ascii"));
  if (moovOffset < 0 || mdatOffset < 0 || moovOffset > mdatOffset) {
    throw new Error("Mobile forest video is not optimized for fast start");
  }
  if (
    video.includes(Buffer.from("mp4a", "ascii")) ||
    video.includes(Buffer.from("soun", "ascii"))
  ) {
    throw new Error("Mobile forest background video must not contain audio");
  }

  return "320x568 H.264 MP4, fast-start, no audio";
}

async function materialize(asset) {
  const payloadFiles = (await readdir(asset.payloadDirectory))
    .filter((name) => /^\d{3}\.b64$/.test(name))
    .sort();
  if (!payloadFiles.length) {
    throw new Error(`${asset.label} payload chunks are missing`);
  }

  const encodedParts = await Promise.all(
    payloadFiles.map((name) =>
      readFile(`${asset.payloadDirectory}/${name}`, "utf8"),
    ),
  );
  const encoded = encodedParts.join("").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`${asset.label} payload is not valid base64 text`);
  }

  const output = Buffer.from(encoded, "base64");
  if (output.byteLength !== asset.expectedBytes) {
    throw new Error(
      `Unexpected ${asset.label} size: ${output.byteLength}; expected ${asset.expectedBytes}`,
    );
  }
  const actualSha256 = createHash("sha256").update(output).digest("hex");
  if (actualSha256 !== asset.expectedSha256) {
    throw new Error(`${asset.label} checksum mismatch: ${actualSha256}`);
  }

  const detail = asset.validate(output);
  await mkdir("public/scenes", { recursive: true });
  await writeFile(asset.outputPath, output);
  console.log(
    `Materialized ${asset.outputPath}: ${detail}, ${output.byteLength} bytes from ${payloadFiles.length} chunks`,
  );
}

for (const asset of assets) {
  await materialize(asset);
}
