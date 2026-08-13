import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

const VERSION = "20260813-mobile-hd-v35-1";
const HEVC_ASSET =
  "/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4";
const H264_ASSET =
  "/scenes/mobile-forest-stream-video-v35-h264-1080.mp4";
const SOURCE_ASSET =
  "/scenes/mobile-forest-stream-video-v24-native-1080.mp4";
const QUALITY = "native-video-1080x1920-30fps";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

test("mobile HD v35 favors spatial detail and preserves automatic muted playback", async () => {
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
      new URL("../scripts/mobile-hd-v35.json", import.meta.url),
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
        "../public/scenes/mobile-forest-stream-video-v35-h264-1080.mp4",
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
      new URL("../scripts/build-mobile-hd-v35.sh", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/finalize-mobile-hd-v35.mjs", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../.github/workflows/verify-mobile-video.yml", import.meta.url),
      "utf8",
    ),
    readFile(
      new URL("../scripts/verify-mobile-hd-v35.yml", import.meta.url),
      "utf8",
    ),
  ]);

  const metadata = JSON.parse(metadataSource);
  assert.equal(metadata.version, VERSION);
  assert.equal(metadata.hevcAsset, HEVC_ASSET);
  assert.equal(metadata.h264Asset, H264_ASSET);
  assert.equal(metadata.sourceAsset, SOURCE_ASSET);
  assert.equal(metadata.width, 1080);
  assert.equal(metadata.height, 1920);
  assert.equal(metadata.fps, 30);
  assert.equal(metadata.hevcCodec, "hevc");
  assert.equal(metadata.hevcCodecTag, "hvc1");
  assert.equal(metadata.hevcProfile, "Main");
  assert.equal(metadata.h264Codec, "h264");
  assert.equal(metadata.h264CodecTag, "avc1");
  assert.equal(metadata.h264Profile, "High");
  assert.equal(metadata.pixelFormat, "yuv420p");
  assert.equal(metadata.quality, QUALITY);
  assert.equal(metadata.hevcBytes, hevc.byteLength);
  assert.equal(metadata.hevcSha256, sha256(hevc));
  assert.equal(metadata.h264Bytes, h264.byteLength);
  assert.equal(metadata.h264Sha256, sha256(h264));
  assert.equal(metadata.sourceBytes, source.byteLength);
  assert.equal(metadata.sourceSha256, sha256(source));
  assert.ok(hevc.byteLength > 1_000_000);
  assert.ok(hevc.byteLength < 8_000_000);
  assert.ok(h264.byteLength > 1_500_000);
  assert.ok(h264.byteLength < 12_000_000);
  assert.ok(metadata.hevcBitRate > 0);
  assert.ok(metadata.h264BitRate > 0);

  assert.equal(hevc.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "vide", "hvc1"]) {
    assert.ok(hevc.includes(Buffer.from(marker, "ascii")), marker);
  }
  assert.equal(hevc.includes(Buffer.from("mp4a", "ascii")), false);
  assert.equal(hevc.includes(Buffer.from("soun", "ascii")), false);
  assert.ok(hevc.indexOf(Buffer.from("moov")) < hevc.indexOf(Buffer.from("mdat")));

  assert.equal(h264.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "vide", "avc1"]) {
    assert.ok(h264.includes(Buffer.from(marker, "ascii")), marker);
  }
  assert.equal(h264.includes(Buffer.from("mp4a", "ascii")), false);
  assert.equal(h264.includes(Buffer.from("soun", "ascii")), false);
  assert.ok(h264.indexOf(Buffer.from("moov")) < h264.indexOf(Buffer.from("mdat")));

  const videoBlock = page.match(
    /<video\n\s+id="mobile-background-video"[\s\S]*?<\/video>/,
  )?.[0];
  assert.ok(videoBlock);
  assert.equal(videoBlock.split("<source").length - 1, 2);
  assert.match(videoBlock, /autoplay/);
  assert.match(videoBlock, /muted/);
  assert.match(videoBlock, /playsinline/);
  assert.match(videoBlock, /webkit-playsinline/);
  assert.match(videoBlock, /preload="auto"/);
  assert.match(videoBlock, /data-codec="hevc"/);
  assert.match(videoBlock, /data-codec="h264"/);
  assert.match(videoBlock, /codecs="hvc1"/);
  assert.match(videoBlock, /codecs="avc1\.640028"/);
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
  assert.match(client, /const QUALITY = "native-video-1080x1920-30fps"/);
  assert.match(client, /video\.autoplay = true/);
  assert.match(client, /video\.muted = true/);
  assert.match(client, /video\.defaultMuted = true/);
  assert.match(client, /video\.playsInline = true/);
  assert.match(client, /video\.play\(\)/);
  assert.match(client, /mobile-hd-v35-parser-source-static/);
  assert.match(client, /mobile-hd-v35-quality-start/);
  assert.match(client, /video\.videoWidth < 1000/);
  assert.match(client, /video\.videoHeight < 1800/);
  const configure = client.match(
    /function configureVideo\(\) \{[\s\S]*?\n  \}\n\n  function keepFallbackVisible/,
  )?.[0];
  assert.ok(configure);
  assert.match(configure, /parserSourcesReady/);
  assert.doesNotMatch(configure, /video\.load\(/);
  assert.doesNotMatch(configure, /ensureSource\(/);
  assert.doesNotMatch(configure, /\.append\(/);
  assert.doesNotMatch(configure, /insertBefore\(/);
  assert.doesNotMatch(configure, /\.src\s*=/);

  const headerBlock = headers.match(
    /# mobile-hd-v35-start[\s\S]*?# mobile-hd-v35-end/,
  )?.[0];
  assert.ok(headerBlock);
  assert.match(headerBlock, /mobile-forest-stream-video-v35-hevc-1080\.mp4/);
  assert.match(headerBlock, /mobile-forest-stream-video-v35-h264-1080\.mp4/);
  assert.equal(
    headerBlock.match(/Cache-Control: public, max-age=31536000, immutable/g)
      ?.length,
    2,
  );

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-mobile-smooth-v32\.mjs && node scripts\/finalize-mobile-hevc-v34\.mjs && node scripts\/finalize-mobile-hd-v35\.mjs && node scripts\/embed-favicon-fallback\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-hd-v35\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-hevc-v34\.test\.mjs/);
  assert.doesNotMatch(packageJson.scripts["test:node"], /mobile-smooth-v32\.test\.mjs/);

  assert.equal(workflow, workflowTemplate);
  assert.match(workflow, /Verify mobile HD autoplay v35/);
  assert.match(workflow, /codec_tag_string/);
  assert.match(workflow, /hvc1/);
  assert.match(workflow, /avc1/);
  assert.match(workflow, /range_status.*200.*206|200.*206.*range_status/s);

  assert.match(builder, /scale=1080:1920/);
  assert.match(builder, /minterpolate=fps=30/);
  assert.match(builder, /-c:v libx265/);
  assert.match(builder, /-tag:v hvc1/);
  assert.match(builder, /-c:v libx264/);
  assert.match(builder, /-profile:v high/);
  assert.match(builder, /-movflags \+faststart/);
  assert.match(finalizer, /1080p HEVC must be the first parser-visible video source/);
  assert.match(finalizer, /mobile-hd-v35-parser-source-static/);
  assert.match(finalizer, /no initial media reset before autoplay/);
});
