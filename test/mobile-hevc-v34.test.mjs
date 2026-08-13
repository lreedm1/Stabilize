import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERSION = "20260813-mobile-hevc-v34-1";
const HEVC_ASSET =
  "/scenes/mobile-forest-stream-video-v34-hevc-720.mp4";
const H264_ASSET =
  "/scenes/mobile-forest-stream-video-v12-720.mp4";
const SOURCE_ASSET =
  "/scenes/mobile-forest-stream-video-v24-native-1080.mp4";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("mobile HEVC v34 uses a high-quality direct static source with H.264 fallback", async () => {
  const [
    page,
    client,
    headers,
    packageSource,
    metadataSource,
    hevc,
    h264,
    source,
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
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/mobile-hevc-v34.json", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-video-v34-hevc-720.mp4",
        import.meta.url,
      ),
    ),
    readFile(
      new URL(
        "../public/scenes/mobile-forest-stream-video-v12-720.mp4",
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
      new URL("../scripts/build-mobile-hevc-v34.sh", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/finalize-mobile-hevc-v34.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../.github/workflows/verify-mobile-video.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/verify-mobile-hevc-v34.yml", import.meta.url),
      "utf8",
    ),
  ]);

  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.version, VERSION);
  assert.equal(metadata.hevcAsset, HEVC_ASSET);
  assert.equal(metadata.h264Asset, H264_ASSET);
  assert.equal(metadata.sourceAsset, SOURCE_ASSET);
  assert.equal(metadata.width, 720);
  assert.equal(metadata.height, 1280);
  assert.equal(metadata.fps, 60);
  assert.equal(metadata.codec, "hevc");
  assert.equal(metadata.codecTag, "hvc1");
  assert.equal(metadata.profile, "Main");
  assert.equal(metadata.pixelFormat, "yuv420p");
  assert.equal(metadata.quality, "native-video-hevc-720x1280-60fps");
  assert.equal(metadata.videoBytes, hevc.byteLength);
  assert.equal(metadata.videoSha256, sha256(hevc));
  assert.equal(metadata.sourceBytes, source.byteLength);
  assert.equal(metadata.sourceSha256, sha256(source));
  assert.ok(hevc.byteLength > 700_000);
  assert.ok(hevc.byteLength < 4_000_000);
  assert.ok(hevc.byteLength < source.byteLength);
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
  assert.match(client, /const HEVC_ASSET =/);
  assert.match(client, /const H264_ASSET =/);
  assert.match(client, /source\[data-codec="\$\{codec\}"\]/);
  assert.match(client, /ensureSource\("hevc"/);
  assert.match(client, /ensureSource\("h264"/);
  assert.match(client, /mobile-forest-stream-video-v34-hevc-720\.mp4/);
  assert.match(client, /native-video-hevc-720x1280-60fps/);
  assert.match(client, /mobileBackgroundV30Codec/);
  assert.match(client, /mobile-hevc-v34-quality-start/);
  const configure = client.match(
    /function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/,
  )?.[0];
  assert.ok(configure);
  assert.match(configure, /HEVC_ASSET/);
  assert.match(configure, /H264_ASSET/);
  assert.doesNotMatch(configure, /VIDEO_ASSET/);

  const hevcHeaderBlock = headers.match(
    /# mobile-hevc-v34-start[\s\S]*?# mobile-hevc-v34-end/,
  )?.[0];
  assert.ok(hevcHeaderBlock);
  assert.match(hevcHeaderBlock, /mobile-forest-stream-video-v34-hevc-720\.mp4/);
  assert.match(
    hevcHeaderBlock,
    /Cache-Control: public, max-age=31536000, immutable/,
  );
  assert.ok(
    headers.indexOf("# mobile-hevc-v34-start") <
      headers.indexOf("# canonical-favicon-start"),
  );

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-mobile-smooth-v32\.mjs && node scripts\/finalize-mobile-hevc-v34\.mjs && node scripts\/embed-favicon-fallback\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-hevc-v34\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-smooth-v32\.test\.mjs/);

  assert.equal(workflow, workflowTemplate);
  assert.match(workflow, /Verify mobile HEVC v34/);
  assert.match(workflow, /codec_tag_string/);
  assert.match(workflow, /hvc1/);
  assert.match(workflow, /direct static/);

  assert.match(builder, /mobile-forest-stream-video-v24-native-1080\.mp4/);
  assert.match(builder, /minterpolate=fps=60/);
  assert.match(builder, /-c:v libx265/);
  assert.match(builder, /-tag:v hvc1/);
  assert.match(builder, /-movflags \+faststart/);
  assert.match(finalizer, /HEVC must be the first parser-visible video source/);
  assert.match(finalizer, /mobile-hevc-v34-quality-start/);
  assert.match(finalizer, /no Worker buffering in the parser-visible sources/);
});
