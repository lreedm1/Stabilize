import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const VERSION = "20260813-mobile-video-handoff-v31-1";

test("mobile video is parser-loaded and first-touch playback remains synchronous", async () => {
  const [page, client, finalizer, packageSource] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-video-handoff-v31.js", import.meta.url), "utf8"),
    readFile(
      new URL("../scripts/finalize-mobile-video-handoff-v31.mjs", import.meta.url),
      "utf8",
    ),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);

  assert.match(
    page,
    /id="mobile-background-video"[\s\S]*autoplay[\s\S]*muted[\s\S]*playsinline[\s\S]*preload="auto"/,
  );
  assert.match(
    page,
    new RegExp(
      `/media/mobile-forest-stream-video-v24-native-1080\\.mp4\\?v=${VERSION}`,
    ),
  );
  assert.match(
    page,
    new RegExp(`/mobile-video-handoff-v31\\.js\\?v=${VERSION}`),
  );
  assert.doesNotMatch(
    page,
    /id="mobile-background-video"[\s\S]{0,500}data-src=/,
  );

  assert.match(client, /function playInsideUserGesture\(\)/);
  const gestureFunction = client.match(
    /function playInsideUserGesture\(\) \{[\s\S]*?\n  \}/,
  )?.[0];
  assert.ok(gestureFunction);
  assert.match(gestureFunction, /video\.play\(\)/);
  assert.doesNotMatch(gestureFunction, /await|setTimeout|requestAnimationFrame/);
  assert.match(client, /requestVideoFrameCallback/);
  assert.match(client, /native-video-2160x3840-24fps/);
  assert.match(client, /video\.videoWidth < 2000/);
  assert.match(
    client,
    /video\.style\.setProperty\("opacity", "1", "important"\)/,
  );
  assert.match(
    client,
    /canvas\.style\.setProperty\("opacity", "0", "important"\)/,
  );
  assert.match(client, /pointerdown/);
  assert.match(client, /touchstart/);

  const packageJson = JSON.parse(packageSource);
  assert.match(
    packageJson.scripts["apply:prompt-policy"],
    /finalize-mobile-video-handoff-v31\.mjs$/,
  );
  assert.match(packageJson.scripts["test:node"], /mobile-video-handoff-v31/);
  assert.match(finalizer, /preload="auto"/);
  assert.match(finalizer, /<source/);
});
