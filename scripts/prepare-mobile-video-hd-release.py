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
    raise SystemExit("validated Retina video and poster files are required")

VIDEO_FILE = "mobile-forest-stream-video-v14-retina-2160.mp4"
VIDEO_ASSET = f"/scenes/{VIDEO_FILE}"
POSTER_FILE = "mobile-forest-stream-v14-retina-2160.webp"
POSTER_ASSET = f"/scenes/{POSTER_FILE}"
SD_VIDEO_FILE = "mobile-forest-stream-video-v12-720.mp4"
SD_VIDEO_ASSET = f"/scenes/{SD_VIDEO_FILE}"
VERSION = "20260809-mobile-video-v14-retina-autoplay-1"
STYLE_VERSION = "20260809-mobile-video-v14-retina-autoplay-1"
WIDTH = 2160
HEIGHT = 3840

video = video_source.read_bytes()
poster = poster_source.read_bytes()
video_bytes = len(video)
poster_bytes = len(poster)
video_sha = hashlib.sha256(video).hexdigest()
poster_sha = hashlib.sha256(poster).hexdigest()

if not 1_500_000 < video_bytes < 20_000_000:
    raise SystemExit(f"Retina video has an unexpected size: {video_bytes}")
if video[4:8] != b"ftyp":
    raise SystemExit("Retina video is not an MP4")
if poster[:4] != b"RIFF" or poster[8:12] != b"WEBP":
    raise SystemExit("Retina poster is not a WebP")
for marker in (b"moov", b"mdat", b"vide", b"avc1"):
    if marker not in video:
        raise SystemExit(f"Retina video is missing {marker.decode()} marker")
if b"mp4a" in video or b"soun" in video:
    raise SystemExit("Retina video must not contain audio")

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(video_source, scenes / VIDEO_FILE)
shutil.copyfile(poster_source, scenes / POSTER_FILE)


def replace_marked(source: str, start: str, end: str, block: str) -> str:
    pattern = re.compile(
        re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?"
    )
    if start in source:
        source, count = pattern.subn(lambda _: block, source, count=1)
        if count != 1:
            raise SystemExit(f"could not replace marked block {start}")
        return source
    suffix = "" if source.endswith("\n") else "\n"
    return source + suffix + "\n" + block


# Install a client that always selects the Retina stream first, begins muted
# inline playback immediately, retries visible-page pauses, and only lowers
# resolution after a real media failure.
template = root / "scripts/mobile-quality-hd-template.js"
if not template.is_file():
    raise SystemExit("Retina mobile client template is missing")
shutil.copyfile(template, root / "public/mobile-quality.js")

video_start = "<!-- retina-mobile-video-v14-start -->"
video_end = "<!-- retina-mobile-video-v14-end -->"
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
for old_start, old_end in (
    ("<!-- hd-mobile-video-v13-start -->", "<!-- hd-mobile-video-v13-end -->"),
    (video_start, video_end),
):
    if old_start in page:
        pattern = re.compile(
            r"    "
            + re.escape(old_start)
            + r"[\s\S]*?    "
            + re.escape(old_end)
            + r"\n?"
        )
        page, count = pattern.subn(lambda _: video_block, page, count=1)
        if count != 1:
            raise SystemExit(f"could not replace video block {old_start}")
        break
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

style_start = "/* retina-mobile-video-v14-start */"
style_end = "/* retina-mobile-video-v14-end */"
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
    -webkit-transform: translate3d(0, 0, 0);
    backface-visibility: hidden;
    -webkit-backface-visibility: hidden;
    contain: strict;
  }}
}}
{style_end}
'''
style_path = root / "public/mobile-woodland-loop.css"
style_path.write_text(
    replace_marked(style_path.read_text(), style_start, style_end, style_block)
)

# Keep the canonical background generator from restoring the previous cache key
# during every apply:prompt-policy pass.
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

headers_start = "# retina-mobile-video-v14-start"
headers_end = "# retina-mobile-video-v14-end"
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

validation_start = "// retina-mobile-video-v14-validation-start"
validation_end = "// retina-mobile-video-v14-validation-end"
validation_block = f'''{validation_start}
const retinaVideoPath = "public/scenes/{VIDEO_FILE}";
const retinaVideoExpectedBytes = {video_bytes:_};
const retinaVideoExpectedSha256 = "{video_sha}";
const retinaPosterPath = "public/scenes/{POSTER_FILE}";
const retinaPosterExpectedBytes = {poster_bytes:_};
const retinaPosterExpectedSha256 = "{poster_sha}";

const retinaVideo = await readFile(retinaVideoPath);
if (retinaVideo.byteLength !== retinaVideoExpectedBytes) {{
  throw new Error(
    `Unexpected Retina mobile video size: ${{retinaVideo.byteLength}}; expected ${{retinaVideoExpectedBytes}}`,
  );
}}
const retinaVideoSha256 = createHash("sha256")
  .update(retinaVideo)
  .digest("hex");
if (retinaVideoSha256 !== retinaVideoExpectedSha256) {{
  throw new Error(`Retina mobile video checksum mismatch: ${{retinaVideoSha256}}`);
}}
if (
  retinaVideo.byteLength < 12 ||
  retinaVideo.subarray(4, 8).toString("ascii") !== "ftyp"
) {{
  throw new Error("Retina mobile video is not an MP4 file");
}}
for (const marker of ["moov", "mdat", "vide", "avc1"]) {{
  if (!retinaVideo.includes(Buffer.from(marker, "ascii"))) {{
    throw new Error(`Retina mobile video is missing the ${{marker}} marker`);
  }}
}}
if (
  retinaVideo.includes(Buffer.from("mp4a", "ascii")) ||
  retinaVideo.includes(Buffer.from("soun", "ascii"))
) {{
  throw new Error("Retina mobile video must not contain audio");
}}

const retinaPoster = await readFile(retinaPosterPath);
if (retinaPoster.byteLength !== retinaPosterExpectedBytes) {{
  throw new Error(
    `Unexpected Retina mobile poster size: ${{retinaPoster.byteLength}}; expected ${{retinaPosterExpectedBytes}}`,
  );
}}
const retinaPosterSha256 = createHash("sha256")
  .update(retinaPoster)
  .digest("hex");
if (retinaPosterSha256 !== retinaPosterExpectedSha256) {{
  throw new Error(
    `Retina mobile poster checksum mismatch: ${{retinaPosterSha256}}`,
  );
}}
const retinaPosterInfo = webpInfo(retinaPoster);
if (
  retinaPosterInfo.width !== {WIDTH} ||
  retinaPosterInfo.height !== {HEIGHT} ||
  retinaPosterInfo.animated
) {{
  throw new Error(
    `Unexpected Retina mobile poster: ${{retinaPosterInfo.width}}x${{retinaPosterInfo.height}}, animated=${{retinaPosterInfo.animated}}`,
  );
}}
console.log(
  `Validated ${{retinaVideoPath}}: {WIDTH}x{HEIGHT}, ${{retinaVideo.byteLength}} bytes, sha256=${{retinaVideoSha256}}`,
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

test_start = "// retina-mobile-video-v14-test-start"
test_end = "// retina-mobile-video-v14-test-end"


def js_regex(value: str) -> str:
    return re.escape(value).replace("/", r"\/")


js_video_asset = js_regex(VIDEO_ASSET)
js_video_file = js_regex(VIDEO_FILE)
js_poster_asset = js_regex(POSTER_ASSET)
js_version = js_regex(VERSION)
test_block = f'''{test_start}
test("portrait mobile always autoplays the Retina background", async () => {{
  const [clientSource, pageSource, styleSource, materializerSource, retinaVideo] =
    await Promise.all([
      read("public/mobile-quality.js"),
      read("src/page.js"),
      read("public/mobile-woodland-loop.css"),
      read("scripts/materialize-mobile-forest-stream.mjs"),
      readFile(new URL("../public/scenes/{VIDEO_FILE}", import.meta.url)),
    ]);

  assert.match(
    clientSource,
    /const RETINA_VIDEO_ASSET =[\\s\\S]*"{js_video_asset}"/,
  );
  assert.match(clientSource, /video\\.src = RETINA_VIDEO_ASSET/);
  assert.match(clientSource, /video\\.autoplay = true/);
  assert.match(clientSource, /video\\.muted = true/);
  assert.match(clientSource, /video\\.defaultMuted = true/);
  assert.match(clientSource, /video\\.loop = true/);
  assert.match(clientSource, /video\\.playsInline = true/);
  assert.match(clientSource, /video\\.addEventListener\\("pause"/);
  assert.match(clientSource, /scheduleAutoplayRetry\\(video\\)/);
  assert.doesNotMatch(
    clientSource,
    /prefersStandardDefinition|prefers-reduced-data|saveData/,
  );

  assert.match(
    pageSource,
    /<video[\\s\\S]*id="mobile-background-video"[\\s\\S]*autoplay[\\s\\S]*muted[\\s\\S]*loop[\\s\\S]*playsinline/,
  );
  assert.match(pageSource, /src="{js_video_asset}"/);
  assert.match(pageSource, /poster="{js_poster_asset}"/);
  assert.match(pageSource, /mobile-quality\\.js\\?v={js_version}/);
  assert.match(styleSource, /retina-mobile-video-v14-start/);
  assert.match(styleSource, /object-fit:\\s*cover/);
  assert.match(materializerSource, /retina-mobile-video-v14-validation-start/);
  assert.match(materializerSource, /{js_video_file}/);

  assert.equal(retinaVideo.byteLength, {video_bytes});
  assert.equal(retinaVideo.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {{
    assert.ok(retinaVideo.includes(Buffer.from(marker, "ascii")));
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

print(
    "Prepared always-autoplay Retina mobile background release: "
    f"{VIDEO_FILE} ({video_bytes} bytes, sha256={video_sha}), "
    f"{POSTER_FILE} ({poster_bytes} bytes, sha256={poster_sha})."
)
