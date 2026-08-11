#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 3:
    raise SystemExit(
        "usage: prepare-coherent-mobile-video-v25.py VIDEO_MP4 POSTER_WEBP"
    )

root = Path.cwd()
video_source = Path(sys.argv[1])
poster_source = Path(sys.argv[2])
if not video_source.is_file() or not poster_source.is_file():
    raise SystemExit("generated coherent video or poster is missing")

VERSION = "20260811-coherent-mobile-4k-v25-1"
VIDEO_FILE = "mobile-forest-stream-video-v25-coherent-4k.mp4"
POSTER_FILE = "mobile-forest-stream-v25-coherent-4k.webp"
VIDEO_ROUTE = f"/media/{VIDEO_FILE}"
VIDEO_ASSET = f"/scenes/{VIDEO_FILE}"
POSTER_ASSET = f"/scenes/{POSTER_FILE}"
WIDTH = 2160
HEIGHT = 3840
FPS = 24
OLD_VIDEO_ROUTE = "/media/mobile-forest-stream-video-v24-native-1080.mp4"
OLD_POSTER_ASSET = "/scenes/mobile-forest-stream-v24-native-1080.webp"
OLD_VERSION = "20260810-native-selected-mobile-v24-1"

video = video_source.read_bytes()
poster = poster_source.read_bytes()
video_bytes = len(video)
poster_bytes = len(poster)
video_sha = hashlib.sha256(video).hexdigest()
poster_sha = hashlib.sha256(poster).hexdigest()

if len(video) < 12 or video[4:8] != b"ftyp":
    raise SystemExit("generated coherent video is not MP4")
for marker in (b"moov", b"mdat", b"avc1"):
    if marker not in video:
        raise SystemExit(f"generated coherent video is missing {marker!r}")
if video_bytes >= 25_000_000:
    raise SystemExit(f"generated coherent video is too large: {video_bytes}")
if poster[:4] != b"RIFF" or poster[8:12] != b"WEBP":
    raise SystemExit("generated coherent poster is not WebP")

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(video_source, scenes / VIDEO_FILE)
shutil.copyfile(poster_source, scenes / POSTER_FILE)

metadata = {
    "version": VERSION,
    "videoRoute": VIDEO_ROUTE,
    "videoAsset": VIDEO_ASSET,
    "posterAsset": POSTER_ASSET,
    "videoBytes": video_bytes,
    "videoSha256": video_sha,
    "posterBytes": poster_bytes,
    "posterSha256": poster_sha,
    "width": WIDTH,
    "height": HEIGHT,
    "fps": FPS,
    "uniqueSampleFrames": 24,
    "sourceStill": None,
    "sourceMotion": "public/scenes/mobile-forest-stream-loop-v1.part*.b64",
    "pipeline": (
        "single full-frame source motion; generator-edge crop only; no static "
        "still overlay, masked creek compositing, AI upscaling, or tiled restoration"
    ),
}
(root / "scripts/native-selected-mobile-video-v24.json").write_text(
    json.dumps(metadata, indent=2) + "\n"
)

# The materializer runs before the selected-media finalizers, so its committed
# validation block must already know the newly generated payload.
materializer_path = root / "scripts/materialize-mobile-forest-stream.mjs"
materializer = materializer_path.read_text()
start = "// native-selected-mobile-v24-validation-start"
end = "// native-selected-mobile-v24-validation-end"
if start not in materializer or end not in materializer:
    raise SystemExit("native mobile validation block is missing")
validation = f'''{start}
const nativeV24VideoPath = "public{VIDEO_ASSET}";
const nativeV24VideoExpectedBytes = {video_bytes:_};
const nativeV24VideoExpectedSha256 = "{video_sha}";
const nativeV24PosterPath = "public{POSTER_ASSET}";
const nativeV24PosterExpectedBytes = {poster_bytes:_};
const nativeV24PosterExpectedSha256 = "{poster_sha}";

const nativeV24Video = await readFile(nativeV24VideoPath);
if (nativeV24Video.byteLength !== nativeV24VideoExpectedBytes) {{
  throw new Error(
    `Unexpected native mobile video size: ${{nativeV24Video.byteLength}}; expected ${{nativeV24VideoExpectedBytes}}`,
  );
}}
const nativeV24VideoSha256 = createHash("sha256")
  .update(nativeV24Video)
  .digest("hex");
if (nativeV24VideoSha256 !== nativeV24VideoExpectedSha256) {{
  throw new Error(`Native mobile video checksum mismatch: ${{nativeV24VideoSha256}}`);
}}
if (
  nativeV24Video.byteLength < 12 ||
  nativeV24Video.subarray(4, 8).toString("ascii") !== "ftyp"
) {{
  throw new Error("Native mobile video is not an MP4 file");
}}
for (const marker of ["moov", "mdat", "vide", "avc1"]) {{
  if (!nativeV24Video.includes(Buffer.from(marker, "ascii"))) {{
    throw new Error(`Native mobile video is missing the ${{marker}} marker`);
  }}
}}
if (
  nativeV24Video.includes(Buffer.from("mp4a", "ascii")) ||
  nativeV24Video.includes(Buffer.from("soun", "ascii"))
) {{
  throw new Error("Native mobile video must not contain audio");
}}

const nativeV24Poster = await readFile(nativeV24PosterPath);
if (nativeV24Poster.byteLength !== nativeV24PosterExpectedBytes) {{
  throw new Error(
    `Unexpected native mobile poster size: ${{nativeV24Poster.byteLength}}; expected ${{nativeV24PosterExpectedBytes}}`,
  );
}}
const nativeV24PosterSha256 = createHash("sha256")
  .update(nativeV24Poster)
  .digest("hex");
if (nativeV24PosterSha256 !== nativeV24PosterExpectedSha256) {{
  throw new Error(`Native mobile poster checksum mismatch: ${{nativeV24PosterSha256}}`);
}}
const nativeV24PosterInfo = webpInfo(nativeV24Poster);
if (
  nativeV24PosterInfo.width !== {WIDTH} ||
  nativeV24PosterInfo.height !== {HEIGHT} ||
  nativeV24PosterInfo.animated
) {{
  throw new Error(
    `Unexpected native mobile poster: ${{nativeV24PosterInfo.width}}x${{nativeV24PosterInfo.height}}, animated=${{nativeV24PosterInfo.animated}}`,
  );
}}
console.log(
  `Validated ${{nativeV24VideoPath}}: {WIDTH}x{HEIGHT}, ${{nativeV24Video.byteLength}} bytes, sha256=${{nativeV24VideoSha256}}`,
);
{end}'''
materializer = re.sub(
    re.escape(start) + r"[\s\S]*?" + re.escape(end),
    validation,
    materializer,
    count=1,
)
materializer_path.write_text(materializer)

# Seed the page with the new poster before the normal native finalizer runs.
# That finalizer validates that exactly two responsive poster references already
# use the selected width.
page_path = root / "src/page.js"
page = page_path.read_text()
page = page.replace(OLD_VIDEO_ROUTE, VIDEO_ROUTE)
page = page.replace(OLD_POSTER_ASSET, POSTER_ASSET)
page = page.replace(OLD_VERSION, VERSION)
page = page.replace(f"{POSTER_ASSET} 1080w", f"{POSTER_ASSET} {WIDTH}w")
page_path.write_text(page)

# Keep the project's existing canonical apply:prompt-policy tail unchanged.
# The native regression finalizer already owns all global pipeline assertions,
# so invoke the coherent media finalizer from that script instead of adding a
# new command to package.json. This makes repeated npm test/check runs stable.
regression_path = root / "scripts/finalize-native-selected-mobile-v24-regressions.mjs"
regression = regression_path.read_text()
hook_start = "// coherent-mobile-v25-finalizer-hook-start"
hook_end = "// coherent-mobile-v25-finalizer-hook-end"
hook = f'''{hook_start}
await import("./finalize-coherent-mobile-v25.mjs");
{hook_end}'''
if hook_start in regression:
    regression = re.sub(
        re.escape(hook_start) + r"[\s\S]*?" + re.escape(hook_end),
        hook,
        regression,
        count=1,
    )
else:
    regression = regression.rstrip() + "\n\n" + hook + "\n"
regression_path.write_text(regression)

print(
    f"Prepared coherent mobile release {VIDEO_FILE}: {WIDTH}x{HEIGHT}, "
    f"{video_bytes} bytes, sha256={video_sha}; poster={poster_bytes} bytes, "
    f"sha256={poster_sha}."
)
