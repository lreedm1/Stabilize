import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

const legacyPosterPayloadDirectory = "materialize/mobile-forest-stream";
const legacyPosterOutputPath = "public/scenes/mobile-forest-stream-v1-540.webp";
const expectedLegacyPosterBytes = 91_750;
const expectedLegacyPosterSha256 =
  "e2396c2f73018151c20f99130ebdde75a85db6248ed5459ea0039f03e84eb23c";

const screenPosterPath = "public/scenes/mobile-forest-stream-v11-1536.webp";
const expectedScreenPosterBytes = 356_158;
const expectedScreenPosterSha256 =
  "eec4340bb69bbbda9bba4dcd7b35102394a142e450be927b8995bb2d27908e52";
const videoPath = "public/scenes/mobile-forest-stream-video-v11-1536.mp4";
const expectedVideoBytes = 873_256;
const expectedVideoSha256 =
  "1a243cd34a1189aeebe54f7e2bcd3b18e61f8a5a26401233ac57dd359828c5d1";

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

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

async function readBase64Payload(directory) {
  const payloadFiles = (await readdir(directory))
    .filter((name) => /^\d{3}\.b64$/.test(name))
    .sort();
  if (!payloadFiles.length) {
    throw new Error(`Payload chunks are missing from ${directory}`);
  }
  const encodedParts = await Promise.all(
    payloadFiles.map((name) => readFile(`${directory}/${name}`, "utf8")),
  );
  const encoded = encodedParts.join("").replace(/\s+/g, "");
  if (!encoded || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) {
    throw new Error(`Payload in ${directory} is not valid base64 text`);
  }
  return { payloadFiles, bytes: Buffer.from(encoded, "base64") };
}

function validateVideo(buffer) {
  if (buffer.byteLength !== expectedVideoBytes) {
    throw new Error(
      `Unexpected mobile forest video size: ${buffer.byteLength}; expected ${expectedVideoBytes}`,
    );
  }
  const actualSha = sha256(buffer);
  if (actualSha !== expectedVideoSha256) {
    throw new Error(`Mobile forest video checksum mismatch: ${actualSha}`);
  }
  if (buffer.byteLength < 12 || buffer.subarray(4, 8).toString("ascii") !== "ftyp") {
    throw new Error("Mobile forest video is not an MP4 file");
  }
  for (const marker of ["moov", "mdat", "vide", "avc1"]) {
    if (!buffer.includes(Buffer.from(marker, "ascii"))) {
      throw new Error(`Mobile forest video is missing the ${marker} marker`);
    }
  }
  const moovOffset = buffer.indexOf(Buffer.from("moov", "ascii"));
  const mdatOffset = buffer.indexOf(Buffer.from("mdat", "ascii"));
  if (moovOffset < 0 || mdatOffset < 0 || moovOffset > mdatOffset) {
    throw new Error("Mobile forest video is not optimized for fast start");
  }
  if (buffer.includes(Buffer.from("mp4a", "ascii")) || buffer.includes(Buffer.from("soun", "ascii"))) {
    throw new Error("Mobile forest background video must not contain audio");
  }
  return actualSha;
}

const legacyPayload = await readBase64Payload(legacyPosterPayloadDirectory);
if (legacyPayload.bytes.byteLength !== expectedLegacyPosterBytes) {
  throw new Error(
    `Unexpected legacy mobile poster size: ${legacyPayload.bytes.byteLength}`,
  );
}
if (sha256(legacyPayload.bytes) !== expectedLegacyPosterSha256) {
  throw new Error("Legacy mobile poster checksum mismatch");
}
const legacyInfo = webpInfo(legacyPayload.bytes);
if (legacyInfo.width !== 540 || legacyInfo.height !== 960 || legacyInfo.animated) {
  throw new Error(
    `Unexpected legacy mobile poster: ${legacyInfo.width}x${legacyInfo.height}, animated=${legacyInfo.animated}`,
  );
}
await mkdir("public/scenes", { recursive: true });
await writeFile(legacyPosterOutputPath, legacyPayload.bytes);

const screenPoster = await readFile(screenPosterPath);
if (screenPoster.byteLength !== expectedScreenPosterBytes) {
  throw new Error(
    `Unexpected screen-resolution poster size: ${screenPoster.byteLength}; expected ${expectedScreenPosterBytes}`,
  );
}
const actualScreenPosterSha = sha256(screenPoster);
if (actualScreenPosterSha !== expectedScreenPosterSha256) {
  throw new Error(
    `Screen-resolution poster checksum mismatch: ${actualScreenPosterSha}`,
  );
}
const screenPosterInfo = webpInfo(screenPoster);
if (
  screenPosterInfo.width !== 1536 ||
  screenPosterInfo.height !== 2732 ||
  screenPosterInfo.animated
) {
  throw new Error(
    `Unexpected screen-resolution poster: ${screenPosterInfo.width}x${screenPosterInfo.height}, animated=${screenPosterInfo.animated}`,
  );
}

const mobileVideo = await readFile(videoPath);
const actualVideoSha = validateVideo(mobileVideo);
console.log(
  `Validated ${videoPath}: 1536x2732, ${mobileVideo.byteLength} bytes, sha256=${actualVideoSha}, strict frame decoding is enforced in CI`,
);
