#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(
        "usage: prepare-mobile-video-hd-release.py VIDEO_PATH POSTER_PATH"
    )

root = Path.cwd()
video_source = Path(sys.argv[1])
poster_source = Path(sys.argv[2])
if not video_source.is_file() or not poster_source.is_file():
    raise SystemExit("validated HD video and poster files are required")

VIDEO_FILE = "mobile-forest-stream-video-v13-1080.mp4"
VIDEO_ASSET = f"/scenes/{VIDEO_FILE}"
POSTER_FILE = "mobile-forest-stream-v13-1080.webp"
POSTER_ASSET = f"/scenes/{POSTER_FILE}"
SD_VIDEO_FILE = "mobile-forest-stream-video-v12-720.mp4"
SD_VIDEO_ASSET = f"/scenes/{SD_VIDEO_FILE}"
SD_POSTER_FILE = "mobile-forest-stream-v12-720.webp"
VERSION = "20260809-mobile-video-v13-hd-autoplay-1"
STYLE_VERSION = "20260809-mobile-video-v13-hd-autoplay-1"
WIDTH = 1080
HEIGHT = 1920

video = video_source.read_bytes()
poster = poster_source.read_bytes()
video_bytes = len(video)
poster_bytes = len(poster)
video_sha = hashlib.sha256(video).hexdigest()
poster_sha = hashlib.sha256(poster).hexdigest()

if not 800_000 < video_bytes < 8_000_000:
    raise SystemExit(f"HD video has an unexpected size: {video_bytes}")
if video[4:8] != b"ftyp":
    raise SystemExit("HD video is not an MP4")
if poster[:4] != b"RIFF" or poster[8:12] != b"WEBP":
    raise SystemExit("HD poster is not a WebP")
for marker in (b"moov", b"mdat", b"vide", b"avc1"):
    if marker not in video:
        raise SystemExit(f"HD video is missing {marker.decode()} marker")
if b"mp4a" in video or b"soun" in video:
    raise SystemExit("HD video must not contain audio")

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


def replace_marked(source: str, start: str, end: str, block: str) -> str:
    if start in source:
        source, count = re.subn(
            re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?",
            block,
            source,
            count=1,
        )
        if count != 1:
            raise SystemExit(f"could not replace marked block {start}")
        return source
    suffix = "" if source.endswith("\n") else "\n"
    return source + suffix + "\n" + block


# Install the adaptive client verbatim. It prefers 1080p, autoplays muted and
# inline, monitors presented-frame cadence, and falls back to the proven 720p
# stream before using the legacy Worker route.
template = root / "scripts/mobile-quality-hd-template.js"
if not template.is_file():
    raise SystemExit("HD mobile client template is missing")
shutil.copyfile(template, root / "public/mobile-quality.js")

video_start = "<!-- hd-mobile-video-v13-start -->"
video_end = "<!-- hd-mobile-video-v13-end -->"
video_block = f'''    {video_start}
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="{POSTER_ASSET}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    >
      <source
        src="{VIDEO_ASSET}"
        type="video/mp4"
        media="(max-width: 980px) and (orientation: portrait)"
      />
    </video>
    {video_end}
'''

page_path = root / "src/page.js"
page = page_path.read_text()
if video_start in page:
    page, count = re.subn(
        r"    " + re.escape(video_start) + r"[\s\S]*?    " + re.escape(video_end) + r"\n",
        video_block,
        page,
        count=1,
    )
    if count != 1:
        raise SystemExit("could not replace the existing HD video element")
else:
    page_shell = '    <div class="page-shell">\n'
    if page_shell not in page:
        raise SystemExit("could not find the page shell insertion point")
    page = page.replace(page_shell, video_block + page_shell, 1)

page, count = re.subn(
    r"/mobile-quality\.js\?v=[A-Za-z0-9._-]+",
    f"/mobile-quality.js?v={VERSION}",
    page,
    count=1,
)
if count != 1:
    raise SystemExit("could not update the mobile client cache version")
page, count = re.subn(
    r"/mobile-woodland-loop\.css\?v=[A-Za-z0-9._-]+",
    f"/mobile-woodland-loop.css?v={STYLE_VERSION}",
    page,
    count=1,
)
if count != 1:
    raise SystemExit("could not update the mobile style cache version")
page_path.write_text(page)

style_start = "/* hd-mobile-video-v13-start */"
style_end = "/* hd-mobile-video-v13-end */"
style_block = f'''{style_start}
.mobile-background-video {{
  display: none;
}}

@media (max-width: 980px) and (orientation: portrait) {{
  .mobile-background-video {{
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
    backface-visibility: hidden;
    contain: strict;
  }}
}}
{style_end}
'''
style_path = root / "public/mobile-woodland-loop.css"
style_path.write_text(
    replace_marked(style_path.read_text(), style_start, style_end, style_block)
)

# Keep the historical generator from resetting the bumped CSS cache key during
# npm run apply:prompt-policy.
use_mobile_path = root / "scripts/use-mobile-forest-stream.mjs"
use_mobile = use_mobile_path.read_text()
use_mobile, count = re.subn(
    r'^const MOBILE_STYLE_VERSION = "[^"]+";$',
    f'const MOBILE_STYLE_VERSION = "{STYLE_VERSION}";',
    use_mobile,
    count=1,
    flags=re.MULTILINE,
)
if count != 1:
    raise SystemExit("could not update the generated mobile style version")
use_mobile_path.write_text(use_mobile)

headers_start = "# hd-mobile-video-v13-start"
headers_end = "# hd-mobile-video-v13-end"
headers_block = f'''{headers_start}
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
{headers_end}
'''
headers_path = root / "public/_headers"
headers_path.write_text(
    replace_marked(
        headers_path.read_text(),
        headers_start,
        headers_end,
        headers_block,
    )
)

validation_start = "// hd-mobile-video-v13-validation-start"
validation_end = "// hd-mobile-video-v13-validation-end"
validation_block = f'''{validation_start}
const hdVideoPath = "public/scenes/{VIDEO_FILE}";
const hdVideoExpectedBytes = {video_bytes:_};
const hdVideoExpectedSha256 = "{video_sha}";
const hdPosterPath = "public/scenes/{POSTER_FILE}";
const hdPosterExpectedBytes = {poster_bytes:_};
const hdPosterExpectedSha256 = "{poster_sha}";

const hdVideo = await readFile(hdVideoPath);
if (hdVideo.byteLength !== hdVideoExpectedBytes) {{
  throw new Error(
    `Unexpected HD mobile video size: ${{hdVideo.byteLength}}; expected ${{hdVideoExpectedBytes}}`,
  );
}}
const hdVideoSha256 = createHash("sha256").update(hdVideo).digest("hex");
if (hdVideoSha256 !== hdVideoExpectedSha256) {{
  throw new Error(`HD mobile video checksum mismatch: ${{hdVideoSha256}}`);
}}
if (hdVideo.byteLength < 12 || hdVideo.subarray(4, 8).toString("ascii") !== "ftyp") {{
  throw new Error("HD mobile video is not an MP4 file");
}}
for (const marker of ["moov", "mdat", "vide", "avc1"]) {{
  if (!hdVideo.includes(Buffer.from(marker, "ascii"))) {{
    throw new Error(`HD mobile video is missing the ${{marker}} marker`);
  }}
}}
if (hdVideo.includes(Buffer.from("mp4a", "ascii")) || hdVideo.includes(Buffer.from("soun", "ascii"))) {{
  throw new Error("HD mobile video must not contain audio");
}}

const hdPoster = await readFile(hdPosterPath);
if (hdPoster.byteLength !== hdPosterExpectedBytes) {{
  throw new Error(
    `Unexpected HD mobile poster size: ${{hdPoster.byteLength}}; expected ${{hdPosterExpectedBytes}}`,
  );
}}
const hdPosterSha256 = createHash("sha256").update(hdPoster).digest("hex");
if (hdPosterSha256 !== hdPosterExpectedSha256) {{
  throw new Error(`HD mobile poster checksum mismatch: ${{hdPosterSha256}}`);
}}
const hdPosterInfo = webpInfo(hdPoster);
if (
  hdPosterInfo.width !== {WIDTH} ||
  hdPosterInfo.height !== {HEIGHT} ||
  hdPosterInfo.animated
) {{
  throw new Error(
    `Unexpected HD mobile poster: ${{hdPosterInfo.width}}x${{hdPosterInfo.height}}, animated=${{hdPosterInfo.animated}}`,
  );
}}
console.log(
  `Validated ${{hdVideoPath}}: {WIDTH}x{HEIGHT}, ${{hdVideo.byteLength}} bytes, sha256=${{hdVideoSha256}}`,
);
{validation_end}
'''
materializer_path = root / "scripts/materialize-mobile-forest-stream.mjs"
materializer_path.write_text(
    replace_marked(
        materializer_path.read_text(),
        validation_start,
        validation_end,
        validation_block,
    )
)

test_start = "// hd-mobile-video-v13-test-start"
test_end = "// hd-mobile-video-v13-test-end"
test_block = f'''{test_start}
test("portrait mobile autoplays the adaptive high-resolution background", async () => {{
  const [clientSource, pageSource, styleSource, materializerSource, hdVideo] =
    await Promise.all([
      read("public/mobile-quality.js"),
      read("src/page.js"),
      read("public/mobile-woodland-loop.css"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      readFile(new URL("../public/scenes/{VIDEO_FILE}", import.meta.url)),
    ]);

  assert.match(
    clientSource,
    /const HD_VIDEO_ASSET = "\\/scenes\\/{re.escape(VIDEO_FILE)}"/,
  );
  assert.match(
    clientSource,
    /const SMOOTH_VIDEO_ASSET = "\\/scenes\\/{re.escape(SD_VIDEO_FILE)}"/,
  );
  assert.match(clientSource, /requestVideoFrameCallback/);
  assert.match(clientSource, /low-presented-frame-cadence/);
  assert.match(clientSource, /video\\.src = SMOOTH_VIDEO_ASSET/);
  assert.match(clientSource, /video\\.autoplay = true/);
  assert.match(clientSource, /video\\.muted = true/);
  assert.match(clientSource, /video\\.playsInline = true/);

  assert.match(
    pageSource,
    /<video[\\s\\S]*id="mobile-background-video"[\\s\\S]*autoplay[\\s\\S]*muted[\\s\\S]*playsinline/,
  );
  assert.match(pageSource, /src="{re.escape(VIDEO_ASSET)}"/);
  assert.match(pageSource, /poster="{re.escape(POSTER_ASSET)}"/);
  assert.match(
    pageSource,
    /mobile-quality\\.js\\?v={re.escape(VERSION)}/,
  );
  assert.match(styleSource, /hd-mobile-video-v13-start/);
  assert.match(styleSource, /object-fit:\\s*cover/);
  assert.match(materializerSource, /hd-mobile-video-v13-validation-start/);

  assert.equal(hdVideo.byteLength, {video_bytes});
  assert.equal(hdVideo.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {{
    assert.ok(hdVideo.includes(Buffer.from(marker, "ascii")));
  }}
}});
{test_end}
'''
test_path = root / "test/mobile-background-loading.test.mjs"
test_path.write_text(
    replace_marked(
        test_path.read_text(),
        test_start,
        test_end,
        test_block,
    )
)

workflow = f'''name: Verify HD mobile background

on:
  pull_request:
    paths:
      - public/mobile-quality.js
      - public/mobile-woodland-loop.css
      - public/scenes/{VIDEO_FILE}
      - public/scenes/{POSTER_FILE}
      - scripts/materialize-mobile-forest-stream.mjs
      - src/page.js
      - .github/workflows/verify-mobile-hd-video.yml
  push:
    branches: [main]
    paths:
      - public/mobile-quality.js
      - public/mobile-woodland-loop.css
      - public/scenes/{VIDEO_FILE}
      - public/scenes/{POSTER_FILE}
      - scripts/materialize-mobile-forest-stream.mjs
      - src/page.js
      - .github/workflows/verify-mobile-hd-video.yml
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 20
    steps:
      - name: Check out repository
        uses: actions/checkout@v6
        with:
          persist-credentials: false

      - name: Install video tools
        shell: bash
        run: |
          set -euo pipefail
          if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
            sudo apt-get update -qq
            sudo apt-get install -y ffmpeg
          fi

      - name: Verify exact local HD asset and cadence
        shell: bash
        run: |
          set -euo pipefail
          video=public/scenes/{VIDEO_FILE}
          test "$(wc -c < "$video" | tr -d '[:space:]')" = {video_bytes}
          test "$(sha256sum "$video" | awk '{{print $1}}')" = {video_sha}
          probe="$(ffprobe -v error -select_streams v:0 \\
            -show_entries stream=codec_name,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate \\
            -of default=nw=1 "$video")"
          printf '%s\\n' "$probe"
          grep -Fq 'codec_name=h264' <<<"$probe"
          grep -Fq 'profile=Constrained Baseline' <<<"$probe"
          grep -Fq 'pix_fmt=yuv420p' <<<"$probe"
          grep -Fq 'width=1080' <<<"$probe"
          grep -Fq 'height=1920' <<<"$probe"
          grep -Fq 'level=40' <<<"$probe"
          grep -Fq 'r_frame_rate=24/1' <<<"$probe"
          grep -Fq 'avg_frame_rate=24/1' <<<"$probe"
          ffmpeg -hide_banner -v error -xerror -err_detect explode \\
            -i "$video" -map 0:v:0 -f null -
          ffmpeg -hide_banner -v error -i "$video" \\
            -vf "select='between(n,12,35)'" -vsync 0 \\
            -f framemd5 /tmp/hd-framemd5.txt
          unique_frames="$(awk '!/^#/ && NF >= 6 {{print $6}}' /tmp/hd-framemd5.txt \\
            | sort -u | wc -l | tr -d '[:space:]')"
          test "$unique_frames" -ge 20
          grep -Fq '{VERSION}' src/page.js
          grep -Fq 'requestVideoFrameCallback' public/mobile-quality.js
          grep -Fq 'low-presented-frame-cadence' public/mobile-quality.js
          echo "Local HD mobile video verified with $unique_frames distinct decoded frames."

      - name: Verify exact production deployment
        if: github.event_name == 'push'
        shell: bash
        run: |
          set -euo pipefail
          work=/tmp/stabilize-hd-production
          mkdir -p "$work"
          for attempt in {{1..36}}; do
            key="${{GITHUB_SHA}}-${{attempt}}"
            curl --fail --max-time 20 --silent --show-error \\
              --header 'Cache-Control: no-cache' \\
              "https://stabilize.info/?hd-video-release=${{key}}" \\
              > "$work/home.html" || true
            curl --fail --max-time 90 --silent --show-error \\
              --header 'Cache-Control: no-cache' \\
              --dump-header "$work/video.headers" \\
              "https://stabilize.info/scenes/{VIDEO_FILE}?release=${{key}}" \\
              > "$work/video.mp4" || true
            bytes="$(wc -c < "$work/video.mp4" 2>/dev/null | tr -d '[:space:]' || true)"
            sha="$(sha256sum "$work/video.mp4" 2>/dev/null | awk '{{print $1}}' || true)"
            echo "Attempt $attempt: bytes=${{bytes:-0}}/{video_bytes}; sha=${{sha:0:12}}."
            if grep -Fq '{VERSION}' "$work/home.html" \\
              && [[ "$bytes" == {video_bytes} ]] \\
              && [[ "$sha" == {video_sha} ]] \\
              && grep -qi '^cache-control:.*immutable' "$work/video.headers"; then
              ffmpeg -hide_banner -v error -xerror -err_detect explode \\
                -i "$work/video.mp4" -map 0:v:0 -f null -
              echo 'Exact HD autoplay mobile background is live.'
              exit 0
            fi
            sleep 10
          done
          echo '::error::Production never served the exact HD autoplay release.'
          exit 1
'''
write(".github/workflows/verify-mobile-hd-video.yml", workflow)

print(
    "Prepared HD autoplay mobile background release: "
    f"{VIDEO_FILE} ({video_bytes} bytes, sha256={video_sha}), "
    f"{POSTER_FILE} ({poster_bytes} bytes, sha256={poster_sha})."
)
