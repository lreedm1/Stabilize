import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const VIDEO_ASSET = "/scenes/mobile-forest-stream-loop-v1.mp4";
const POSTER_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";
const VERSION = "20260808-mobile-video-1";
const EXPECTED_VIDEO_BYTES = 602_638;
const EXPECTED_VIDEO_SHA256 =
  "e5d824a487d3d423c5a6e70d84b45dbc2cee7afcbd3b618db0446ff002054e16";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceTestBlock(source, startMarkers, endMarker, replacement, label) {
  const starts = startMarkers
    .map((marker) => source.indexOf(marker))
    .filter((index) => index >= 0);
  const start = starts.length ? Math.min(...starts) : -1;
  const end = source.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Mobile video could not find ${label}`);
  }
  return source.slice(0, start) + replacement + source.slice(end);
}

const video = await readFile(`public${VIDEO_ASSET}`);
const actualVideoSha256 = createHash("sha256").update(video).digest("hex");
if (video.byteLength !== EXPECTED_VIDEO_BYTES) {
  throw new Error(
    `Unexpected mobile video size: ${video.byteLength}; expected ${EXPECTED_VIDEO_BYTES}`,
  );
}
if (actualVideoSha256 !== EXPECTED_VIDEO_SHA256) {
  throw new Error(`Mobile video checksum mismatch: ${actualVideoSha256}`);
}
if (
  video.byteLength < 12 ||
  video.subarray(4, 8).toString("ascii") !== "ftyp"
) {
  throw new Error("Mobile forest video is not an MP4 file");
}

const videoBlock = `    <video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="${POSTER_ASSET}"
      disablepictureinpicture
      disableremoteplayback
      aria-hidden="true"
    >
      <source src="${VIDEO_ASSET}" type="video/mp4" />
    </video>
`;

await update("src/page.js", (source) => {
  let next = source;
  const existingVideo = /    <video\n      id="mobile-background-video"[\s\S]*?    <\/video>\n/;
  if (existingVideo.test(next)) {
    next = next.replace(existingVideo, videoBlock);
  } else {
    const pictureEnd = /    <\/picture>\n(?=    <canvas\n      id="photo-background")/;
    if (!pictureEnd.test(next)) {
      throw new Error("Mobile video could not find the photo backdrop insertion point");
    }
    next = next.replace(pictureEnd, `    </picture>\n${videoBlock}`);
  }
  next = next.replace(
    /mobile-woodland-loop\.css\?v=[^"]+/,
    `mobile-woodland-loop.css?v=${VERSION}`,
  );
  next = next.replace(
    /mobile-quality\.js\?v=[^"]+/,
    `mobile-quality.js?v=${VERSION}`,
  );
  if (!next.includes(`src="${VIDEO_ASSET}" type="video/mp4"`)) {
    throw new Error("Mobile video source was not installed in the page");
  }
  return next;
});

const mobileStyles = `.mobile-background-video {
  display: none;
}

@media (max-width: 980px) and (orientation: portrait) {
  .photo-backdrop {
    overflow: hidden;
    background: #173f31;
    filter: none;
    transform: none;
    animation: none;
    opacity: 1;
    transition: opacity 220ms ease;
    will-change: opacity;
  }

  .photo-backdrop.is-video-playing {
    opacity: 0;
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

  .mobile-background-video {
    position: fixed;
    z-index: 0;
    inset: 0;
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    object-position: 50% 50%;
    opacity: 0;
    background: #173f31;
    pointer-events: none;
    user-select: none;
    transition: opacity 220ms ease;
    will-change: opacity;
  }

  .mobile-background-video.is-playing {
    opacity: 1;
  }

  .photo-background {
    display: none;
  }
}
`;
await writeFile("public/mobile-woodland-loop.css", mobileStyles, "utf8");

const mobilePlayback = `const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);

const video = document.querySelector("#mobile-background-video");
const backdrop = document.querySelector("#photo-backdrop");
const terrain = document.querySelector("#terrain-background");

if (video instanceof HTMLVideoElement) {
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
  video.setAttribute("playsinline", "");

  const showPoster = (state = "poster") => {
    video.classList.remove("is-playing");
    backdrop?.classList.remove("is-video-playing");
    document.documentElement.dataset.mobileBackground = state;
  };

  const markPlaying = () => {
    if (!mobilePortrait?.matches) return;
    video.classList.add("is-playing");
    backdrop?.classList.add("is-video-playing");
    terrain?.classList.add("is-photo-ready");
    document.documentElement.dataset.mobileBackground = "video-playing";
  };

  const startVideo = async () => {
    if (!mobilePortrait?.matches || document.hidden) return;
    try {
      const result = video.play();
      if (result && typeof result.then === "function") await result;
      if (!video.paused) markPlaying();
    } catch {
      showPoster("video-awaiting-gesture");
    }
  };

  const stopVideo = () => {
    video.pause();
    showPoster("poster");
  };

  video.addEventListener("playing", markPlaying);
  video.addEventListener("loadeddata", () => void startVideo(), { once: true });
  video.addEventListener("error", () => showPoster("video-failed"));

  mobilePortrait?.addEventListener?.("change", (event) => {
    if (event.matches) void startVideo();
    else stopVideo();
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) void startVideo();
  });
  window.addEventListener("pageshow", () => void startVideo());

  const resumeAfterGesture = () => void startVideo();
  for (const eventName of ["pointerdown", "touchstart", "keydown"]) {
    window.addEventListener(eventName, resumeAfterGesture, {
      once: true,
      passive: true,
    });
  }

  if (mobilePortrait?.matches) {
    document.documentElement.dataset.mobileBackground = "video-loading";
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      void startVideo();
    }
  }
}
`;
await writeFile("public/mobile-quality.js", mobilePlayback, "utf8");

await update("public/_headers", (source) => {
  const block = `\n${VIDEO_ASSET}\n  Cache-Control: public, max-age=31536000, immutable\n\n${POSTER_ASSET}\n  Cache-Control: public, max-age=31536000, immutable\n`;
  let next = source.replace(
    new RegExp(`\\n${VIDEO_ASSET.replaceAll("/", "\\/")}\\n  Cache-Control:[^\\n]+\\n`, "g"),
    "\n",
  );
  next = next.replace(
    new RegExp(`\\n${POSTER_ASSET.replaceAll("/", "\\/")}\\n  Cache-Control:[^\\n]+\\n`, "g"),
    "\n",
  );
  const fontMarker = "\n/fonts/*\n";
  if (!next.includes(fontMarker)) {
    throw new Error("Mobile video could not find the static asset header marker");
  }
  return next.replace(fontMarker, `${block}${fontMarker}`);
});

await update("scripts/use-mobile-forest-stream.mjs", (source) => {
  const marker =
    '    \'test("mobile uses the uploaded MP4 as its muted looping portrait background", async () => {\',';
  if (source.includes(marker)) return source;
  const insertion =
    '    \'test("mobile uses the project-owner forest stream as its static portrait background", async () => {\',';
  if (!source.includes(insertion)) {
    throw new Error("Mobile video could not extend the mobile-test candidate list");
  }
  return source.replace(insertion, `${insertion}\n${marker}`);
});

const mobileVideoTest = String.raw`test("mobile uses the uploaded MP4 as its muted looping portrait background", async () => {
  const [pageSource, mobileStyles, playbackSource, video] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
    readFile(new URL(
      "../public/scenes/mobile-forest-stream-loop-v1.mp4",
      import.meta.url,
    )),
  ]);

  assert.equal(video.byteLength, 602_638);
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  assert.equal(
    createHash("sha256").update(video).digest("hex"),
    "e5d824a487d3d423c5a6e70d84b45dbc2cee7afcbd3b618db0446ff002054e16",
  );
  assert.match(pageSource, /id="mobile-background-video"/);
  assert.match(pageSource, /autoplay[\s\S]*muted[\s\S]*loop[\s\S]*playsinline/);
  assert.match(
    pageSource,
    /poster="\/scenes\/mobile-forest-stream-v1-540\.webp"/,
  );
  assert.match(
    pageSource,
    /src="\/scenes\/mobile-forest-stream-loop-v1\.mp4" type="video\/mp4"/,
  );
  assert.match(
    pageSource,
    /mobile-quality\.js\?v=20260808-mobile-video-1/,
  );
  assert.match(mobileStyles, /\.mobile-background-video\.is-playing/);
  assert.match(mobileStyles, /object-fit:\s*cover/);
  assert.match(playbackSource, /video\.defaultMuted = true/);
  assert.match(playbackSource, /video\.play\(\)/);
  assert.match(playbackSource, /video-awaiting-gesture/);
  assert.match(playbackSource, /"pointerdown", "touchstart", "keydown"/);
});

`;

await update("test/mobile-quality.test.mjs", (source) => {
  let next = source;
  if (!next.includes('from "node:crypto"')) {
    next = next.replace(
      'import test from "node:test";\n',
      'import test from "node:test";\nimport { createHash } from "node:crypto";\n',
    );
  }
  return replaceTestBlock(
    next,
    [
      'test("mobile uses responsive high-DPI static generated WebPs", async () => {',
      'test("mobile uses the project-owner forest stream as its static portrait background", async () => {',
      'test("mobile uses the uploaded MP4 as its muted looping portrait background", async () => {',
    ],
    'test("restored tabs recover from interrupted blank thinking views", async () => {',
    mobileVideoTest,
    "the mobile quality test block",
  );
});

const releaseGateTest = String.raw`test("the production mobile release gate verifies the exact uploaded video", async () => {
  const workflow = await read(
    ".github/workflows/verify-mobile-background.yml",
  );

  assert.ok(workflow.includes("mobile-forest-stream-loop-v1.mp4"));
  assert.ok(workflow.includes("video/mp4"));
  assert.ok(workflow.includes('sha256sum "$expected_video_file"'));
  assert.ok(workflow.includes('wc -c < "$expected_video_file"'));
  assert.ok(workflow.includes("live_video_sha"));
  assert.ok(workflow.includes("live_video_bytes"));
  assert.ok(workflow.includes('id="mobile-background-video"'));
  assert.ok(workflow.includes("Exact mobile forest video release is live"));
});
`;
await update("test/mobile-background-loading.test.mjs", (source) => {
  const marker =
    'test("the production mobile release gate follows built versions and exact image bytes", async () => {';
  const videoMarker =
    'test("the production mobile release gate verifies the exact uploaded video", async () => {';
  const start = source.includes(videoMarker)
    ? source.indexOf(videoMarker)
    : source.indexOf(marker);
  if (start < 0) {
    throw new Error("Mobile video could not find the release-gate test");
  }
  return source.slice(0, start) + releaseGateTest;
});

const workflow = `name: Verify mobile video background release

on:
  push:
    branches:
      - main
  workflow_dispatch:

concurrency:
  group: verify-mobile-video-background-\${{ github.ref }}
  cancel-in-progress: true

permissions:
  contents: read
  statuses: write

jobs:
  verify-mobile-video-background:
    name: Verify exact mobile video background
    runs-on: ubuntu-latest
    timeout-minutes: 12

    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Verify the exact mobile video release is live
        shell: bash
        env:
          GH_TOKEN: \${{ github.token }}
        run: |
          set -euo pipefail

          expected_video_asset="${VIDEO_ASSET}"
          expected_video_file="public\${expected_video_asset}"
          expected_poster_asset="${POSTER_ASSET}"
          expected_script_path="/mobile-quality.js?v=${VERSION}"

          expected_video_sha="$(sha256sum "$expected_video_file" | awk '{print $1}')"
          expected_video_bytes="$(wc -c < "$expected_video_file" | tr -d '[:space:]')"

          publish_status() {
            local state="$1"
            local description="$2"
            local payload
            payload="$(printf '{"state":"%s","context":"verification/mobile-video-background","description":"%s","target_url":"%s/%s/actions/runs/%s"}' \\
              "$state" "$description" "$GITHUB_SERVER_URL" "$GITHUB_REPOSITORY" "$GITHUB_RUN_ID")"
            curl --fail-with-body --silent --show-error \\
              --request POST \\
              --header "Accept: application/vnd.github+json" \\
              --header "Authorization: Bearer \${GH_TOKEN}" \\
              --header "X-GitHub-Api-Version: 2022-11-28" \\
              --data "$payload" \\
              "https://api.github.com/repos/\${GITHUB_REPOSITORY}/statuses/\${GITHUB_SHA}"
          }

          tmpdir="$(mktemp -d)"
          trap 'rm -rf "$tmpdir"' EXIT
          publish_status pending "Waiting for the exact mobile forest video release"

          for attempt in {1..36}; do
            cache_key="\${GITHUB_SHA}-\${attempt}"
            html_status="$(curl --max-time 20 --silent --show-error \\
              --header 'Cache-Control: no-cache' \\
              --output "$tmpdir/live.html" --write-out '%{http_code}' \\
              "https://stabilize.info/?mobile-video-release=\${cache_key}" || true)"
            script_status="$(curl --max-time 20 --silent --show-error \\
              --header 'Cache-Control: no-cache' \\
              --output "$tmpdir/mobile-quality.js" --write-out '%{http_code}' \\
              "https://stabilize.info\${expected_script_path}&release=\${cache_key}" || true)"
            video_status="$(curl --max-time 30 --silent --show-error \\
              --header 'Cache-Control: no-cache' \\
              --dump-header "$tmpdir/video.headers" \\
              --output "$tmpdir/video.mp4" --write-out '%{http_code}' \\
              "https://stabilize.info\${expected_video_asset}?release=\${cache_key}" || true)"

            live_video_bytes="$(wc -c < "$tmpdir/video.mp4" | tr -d '[:space:]')"
            live_video_sha="$(sha256sum "$tmpdir/video.mp4" | awk '{print $1}')"
            live_video_type="$(awk -F': ' 'tolower($1) == "content-type" { gsub("\\r", "", $2); print tolower($2) }' "$tmpdir/video.headers" | tail -n 1 || true)"

            echo "Mobile video attempt \${attempt}: html=\${html_status:-000} script=\${script_status:-000} video=\${video_status:-000}; bytes=\${live_video_bytes:-0}; sha=\${live_video_sha:0:12}."

            if [[ "$html_status" == "200" \\
              && "$script_status" == "200" \\
              && "$video_status" == "200" \\
              && "$live_video_bytes" == "$expected_video_bytes" \\
              && "$live_video_sha" == "$expected_video_sha" \\
              && "$live_video_type" == video/mp4* ]] \\
              && grep -Fq 'id="mobile-background-video"' "$tmpdir/live.html" \\
              && grep -Fq 'autoplay' "$tmpdir/live.html" \\
              && grep -Fq 'muted' "$tmpdir/live.html" \\
              && grep -Fq 'loop' "$tmpdir/live.html" \\
              && grep -Fq 'playsinline' "$tmpdir/live.html" \\
              && grep -Fq "poster=\"\${expected_poster_asset}\"" "$tmpdir/live.html" \\
              && grep -Fq "src=\"\${expected_video_asset}\" type=\"video/mp4\"" "$tmpdir/live.html" \\
              && grep -Fq 'video.defaultMuted = true' "$tmpdir/mobile-quality.js" \\
              && grep -Fq 'video.play()' "$tmpdir/mobile-quality.js" \\
              && grep -Fq 'video-awaiting-gesture' "$tmpdir/mobile-quality.js" \\
              && grep -Fqi 'strict-transport-security: max-age=31536000; includeSubDomains' "$tmpdir/video.headers" \\
              && grep -Fqi 'etag:' "$tmpdir/video.headers"; then
              publish_status success "Exact mobile forest video release is live"
              exit 0
            fi

            sleep 10
          done

          publish_status failure "Exact mobile forest video release is not live"
          echo "::error::Production never served the checked-out mobile video element, playback script, and exact MP4 bytes together."
          exit 1
`;
await writeFile(".github/workflows/verify-mobile-background.yml", workflow, "utf8");

console.log(
  `Installed ${VIDEO_ASSET} as the muted, looping portrait mobile background.`,
);
