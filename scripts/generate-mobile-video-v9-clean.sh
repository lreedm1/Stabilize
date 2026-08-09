#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-video-v11-clean}"
mkdir -p "$work"

if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  echo 'ffmpeg and ffprobe are required' >&2
  exit 1
fi

mapfile -t poster_parts < <(
  find materialize/mobile-forest-stream -maxdepth 1 -type f \
    -name '*.b64' | sort
)
test "${#poster_parts[@]}" -gt 0
cat "${poster_parts[@]}" \
  | tr -d '[:space:]' \
  | base64 --decode \
  > "$work/still.webp"

mapfile -t motion_parts < <(
  find public/scenes -maxdepth 1 -type f \
    -name 'mobile-forest-stream-loop-v1.part*.b64' | sort
)
test "${#motion_parts[@]}" -eq 5
cat "${motion_parts[@]}" \
  | tr -d '[:space:]' \
  | base64 --decode \
  > "$work/motion.mp4"

still_dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$work/still.webp"
)"
test "$still_dimensions" = 540x960
ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$work/motion.mp4" -map 0:v:0 -f null -

python - "$work/water-mask.pgm" <<'PY'
from pathlib import Path
import math
import sys

width, height = 1536, 2732
points = [
    (982, 1309, 50),
    (1124, 1302, 78),
    (1280, 1280, 121),
    (1479, 1269, 164),
    (1707, 1280, 213),
    (1963, 1316, 270),
    (2248, 1373, 334),
    (2532, 1422, 398),
    (2731, 1444, 448),
]
feather = 102.0
pixels = bytearray(width * height)

for y in range(height):
    if y < points[0][0]:
        continue
    upper = points[-1]
    lower = points[-1]
    for index in range(len(points) - 1):
        if points[index][0] <= y <= points[index + 1][0]:
            upper = points[index]
            lower = points[index + 1]
            break
    span = max(1, lower[0] - upper[0])
    t = min(1.0, max(0.0, (y - upper[0]) / span))
    center = upper[1] + (lower[1] - upper[1]) * t
    half_width = upper[2] + (lower[2] - upper[2]) * t
    row = y * width
    for x in range(width):
        distance = abs(x - center)
        if distance <= half_width:
            alpha = 255
        elif distance >= half_width + feather:
            alpha = 0
        else:
            phase = (distance - half_width) / feather
            alpha = round(255 * 0.5 * (1 + math.cos(math.pi * phase)))
        pixels[row + x] = alpha

Path(sys.argv[1]).write_bytes(
    f'P5\n{width} {height}\n255\n'.encode() + pixels
)
PY

output="$work/mobile-forest-stream-video-v11-1536.mp4"
ffmpeg -hide_banner -v error -y \
  -loop 1 -framerate 30 -i "$work/still.webp" \
  -stream_loop -1 -i "$work/motion.mp4" \
  -loop 1 -framerate 30 -i "$work/water-mask.pgm" \
  -filter_complex "
    [0:v]crop=506:900:17:0,scale=1536:2732:flags=lanczos,unsharp=5:5:0.52:5:5:0.0,setsar=1,setpts=PTS-STARTPTS,format=yuv420p[still];
    [1:v]crop=300:533:10:0,scale=1536:2732:flags=lanczos,setsar=1,setpts=PTS-STARTPTS,format=yuv420p,split=2[mglobal][mwater];
    [still][mglobal]blend=all_mode=normal:all_opacity=0.040[base];
    [2:v]scale=1536:2732:flags=neighbor,setsar=1,setpts=PTS-STARTPTS,format=gray,gblur=sigma=28[mask];
    [mwater]format=rgb24[mrgb];
    [mrgb][mask]alphamerge[water];
    [base][water]overlay=shortest=1:format=auto,format=yuv420p[out]
  " \
  -map '[out]' \
  -t 5.066667 -r 30 -an \
  -c:v libx264 -profile:v main -level:v 5.0 \
  -preset slow -b:v 1300k -maxrate 1800k -bufsize 3600k \
  -g 30 -keyint_min 30 -sc_threshold 0 \
  -pix_fmt yuv420p -movflags +faststart \
  "$output"

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$output" -map 0:v:0 -f null -

probe="$work/probe.json"
ffprobe -hide_banner -v error \
  -show_entries \
    stream=codec_name,profile,pix_fmt,width,height,level,r_frame_rate,nb_frames:format=duration,size \
  -of json "$output" > "$probe"

python - "$probe" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
streams = data.get('streams', [])
if len(streams) != 1:
    raise SystemExit(f'Expected one video stream, found {len(streams)}')
stream = streams[0]
expected = {
    'codec_name': 'h264',
    'profile': 'Main',
    'pix_fmt': 'yuv420p',
    'width': 1536,
    'height': 2732,
}
for key, value in expected.items():
    if stream.get(key) != value:
        raise SystemExit(f'Unexpected {key}: {stream.get(key)!r}; expected {value!r}')
if stream.get('r_frame_rate') != '30/1':
    raise SystemExit(f"Unexpected frame rate: {stream.get('r_frame_rate')}")
if int(stream.get('nb_frames', 0)) < 150:
    raise SystemExit(f"Too few frames: {stream.get('nb_frames')}")
duration = float(data['format']['duration'])
if not 5.0 <= duration <= 5.2:
    raise SystemExit(f'Unexpected duration: {duration}')
PY

audio_streams="$(
  ffprobe -v error -select_streams a \
    -show_entries stream=index -of csv=p=0 "$output"
)"
test -z "$audio_streams"

ffmpeg -hide_banner -v error -ss 0.5 -i "$output" \
  -frames:v 1 "$work/frame-early.png"
ffmpeg -hide_banner -v error -ss 3.0 -i "$output" \
  -frames:v 1 "$work/frame-late.png"
early_sha="$(sha256sum "$work/frame-early.png" | awk '{print $1}')"
late_sha="$(sha256sum "$work/frame-late.png" | awk '{print $1}')"
test "$early_sha" != "$late_sha"

bytes="$(wc -c < "$output" | tr -d '[:space:]')"
sha="$(sha256sum "$output" | awk '{print $1}')"
test "$bytes" -gt 300000
test "$bytes" -lt 8000000
test "$(dd if="$output" bs=1 skip=4 count=4 status=none)" = ftyp
moov_offset="$(grep -abo -m1 moov "$output" | cut -d: -f1)"
mdat_offset="$(grep -abo -m1 mdat "$output" | cut -d: -f1)"
test "$moov_offset" -lt "$mdat_offset"

printf 'output=%s\nbytes=%s\nsha256=%s\n' "$output" "$bytes" "$sha"
