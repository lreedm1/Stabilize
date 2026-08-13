// Release gate: rerun after legacy mobile finalizer compatibility update.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERSION = "20260813-mobile-hevc-v35-1";
const HEVC_ASSET =
  "/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4";
const H264_ASSET =
  "/scenes/mobile-forest-stream-video-v24-native-1080.mp4";
const SHORT_PLACEHOLDER = "What needs attention?";
const LONG_PLACEHOLDER = "Start with what needs attention";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("mobile HEVC v35 raises visible resolution and shortens the composer prompt", async () => {
  const [
    page,
    client,
    headers,
    copy,
    uwChat,
    packageSource,
    metadataSource,
    hevc,
    h264,
    builder,
    finalizer,
    workflow,
    workflowTemplate,
  ] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(
      new URL("../public/mobile-video-handoff-v31.js", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../public/_headers", import.meta.url), "utf8"),
    readFile(new URL("../src/copy.js", import.meta.url), "utf8"),
    readFile(new URL("../src/uw-madison-chat.js", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/mobile-hevc-v35.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4",
        import.meta.url,
      ),
    ),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
        import.meta.url,
      ),
    ),
    readFile(
      new URL("../scripts/build-mobile-hevc-v35.sh", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/finalize-mobile-hevc-v35.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../.github/workflows/verify-mobile-video.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/verify-mobile-hevc-v35.yml", import.meta.url),
      "utf8",
    ),
  ]);

  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.version, VERSION);
  assert.equal(metadata.hevcAsset, HEVC_ASSET);
  assert.equal(metadata.h264Asset, H264_ASSET);
  assert.equal(metadata.sourceAsset, H264_ASSET);
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(metadata.fps, 60);
  assert.equal(metadata.fallbackWidth, 2160);
  assert.equal(metadata.fallbackHeight, 3840);
  assert.equal(metadata.fallbackFps, 24);
  assert.equal(metadata.codec, "hevc");
  assert.equal(metadata.codecTag, "hvc1");
  assert.equal(metadata.profile, "Main");
  assert.equal(metadata.pixelFormat, "yuv420p");
  assert.equal(metadata.quality, "native-video-hevc-1080x1920-60fps");
  assert.equal(
    metadata.fallbackQuality,
    "native-video-h264-2160x3840-24fps",
  );
  assert.equal(metadata.videoBytes, hevc.byteLength);
  assert.equal(metadata.videoSha256, sha256(hevc));
  assert.equal(metadata.sourceBytes, h264.byteLength);
  assert.equal(metadata.sourceSha256, sha256(h264));
  assert.ok(hevc.byteLength > 1_250_000);
  assert.ok(hevc.byteLength < 10_000_000);
  assert.ok(metadata.bitRate > 0);

  assert.equal(hevc.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "vide", "hvc1"]) {
    assert.ok(hevc.includes(Buffer.from(marker, "ascii")), marker);
  }
  assert.equal(hevc.includes(Buffer.from("mp4a", "ascii")), false);
  assert.equal(hevc.includes(Buffer.from("soun", "ascii")), false);
  assert.ok(hevc.indexOf(Buffer.from("moov")) < hevc.indexOf(Buffer.from("mdat")));

  assert.equal(h264.subarray(4, 8).toString("ascii"), "ftyp");
  assert.ok(h264.includes(Buffer.from("avc1", "ascii")));

  const videoBlock = page.match(
    /<video\n\s+id="mobile-background-video"[\s\S]*?<\/video>/,
  )?.[0];
  assert.ok(videoBlock);
  assert.equal(videoBlock.split("<source").length - 1, 2);
  assert.match(videoBlock, /data-codec="hevc"/);
  assert.match(videoBlock, /data-codec="h264"/);
  assert.match(videoBlock, /codecs="hvc1"/);
  assert.match(videoBlock, /codecs="avc1\.42E020"/);
  assert.doesNotMatch(videoBlock, /\/media\//);
  const hevcReference = `${HEVC_ASSET}?v=${VERSION}`;
  const h264Reference = `${H264_ASSET}?v=${VERSION}`;
  assert.ok(videoBlock.includes(hevcReference));
  assert.ok(videoBlock.includes(h264Reference));
  assert.ok(videoBlock.indexOf(hevcReference) < videoBlock.indexOf(h264Reference));
  assert.match(
    page,
    new RegExp(`/mobile-video-handoff-v31\\.js\\?v=${VERSION}`),
  );

  assert.match(client, new RegExp(`const VERSION = "${VERSION}"`));
  assert.match(client, /ensureSource\("hevc"/);
  assert.match(client, /ensureSource\("h264"/);
  assert.match(client, /mobile-forest-stream-video-v35-hevc-1080\.mp4/);
  assert.match(client, /mobile-forest-stream-video-v24-native-1080\.mp4/);
  assert.match(client, /native-video-hevc-1080x1920-60fps/);
  assert.match(client, /native-video-h264-2160x3840-24fps/);
  assert.match(client, /video\.videoWidth < 1000/);
  assert.match(client, /video\.videoHeight < 1800/);
  assert.match(client, /mobile-hevc-v35-quality-start/);

  for (const source of [copy, uwChat]) {
    assert.ok(source.includes(SHORT_PLACEHOLDER));
    assert.equal(source.includes(LONG_PLACEHOLDER), false);
  }

  const hevcHeaderBlock = headers.match(
    /# mobile-hevc-v35-start[\s\S]*?# mobile-hevc-v35-end/,
  )?.[0];
  assert.ok(hevcHeaderBlock);
  assert.match(hevcHeaderBlock, /mobile-forest-stream-video-v35-hevc-1080\.mp4/);
  assert.match(
    hevcHeaderBlock,
    /Cache-Control: public, max-age=31536000, immutable/,
  );

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-mobile-hevc-v34\.mjs && node scripts\/finalize-mobile-hevc-v35\.mjs && node scripts\/embed-favicon-fallback\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-hevc-v35\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-hevc-v34\.test\.mjs/);

  assert.equal(workflow, workflowTemplate);
  assert.match(workflow, /Verify mobile HEVC v35/);
  assert.match(workflow, /1080x1920/);
  assert.match(workflow, /What needs attention\?/);

  assert.match(builder, /scale=1080:1920/);
  assert.match(builder, /minterpolate=fps=60/);
  assert.match(builder, /-c:v libx265/);
  assert.match(builder, /-tag:v hvc1/);
  assert.match(builder, /-crf 16/);
  assert.match(builder, /-movflags \+faststart/);
  assert.match(finalizer, /1080x1920 HEVC/);
  assert.match(finalizer, /SHORT_PROMPT = "What needs attention\?"/);
});
