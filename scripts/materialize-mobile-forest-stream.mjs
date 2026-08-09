import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const posterPayloadDirectory = "materialize/mobile-forest-stream";
const posterOutputPath = "public/scenes/mobile-forest-stream-v1-540.webp";
const expectedPosterBytes = 91_750;
const expectedPosterSha256 =
  "e2396c2f73018151c20f99130ebdde75a85db6248ed5459ea0039f03e84eb23c";

const videoPayloadDirectory =
  "materialize/mobile-forest-stream-video-1080-v4";
const videoOutputPath =
  "public/scenes/mobile-forest-stream-video-v4-1080.mp4";
const expectedVideoParts = 9;

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

async function readBase64Payload(directory, expectedCount = null) {
  const payloadFiles = (await readdir(directory))
    .filter((name) => /^\d{3}\.b64$/.test(name))
    .sort();

  if (!payloadFiles.length) {
    throw new Error(`Payload chunks are missing from ${directory}`);
  }

  if (expectedCount !== null) {
    const expectedNames = Array.from(
      { length: expectedCount },
      (_, index) => `${String(index).padStart(3, "0")}.b64`,
    );
    if (
      payloadFiles.length !== expectedNames.length ||
      payloadFiles.some((name, index) => name !== expectedNames[index])
    ) {
      throw new Error(
        `Expected ${expectedNames.join(", ")} in ${directory}; found ${payloadFiles.join(", ")}`,
      );
    }
  }

  const encodedParts = await Promise.all(
    payloadFiles.map((name) => readFile(`${directory}/${name}`, "utf8")),
  );
  const encoded = encodedParts.join("").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`Payload in ${directory} is not valid base64 text`);
  }

  return {
    payloadFiles,
    bytes: Buffer.from(encoded, "base64"),
  };
}

function validateVideo(video) {
  if (video.byteLength < 100_000) {
    throw new Error(
      `Mobile forest video is unexpectedly small: ${video.byteLength} bytes`,
    );
  }
  if (video.byteLength > 25_000_000) {
    throw new Error(
      `Mobile forest video is unexpectedly large: ${video.byteLength} bytes`,
    );
  }
  if (
    video.byteLength < 12 ||
    video.subarray(4, 8).toString("ascii") !== "ftyp"
  ) {
    throw new Error("Mobile forest video payload is not an MP4 file");
  }

  for (const marker of ["moov", "mdat", "vide", "avc1"]) {
    if (!video.includes(Buffer.from(marker, "ascii"))) {
      throw new Error(`Mobile forest video is missing the ${marker} marker`);
    }
  }

  const moovOffset = video.indexOf(Buffer.from("moov", "ascii"));
  const mdatOffset = video.indexOf(Buffer.from("mdat", "ascii"));
  return {
    fastStart: moovOffset >= 0 && mdatOffset >= 0 && moovOffset < mdatOffset,
    sha256: createHash("sha256").update(video).digest("hex"),
  };
}

const posterPayload = await readBase64Payload(posterPayloadDirectory);
const poster = posterPayload.bytes;
if (poster.byteLength !== expectedPosterBytes) {
  throw new Error(
    `Unexpected mobile forest image size: ${poster.byteLength}; expected ${expectedPosterBytes}`,
  );
}
const actualPosterSha256 = createHash("sha256")
  .update(poster)
  .digest("hex");
if (actualPosterSha256 !== expectedPosterSha256) {
  throw new Error(
    `Mobile forest payload checksum mismatch: ${actualPosterSha256}`,
  );
}

const posterInfo = webpInfo(poster);
if (
  posterInfo.width !== 540 ||
  posterInfo.height !== 960 ||
  posterInfo.animated
) {
  throw new Error(
    `Unexpected mobile forest image: ${posterInfo.width}x${posterInfo.height}, animated=${posterInfo.animated}`,
  );
}

await mkdir("public/scenes", { recursive: true });
await writeFile(posterOutputPath, poster);
console.log(
  `Materialized ${posterOutputPath}: ${posterInfo.width}x${posterInfo.height}, ${poster.byteLength} bytes from ${posterPayload.payloadFiles.length} chunks`,
);

const videoPayload = await readBase64Payload(
  videoPayloadDirectory,
  expectedVideoParts,
);
const videoInfo = validateVideo(videoPayload.bytes);
await writeFile(videoOutputPath, videoPayload.bytes);
console.log(
  `Materialized ${videoOutputPath}: ${videoPayload.bytes.byteLength} bytes from ${videoPayload.payloadFiles.length} chunks, sha256=${videoInfo.sha256}, fastStart=${videoInfo.fastStart}`,
);
