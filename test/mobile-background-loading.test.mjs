import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("mobile clients keep the static image without loading the graphics module chain", async () => {
  const [appSource, loaderSource, pageSource, packageSource] =
    await Promise.all([
      read("public/app.js"),
      read("public/background-loader.js"),
      read("src/page.js"),
      read("package.json"),
    ]);

  assert.doesNotMatch(
    appSource,
    /import \{ modulateTerrain \} from "\.\/terrain\.js"/,
  );
  assert.match(
    appSource,
    /import \{ modulateTerrain \} from "\.\/background-loader\.js\?v=20260807-priority-latency-1"/,
  );
  assert.doesNotMatch(
    loaderSource,
    /from ["']\.\/(?:terrain|photo-scene)\.js["']/,
  );
  assert.match(loaderSource, /import\("\.\/terrain\.js"\)/);
  assert.match(
    loaderSource,
    /\(max-width: 980px\) and \(orientation: portrait\)/,
  );
  assert.match(loaderSource, /\(hover: none\) and \(pointer: coarse\)/);
  assert.match(loaderSource, /prefers-reduced-motion: reduce/);
  assert.match(loaderSource, /navigator\?\.connection\?\.saveData/);
  assert.match(loaderSource, /requestIdleCallback/);
  assert.match(loaderSource, /let modulationScheduled = false/);
  assert.match(loaderSource, /function scheduleTerrainModulation\(\)/);
  assert.match(loaderSource, /requestAnimationFrame\(runAfterPaint\)/);
  assert.match(loaderSource, /setTimeout\(applyLatestTerrainValue, 0\)/);
  assert.match(
    loaderSource,
    /export function modulateTerrain\(value\) \{[\s\S]*scheduleTerrainModulation\(\);[\s\S]*return null;/,
  );
  assert.match(pageSource, /\/app\.js\?v=20260808-full-guest-thread-1/);

  const config = JSON.parse(packageSource);
  assert.equal(
    config.scripts["apply:prompt-policy"],
    "node scripts/prepare-signed-in-latency-v2.mjs && node scripts/apply-priority-latency.mjs && node scripts/prepare-gpt56-fast-generators.mjs && node scripts/prepare-decision-grade-impact.mjs && node scripts/add-memory-deletion-and-guest-session.mjs && node scripts/finalize-memory-controls.mjs && node scripts/apply-signed-in-latency-v2.mjs && node scripts/align-signed-in-latency-v2.mjs && node scripts/finalize-signed-in-latency-v2.mjs && node scripts/apply-gpt56-fast-runtime.mjs && node scripts/apply-gpt56-fast-copy.mjs && node scripts/apply-gpt56-fast-node-tests.mjs && node scripts/apply-gpt56-fast-model-usage-test.mjs && node scripts/apply-gpt56-fast-paid-worker-test.mjs && node scripts/apply-gpt56-fast-priority-worker-test.mjs && node scripts/apply-signed-in-prefetch-latency.mjs && node scripts/finalize-signed-in-prefetch-tests.mjs && node scripts/prepare-full-guest-cache-version.mjs && node scripts/remember-full-guest-conversation.mjs && node scripts/finalize-full-guest-conversation.mjs && node scripts/prepare-client-response-time.mjs && node scripts/materialize-mobile-forest-stream.mjs && node scripts/use-mobile-forest-stream.mjs && node scripts/apply-decision-grade-impact.mjs && node scripts/apply-client-response-time.mjs && node scripts/finalize-decision-grade-impact.mjs",
  );

  const loader = await import(
    `${new URL("../public/background-loader.js", import.meta.url).href}?test=static-mobile`
  );
  const staticMobile = {
    matchMedia: () => ({ matches: true }),
    navigator: { connection: { saveData: false } },
  };
  const desktop = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: false } },
  };
  const dataSaver = {
    matchMedia: () => ({ matches: false }),
    navigator: { connection: { saveData: true } },
  };

  assert.equal(loader.shouldLoadInteractiveBackground(staticMobile), false);
  assert.equal(loader.shouldLoadInteractiveBackground(desktop), true);
  assert.equal(loader.shouldLoadInteractiveBackground(dataSaver), false);
});

test("the production mobile release gate follows built versions and exact image bytes", async () => {
  const workflow = await read(
    ".github/workflows/verify-mobile-background.yml",
  );

  assert.doesNotMatch(workflow, /defer-mobile-background\.mjs/);
  assert.doesNotMatch(workflow, /asset_version=/);
  assert.ok(
    workflow.includes(
      "grep -oE '/app\\.js\\?v=[A-Za-z0-9._-]+' src/page.js",
    ),
  );
  assert.ok(
    workflow.includes(
      "grep -oE 'background-loader\\.js\\?v=[A-Za-z0-9._-]+' public/app.js",
    ),
  );
  assert.ok(workflow.includes("scripts/use-mobile-forest-stream.mjs"));
  assert.ok(workflow.includes('sha256sum "$expected_mobile_file"'));
  assert.ok(workflow.includes('wc -c < "$expected_mobile_file"'));
  assert.ok(workflow.includes('live_mobile_sha'));
  assert.ok(workflow.includes('live_mobile_bytes'));
  assert.ok(workflow.includes('live_mobile_type'));
  assert.ok(
    workflow.includes("Exact forest-stream mobile release is live"),
  );
});

test("portrait mobile uses a direct same-origin MP4 instead of a reconstructed blob", async () => {
  const [clientSource, materializerSource, headersSource, video] =
    await Promise.all([
      read("public/mobile-quality.js"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      read("public/_headers"),
      readFile(
        new URL(
          "../public/scenes/mobile-forest-stream-video-v4-1080.mp4",
          import.meta.url,
        ),
      ),
    ]);

  assert.match(
    clientSource,
    /const VIDEO_ASSET =[\s\S]*mobile-forest-stream-video-v4-1080\.mp4/,
  );
  assert.match(clientSource, /video\.src = VIDEO_ASSET/);
  assert.match(clientSource, /video\.autoplay = true/);
  assert.match(clientSource, /video\.muted = true/);
  assert.match(clientSource, /video\.defaultMuted = true/);
  assert.match(clientSource, /video\.loop = true/);
  assert.match(clientSource, /video\.playsInline = true/);
  assert.match(clientSource, /function resumeAfterGesture\(\)/);
  assert.doesNotMatch(clientSource, /URL\.createObjectURL|new Blob|atob\(/);

  assert.match(
    materializerSource,
    /materialize\/mobile-forest-stream-video-1080-v4/,
  );
  assert.match(
    materializerSource,
    /public\/scenes\/mobile-forest-stream-video-v4-1080\.mp4/,
  );
  assert.match(
    headersSource,
    /\/scenes\/mobile-forest-stream-video-v4-1080\.mp4[\s\S]*Content-Type: video\/mp4/,
  );

  assert.ok(video.byteLength > 1_000_000);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
});
