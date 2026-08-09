#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(
        "usage: prepare-mobile-video-smooth-release.py VIDEO_PATH POSTER_PATH"
    )

root = Path.cwd()
video_source = Path(sys.argv[1])
poster_source = Path(sys.argv[2])
if not video_source.is_file() or not poster_source.is_file():
    raise SystemExit("validated video and poster files are required")

VIDEO_FILE = "mobile-forest-stream-video-v12-720.mp4"
VIDEO_ASSET = f"/scenes/{VIDEO_FILE}"
POSTER_FILE = "mobile-forest-stream-v12-720.webp"
POSTER_ASSET = f"/scenes/{POSTER_FILE}"
LEGACY_ROUTE = "/media/mobile-forest-stream-video-v4-1080.mp4"
VERSION = "20260809-mobile-video-v12-smooth-1"
WIDTH = 720
HEIGHT = 1280

video = video_source.read_bytes()
poster = poster_source.read_bytes()
video_bytes = len(video)
poster_bytes = len(poster)
video_sha = hashlib.sha256(video).hexdigest()
poster_sha = hashlib.sha256(poster).hexdigest()

if not 500_000 < video_bytes < 2_500_000:
    raise SystemExit(f"replacement video has an unexpected size: {video_bytes}")
if video[4:8] != b"ftyp":
    raise SystemExit("replacement video is not an MP4")
if poster[:4] != b"RIFF" or poster[8:12] != b"WEBP":
    raise SystemExit("replacement poster is not a WebP")

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(video_source, scenes / VIDEO_FILE)
shutil.copyfile(poster_source, scenes / POSTER_FILE)


def read(path: str) -> str:
    return (root / path).read_text()


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


client = f'''const MOBILE_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait)";
const VIDEO_ASSET = "{LEGACY_ROUTE}";
const SMOOTH_VIDEO_ASSET = "{VIDEO_ASSET}";
const POSTER_ASSET = "{POSTER_ASSET}";

const mobilePortrait = globalThis.matchMedia?.(MOBILE_BACKGROUND_QUERY);
const backdropImage = document.querySelector("#photo-backdrop-image");
const terrain = document.querySelector("#terrain-background");
const pageShell = document.querySelector(".page-shell");

let backgroundVideo = null;
let fallbackAttempted = false;
let gestureListenersInstalled = false;
let playControl = null;

function markPosterReady() {{
  terrain?.classList.add("is-photo-ready");
  if (document.documentElement.dataset.mobileBackground !== "video-playing") {{
    document.documentElement.dataset.mobileBackground = "poster-ready";
  }}
}}

if (backdropImage instanceof HTMLImageElement) {{
  if (backdropImage.complete && backdropImage.naturalWidth > 0) {{
    markPosterReady();
  }} else {{
    backdropImage.addEventListener("load", markPosterReady, {{ once: true }});
    backdropImage.addEventListener(
      "error",
      () => {{
        document.documentElement.dataset.mobileBackground = "poster-failed";
      }},
      {{ once: true }},
    );
  }}
}}

function ensurePlayControl() {{
  if (playControl instanceof HTMLButtonElement) return playControl;
  const existing = document.querySelector("#mobile-video-play-control");
  if (existing instanceof HTMLButtonElement) {{
    playControl = existing;
    return playControl;
  }}

  const button = document.createElement("button");
  button.id = "mobile-video-play-control";
  button.type = "button";
  button.textContent = "Play background";
  button.setAttribute("aria-label", "Play the moving forest background");
  button.hidden = true;
  Object.assign(button.style, {{
    position: "fixed",
    zIndex: "4",
    left: "50%",
    bottom: "calc(max(18px, env(safe-area-inset-bottom)) + 78px)",
    transform: "translateX(-50%)",
    minHeight: "40px",
    border: "1px solid rgba(255, 255, 255, 0.78)",
    borderRadius: "999px",
    background: "rgba(20, 54, 42, 0.88)",
    boxShadow: "0 6px 20px rgba(4, 24, 17, 0.32)",
    color: "#fffdf6",
    padding: "9px 14px",
    font: "600 0.84rem Lexend, system-ui, sans-serif",
    cursor: "pointer",
    WebkitTapHighlightColor: "transparent",
  }});
  button.addEventListener("click", (event) => {{
    event.preventDefault();
    resumeAfterGesture();
  }});
  document.body.append(button);
  playControl = button;
  return button;
}}

function setPlayControlVisible(visible) {{
  ensurePlayControl().hidden = !visible;
}}

function removeGestureListeners() {{
  if (!gestureListenersInstalled) return;
  gestureListenersInstalled = false;
  window.removeEventListener("pointerdown", resumeAfterGesture, true);
  window.removeEventListener("touchstart", resumeAfterGesture, true);
  window.removeEventListener("keydown", resumeAfterGesture, true);
}}

function addGestureListeners() {{
  if (gestureListenersInstalled) return;
  gestureListenersInstalled = true;
  window.addEventListener("pointerdown", resumeAfterGesture, {{
    capture: true,
    passive: true,
  }});
  window.addEventListener("touchstart", resumeAfterGesture, {{
    capture: true,
    passive: true,
  }});
  window.addEventListener("keydown", resumeAfterGesture, {{ capture: true }});
}}

function markVideoPlaying() {{
  if (
    !(backgroundVideo instanceof HTMLVideoElement) ||
    !mobilePortrait?.matches ||
    backgroundVideo.paused
  ) {{
    return;
  }}
  terrain?.classList.add("is-photo-ready");
  document.documentElement.dataset.mobileBackground = "video-playing";
  document.documentElement.dataset.mobileVideoSource = fallbackAttempted
    ? "legacy-fallback"
    : "smooth-static";
  setPlayControlVisible(false);
  removeGestureListeners();
}}

function useLegacyFallback(video) {{
  if (fallbackAttempted) return false;
  fallbackAttempted = true;
  video.src = VIDEO_ASSET;
  video.load();
  return true;
}}

function handleVideoError() {{
  if (!(backgroundVideo instanceof HTMLVideoElement)) return;
  if (useLegacyFallback(backgroundVideo)) {{
    requestPlayback(backgroundVideo);
    return;
  }}
  document.documentElement.dataset.mobileBackground = "video-failed";
  setPlayControlVisible(false);
}}

function ensureBackgroundVideo() {{
  if (backgroundVideo instanceof HTMLVideoElement) return backgroundVideo;

  const existing = document.querySelector("#mobile-background-video");
  if (existing instanceof HTMLVideoElement) {{
    backgroundVideo = existing;
    return backgroundVideo;
  }}

  const video = document.createElement("video");
  video.id = "mobile-background-video";
  video.autoplay = true;
  video.muted = true;
  video.defaultMuted = true;
  video.loop = true;
  video.playsInline = true;
  video.preload = "auto";
  video.poster = POSTER_ASSET;
  video.disablePictureInPicture = true;
  video.disableRemotePlayback = true;
  video.setAttribute("autoplay", "");
  video.setAttribute("muted", "");
  video.setAttribute("loop", "");
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "true");
  video.setAttribute("preload", "auto");
  video.setAttribute("aria-hidden", "true");
  video.setAttribute("tabindex", "-1");
  video.setAttribute("x-webkit-airplay", "deny");

  Object.assign(video.style, {{
    position: "fixed",
    zIndex: "0",
    inset: "0",
    display: "block",
    width: "100%",
    height: "100%",
    objectFit: "cover",
    objectPosition: "50% 50%",
    opacity: "1",
    background: "#173f31",
    pointerEvents: "none",
    userSelect: "none",
    transform: "translate3d(0, 0, 0)",
    WebkitTransform: "translate3d(0, 0, 0)",
    backfaceVisibility: "hidden",
    WebkitBackfaceVisibility: "hidden",
    contain: "strict",
  }});

  video.addEventListener("playing", markVideoPlaying);
  video.addEventListener("timeupdate", markVideoPlaying);
  video.addEventListener("error", handleVideoError);
  video.src = SMOOTH_VIDEO_ASSET;
  backgroundVideo = video;

  if (pageShell instanceof HTMLElement) {{
    pageShell.before(video);
  }} else {{
    document.body.append(video);
  }}
  video.load();
  return video;
}}

function requestPlayback(video) {{
  video.muted = true;
  video.defaultMuted = true;
  video.playsInline = true;
  document.documentElement.dataset.mobileBackground = "video-loading";

  let playback;
  try {{
    playback = video.play();
  }} catch {{
    document.documentElement.dataset.mobileBackground =
      "video-awaiting-gesture";
    setPlayControlVisible(true);
    addGestureListeners();
    return;
  }}

  if (playback && typeof playback.then === "function") {{
    playback
      .then(markVideoPlaying)
      .catch(() => {{
        document.documentElement.dataset.mobileBackground =
          "video-awaiting-gesture";
        setPlayControlVisible(true);
        addGestureListeners();
      }});
  }} else {{
    markVideoPlaying();
  }}
}}

function startVideo() {{
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo());
}}

function stopVideo() {{
  backgroundVideo?.pause();
  setPlayControlVisible(false);
  document.documentElement.dataset.mobileBackground = "poster-ready";
}}

function resumeAfterGesture() {{
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo());
}}

mobilePortrait?.addEventListener?.("change", (event) => {{
  if (event.matches) {{
    addGestureListeners();
    startVideo();
  }} else {{
    removeGestureListeners();
    stopVideo();
  }}
}});

document.addEventListener("visibilitychange", () => {{
  if (document.hidden) stopVideo();
  else startVideo();
}});
window.addEventListener("pageshow", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());

if (mobilePortrait?.matches) {{
  ensurePlayControl();
  addGestureListeners();
  startVideo();
}}
'''
write("public/mobile-quality.js", client)

page_path = root / "src/page.js"
page = page_path.read_text()
page, replacements = re.subn(
    r"/mobile-quality\.js\?v=[A-Za-z0-9._-]+",
    f"/mobile-quality.js?v={VERSION}",
    page,
    count=1,
)
if replacements != 1:
    raise SystemExit("could not update the mobile video client cache version")
page_path.write_text(page)

headers_path = root / "public/_headers"
headers = headers_path.read_text().rstrip() + "\n"
start_marker = "# smooth-mobile-video-v12-start"
end_marker = "# smooth-mobile-video-v12-end"
block = f'''{start_marker}
/scenes/{VIDEO_FILE}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

/scenes/{POSTER_FILE}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
{end_marker}
'''
if start_marker in headers:
    headers = re.sub(
        re.escape(start_marker) + r"[\s\S]*?" + re.escape(end_marker) + r"\n?",
        block,
        headers,
        count=1,
    )
else:
    headers += "\n" + block
headers_path.write_text(headers)

materializer_path = root / "scripts/materialize-mobile-forest-stream.mjs"
materializer = materializer_path.read_text().rstrip() + "\n"
validation_start = "// smooth-mobile-video-v12-validation-start"
validation_end = "// smooth-mobile-video-v12-validation-end"
validation = f'''
{validation_start}
const smoothVideoPath = "public/scenes/{VIDEO_FILE}";
const smoothVideoExpectedBytes = {video_bytes:_};
const smoothVideoExpectedSha256 = "{video_sha}";
const smoothPosterPath = "public/scenes/{POSTER_FILE}";
const smoothPosterExpectedBytes = {poster_bytes:_};
const smoothPosterExpectedSha256 = "{poster_sha}";

const smoothVideo = await readFile(smoothVideoPath);
if (smoothVideo.byteLength !== smoothVideoExpectedBytes) {{
  throw new Error(
    `Unexpected smooth mobile video size: ${{smoothVideo.byteLength}}; expected ${{smoothVideoExpectedBytes}}`,
  );
}}
const smoothVideoSha256 = createHash("sha256")
  .update(smoothVideo)
  .digest("hex");
if (smoothVideoSha256 !== smoothVideoExpectedSha256) {{
  throw new Error(`Smooth mobile video checksum mismatch: ${{smoothVideoSha256}}`);
}}
if (
  smoothVideo.byteLength < 12 ||
  smoothVideo.subarray(4, 8).toString("ascii") !== "ftyp"
) {{
  throw new Error("Smooth mobile video is not an MP4 file");
}}
for (const marker of ["moov", "mdat", "vide", "avc1"]) {{
  if (!smoothVideo.includes(Buffer.from(marker, "ascii"))) {{
    throw new Error(`Smooth mobile video is missing the ${{marker}} marker`);
  }}
}}
if (
  smoothVideo.includes(Buffer.from("mp4a", "ascii")) ||
  smoothVideo.includes(Buffer.from("soun", "ascii"))
) {{
  throw new Error("Smooth mobile video must not contain audio");
}}

const smoothPoster = await readFile(smoothPosterPath);
if (smoothPoster.byteLength !== smoothPosterExpectedBytes) {{
  throw new Error(
    `Unexpected smooth mobile poster size: ${{smoothPoster.byteLength}}; expected ${{smoothPosterExpectedBytes}}`,
  );
}}
const smoothPosterSha256 = createHash("sha256")
  .update(smoothPoster)
  .digest("hex");
if (smoothPosterSha256 !== smoothPosterExpectedSha256) {{
  throw new Error(`Smooth mobile poster checksum mismatch: ${{smoothPosterSha256}}`);
}}
const smoothPosterInfo = webpInfo(smoothPoster);
if (
  smoothPosterInfo.width !== {WIDTH} ||
  smoothPosterInfo.height !== {HEIGHT} ||
  smoothPosterInfo.animated
) {{
  throw new Error(
    `Unexpected smooth mobile poster: ${{smoothPosterInfo.width}}x${{smoothPosterInfo.height}}, animated=${{smoothPosterInfo.animated}}`,
  );
}}
console.log(
  `Validated ${{smoothVideoPath}}: {WIDTH}x{HEIGHT}, ${{smoothVideo.byteLength}} bytes, sha256=${{smoothVideoSha256}}`,
);
{validation_end}
'''
if validation_start in materializer:
    materializer = re.sub(
        re.escape(validation_start)
        + r"[\s\S]*?"
        + re.escape(validation_end)
        + r"\n?",
        validation.lstrip("\n"),
        materializer,
        count=1,
    )
else:
    materializer += validation
materializer_path.write_text(materializer)

test_path = root / "test/mobile-background-loading.test.mjs"
test_source = test_path.read_text().rstrip() + "\n"
test_start = "// smooth-mobile-video-v12-test-start"
test_end = "// smooth-mobile-video-v12-test-end"
test_block = f'''
{test_start}
test("portrait mobile prefers a hardware-friendly direct MP4", async () => {{
  const [clientSource, materializerSource, smoothVideo] = await Promise.all([
    read("public/mobile-quality.js"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(
      new URL("../public/scenes/{VIDEO_FILE}", import.meta.url),
    ),
  ]);

  assert.match(
    clientSource,
    /const SMOOTH_VIDEO_ASSET = "\\/scenes\\/{re.escape(VIDEO_FILE)}"/,
  );
  assert.match(clientSource, /video\\.src = SMOOTH_VIDEO_ASSET/);
  assert.match(
    clientSource,
    /const VIDEO_ASSET = "\\/media\\/mobile-forest-stream-video-v4-1080\\.mp4"/,
  );
  assert.match(clientSource, /video\\.src = VIDEO_ASSET/);
  assert.match(clientSource, /translate3d\\(0, 0, 0\\)/);
  assert.match(clientSource, /video\\.preload = "auto"/);
  assert.match(materializerSource, /smooth-mobile-video-v12-validation-start/);

  assert.equal(smoothVideo.byteLength, {video_bytes});
  assert.equal(smoothVideo.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {{
    assert.ok(smoothVideo.includes(Buffer.from(marker, "ascii")));
  }}
}});
{test_end}
'''
if test_start in test_source:
    test_source = re.sub(
        re.escape(test_start) + r"[\s\S]*?" + re.escape(test_end) + r"\n?",
        test_block.lstrip("\n"),
        test_source,
        count=1,
    )
else:
    test_source += test_block
test_path.write_text(test_source)

print(
    f"Prepared {VIDEO_FILE}: {video_bytes} bytes, sha256={video_sha}; "
    f"poster={poster_bytes} bytes, sha256={poster_sha}"
)
