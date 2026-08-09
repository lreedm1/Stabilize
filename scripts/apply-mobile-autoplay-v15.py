#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()
VIDEO = "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
POSTER = "/scenes/mobile-forest-stream-v14-retina-2160.webp"
VERSION = "20260809-mobile-video-v15-visible-autoplay-1"
GUIDE_VERSION = "20260809-mobile-forest-retina-2160-1"


def load(path: str) -> str:
    return (ROOT / path).read_text()


def save(path: str, value: str) -> None:
    target = ROOT / path
    if target.read_text() != value:
        target.write_text(value)


def replace_once(value: str, old: str, new: str, label: str) -> str:
    if value.count(old) != 1:
        raise SystemExit(f"Expected one {label}; found {value.count(old)}")
    return value.replace(old, new, 1)


def replace_marked(value: str, starts: tuple[str, ...], endings: dict[str, str], block: str, label: str) -> str:
    for start in starts:
        if start not in value:
            continue
        end = endings[start]
        pattern = re.compile(re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?")
        value, count = pattern.subn(lambda _: block, value, count=1)
        if count != 1:
            raise SystemExit(f"Could not replace {label}")
        return value
    raise SystemExit(f"Could not find {label}")


# Keep the parser-created video source intact. WebKit can autoplay a silent,
# inline video only while it is visible; resetting a hidden parser element makes
# the first gesture become the reliable start signal instead.
client = load("public/mobile-quality.js")
client = replace_once(
    client,
    'const SD_POSTER_ASSET = "/scenes/mobile-forest-stream-v12-720.webp";\n',
    'const SD_POSTER_ASSET = "/scenes/mobile-forest-stream-v12-720.webp";\nconst MAX_AUTOPLAY_RETRIES = 8;\n',
    "autoplay retry constant",
)
client = client.replace('const pageShell = document.querySelector(".page-shell");\n', "")
client = replace_once(
    client,
    "let autoplayAttempts = 0;\n",
    "let autoplayAttempts = 0;\nlet requestedPause = false;\n",
    "requested pause state",
)
client = replace_once(
    client,
    '''function scheduleAutoplayRetry(video) {
  if (!mobilePortrait?.matches || document.hidden) return;
  clearAutoplayRetry();
  const delay = Math.min(2000, 250 * 2 ** Math.min(autoplayAttempts, 3));
  autoplayAttempts += 1;
  autoplayRetryTimer = setTimeout(() => requestPlayback(video), delay);
}
''',
    '''function markAutoplayBlocked(video, error) {
  video.classList.add("is-autoplay-blocked");
  document.documentElement.dataset.mobileBackground = "video-autoplay-blocked";
  if (error && typeof error.name === "string") {
    document.documentElement.dataset.mobileVideoAutoplayError = error.name;
  }
}

function scheduleAutoplayRetry(video) {
  if (!mobilePortrait?.matches || document.hidden) return;
  clearAutoplayRetry();
  if (autoplayAttempts >= MAX_AUTOPLAY_RETRIES) return;
  const delay = Math.min(2000, 160 * 2 ** Math.min(autoplayAttempts, 4));
  autoplayAttempts += 1;
  autoplayRetryTimer = setTimeout(() => requestPlayback(video), delay);
}
''',
    "autoplay retry function",
)
# Both source inspections now honor the declarative src attribute before
# currentSrc has been populated, preventing configureVideo() from calling load().
client = client.replace(
    '  const current = video.currentSrc || video.src || "";\n',
    '  const declared = video.getAttribute("src") || "";\n  const current = video.currentSrc || video.src || declared;\n',
)
client = client.replace('    display: "block",\n', "")
client = client.replace('    opacity: "1",\n', "")
client = replace_once(
    client,
    '    video.addEventListener("loadeddata", () => requestPlayback(video));\n',
    '    video.addEventListener("loadedmetadata", () => requestPlayback(video));\n    video.addEventListener("loadeddata", () => requestPlayback(video));\n',
    "loadedmetadata autoplay attempt",
)
client = replace_once(
    client,
    '''    video.addEventListener("pause", () => {
      if (mobilePortrait?.matches && !document.hidden) {
        scheduleAutoplayRetry(video);
      }
    });
''',
    '''    video.addEventListener("pause", () => {
      if (!requestedPause && mobilePortrait?.matches && !document.hidden) {
        scheduleAutoplayRetry(video);
      }
    });
''',
    "pause retry guard",
)
client = replace_once(
    client,
    '  terrain?.classList.add("is-photo-ready");\n  document.documentElement.dataset.mobileBackground = "video-playing";\n',
    '  backgroundVideo.classList.remove("is-autoplay-blocked");\n  terrain?.classList.add("is-photo-ready");\n  document.documentElement.dataset.mobileBackground = "video-playing";\n',
    "playing class reset",
)
client = replace_once(
    client,
    '''  const video = document.createElement("video");
  video.id = "mobile-background-video";
  video.className = "mobile-background-video";
  backgroundVideo = configureVideo(video);

  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }
''',
    '''  const video = document.createElement("video");
  video.id = "mobile-background-video";
  video.className = "mobile-background-video";
  video.src = RETINA_VIDEO_ASSET;
  video.poster = RETINA_POSTER_ASSET;
  backgroundVideo = configureVideo(video);

  const pageShell = document.querySelector(".page-shell");
  if (pageShell instanceof HTMLElement) {
    pageShell.before(video);
  } else {
    document.body.append(video);
  }
''',
    "dynamic video insertion",
)
client = client.replace(
    '''  } catch {
    scheduleAutoplayRetry(video);
    return;
  }
''',
    '''  } catch (error) {
    markAutoplayBlocked(video, error);
    scheduleAutoplayRetry(video);
    return;
  }
''',
    1,
)
client = replace_once(
    client,
    '''      .catch(() => {
        if (fromGesture) autoplayAttempts = 0;
        scheduleAutoplayRetry(video);
      });
''',
    '''      .catch((error) => {
        if (fromGesture) autoplayAttempts = 0;
        markAutoplayBlocked(video, error);
        scheduleAutoplayRetry(video);
      });
''',
    "play promise rejection",
)
client = replace_once(
    client,
    '''function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;
  requestPlayback(ensureBackgroundVideo());
}

function stopVideo() {
  clearAutoplayRetry();
  backgroundVideo?.pause();
  document.documentElement.dataset.mobileBackground = "poster-ready";
}
''',
    '''function startVideo() {
  if (!mobilePortrait?.matches || document.hidden) return;
  const video = ensureBackgroundVideo();
  requestedPause = false;
  requestPlayback(video);
  queueMicrotask(() => requestPlayback(video));
  requestAnimationFrame(() => requestPlayback(video));
}

function stopVideo() {
  clearAutoplayRetry();
  requestedPause = true;
  backgroundVideo?.pause();
  document.documentElement.dataset.mobileBackground = "poster-ready";
  queueMicrotask(() => {
    requestedPause = false;
  });
}
''',
    "lifecycle playback functions",
)
client = replace_once(
    client,
    '''window.addEventListener("pageshow", startVideo);
window.addEventListener("focus", startVideo);
window.addEventListener("online", startVideo);
window.addEventListener("pagehide", () => backgroundVideo?.pause());
''',
    '''document.addEventListener("DOMContentLoaded", startVideo, { once: true });
window.addEventListener("load", startVideo, { once: true });
window.addEventListener("pageshow", startVideo);
window.addEventListener("focus", startVideo);
window.addEventListener("online", startVideo);
window.addEventListener("orientationchange", () => setTimeout(startVideo, 0));
window.addEventListener("pagehide", stopVideo);
''',
    "visible lifecycle attempts",
)
save("public/mobile-quality.js", client)
save("scripts/mobile-quality-hd-template.js", client)

page = load("src/page.js")
page = re.sub(r'\n    <script src="/mobile-quality\.js\?v=[A-Za-z0-9._-]+"></script>', "", page)
video_block = f'''    <!-- retina-mobile-video-v15-start -->
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      src="{VIDEO}"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="{POSTER}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    ></video>
    <script src="/mobile-quality.js?v={VERSION}"></script>
    <!-- retina-mobile-video-v15-end -->
'''
page = replace_marked(
    page,
    ("    <!-- retina-mobile-video-v14-start -->", "    <!-- retina-mobile-video-v15-start -->"),
    {
        "    <!-- retina-mobile-video-v14-start -->": "    <!-- retina-mobile-video-v14-end -->",
        "    <!-- retina-mobile-video-v15-start -->": "    <!-- retina-mobile-video-v15-end -->",
    },
    video_block,
    "video block",
)
if page.count("/mobile-quality.js?v=") != 1:
    raise SystemExit("Expected one adjacent mobile playback bootstrap")
save("src/page.js", page)

style = load("public/mobile-woodland-loop.css")
style_block = r'''/* retina-mobile-video-v15-start */
.mobile-background-video {
  position: fixed;
  z-index: 0;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: 50% 50%;
  opacity: 1;
  background: #173f31;
  pointer-events: none;
  user-select: none;
  transform: translate3d(0, 0, 0);
  -webkit-transform: translate3d(0, 0, 0);
  backface-visibility: hidden;
  -webkit-backface-visibility: hidden;
  contain: strict;
}

@keyframes mobile-video-poster-drift {
  from { transform: scale(1.012) translate3d(-0.35%, -0.18%, 0); }
  to { transform: scale(1.035) translate3d(0.45%, 0.22%, 0); }
}

@media (max-width: 980px) and (orientation: portrait) {
  .mobile-background-video.is-autoplay-blocked {
    animation: mobile-video-poster-drift 7s ease-in-out infinite alternate;
    will-change: transform;
  }
}

@media (min-width: 981px), (orientation: landscape) {
  .mobile-background-video { opacity: 0; }
}
/* retina-mobile-video-v15-end */
'''
style = replace_marked(
    style,
    ("/* retina-mobile-video-v14-start */", "/* retina-mobile-video-v15-start */"),
    {
        "/* retina-mobile-video-v14-start */": "/* retina-mobile-video-v14-end */",
        "/* retina-mobile-video-v15-start */": "/* retina-mobile-video-v15-end */",
    },
    style_block,
    "video style block",
)
save("public/mobile-woodland-loop.css", style)

# Upgrade the image shown before the first decoded video frame from 540x960 to
# the existing full 2160x3840 Retina poster, including guide pages and tests.
use_mobile = load("scripts/use-mobile-forest-stream.mjs")
use_mobile = use_mobile.replace(
    'const MOBILE_ASSET = "/scenes/mobile-forest-stream-v1-540.webp";',
    f'const MOBILE_ASSET = "{POSTER}";',
)
use_mobile = use_mobile.replace(
    'const GUIDE_VERSION = "20260808-mobile-forest-stream-540-1";',
    f'const GUIDE_VERSION = "{GUIDE_VERSION}";',
)
use_mobile = re.sub(
    r'^const MOBILE_STYLE_VERSION = "[^"]+";$',
    f'const MOBILE_STYLE_VERSION = "{VERSION}";',
    use_mobile,
    count=1,
    flags=re.MULTILINE,
)
use_mobile = use_mobile.replace(" 540w", " 2160w")
use_mobile = use_mobile.replace('filename: "mobile-forest-stream-v1-540.webp"', 'filename: "mobile-forest-stream-v14-retina-2160.webp"')
use_mobile = use_mobile.replace("    width: 540,\n    height: 960,", "    width: 2160,\n    height: 3840,")
use_mobile = use_mobile.replace("assert.equal(image.byteLength, 91_750);", "assert.equal(image.byteLength, 645_202);")
use_mobile = use_mobile.replace("mobile-forest-stream-v1-540\\.webp", "mobile-forest-stream-v14-retina-2160\\.webp")
use_mobile = use_mobile.replace("20260809-mobile-video-v14-retina-autoplay-1", VERSION)
use_mobile = use_mobile.replace('  assert.doesNotMatch(mobileStyles, /@keyframes/);\n', '  assert.match(mobileStyles, /mobile-video-poster-drift/);\n  assert.match(mobileStyles, /is-autoplay-blocked/);\n')
use_mobile = use_mobile.replace(
    '    "/scenes/mobile-forest-stream-v1-720.webp",\n',
    '    "/scenes/mobile-forest-stream-v1-720.webp",\n    "/scenes/mobile-forest-stream-v1-540.webp",\n',
)
use_mobile = use_mobile.replace(
    '  return next;\n});\n\nawait update(".github/workflows/verify-mobile-background.yml"',
    '  next = next.replaceAll(\n    "mobile-forest-stream-v1-540",\n    "mobile-forest-stream-v14-retina-2160",\n  );\n  return next;\n});\n\nawait update(".github/workflows/verify-mobile-background.yml"',
)
save("scripts/use-mobile-forest-stream.mjs", use_mobile)

# Align the dedicated regression with the new cache key and require the video to
# be parser-visible rather than display:none before the first play attempt.
test_path = "test/mobile-background-loading.test.mjs"
test_source = load(test_path)
test_source = test_source.replace("retina-mobile-video-v14-test-start", "retina-mobile-video-v15-test-start")
test_source = test_source.replace("retina-mobile-video-v14-test-end", "retina-mobile-video-v15-test-end")
test_source = test_source.replace("retina-mobile-video-v14-start", "retina-mobile-video-v15-start")
test_source = test_source.replace("20260809\\-mobile\\-video\\-v14\\-retina\\-autoplay\\-1", "20260809\\-mobile\\-video\\-v15\\-visible\\-autoplay\\-1")
test_source = replace_once(
    test_source,
    "  assert.match(styleSource, /object-fit:\\s*cover/);\n",
    "  assert.match(styleSource, /object-fit:\\s*cover/);\n  assert.match(styleSource, /\\.mobile-background-video\\s*\\{[\\s\\S]*display:\\s*block/);\n  assert.doesNotMatch(styleSource, /\\.mobile-background-video\\s*\\{[^}]*display:\\s*none/s);\n  assert.match(styleSource, /mobile-video-poster-drift/);\n  assert.match(clientSource, /video\\.getAttribute\\(\"src\"\\)/);\n  assert.match(pageSource, /<\\/video>[\\s\\S]*mobile-quality\\.js[\\s\\S]*<div class=\"page-shell\">/);\n",
    "visible autoplay assertions",
)
save(test_path, test_source)

print("Applied visible parser-time autoplay and a 2160x3840 immediate Retina fallback.")
