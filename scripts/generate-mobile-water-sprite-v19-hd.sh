#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-water-sprite-v19-hd}"
mkdir -p "$work"

source_video="public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
output="$work/mobile-forest-stream-water-sprite-v19-hd-1080.webp"

for tool in ffmpeg ffprobe webpmux dwebp sha256sum python; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

test -f "$source_video"

source_dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$source_video"
)"
test "$source_dimensions" = 2160x3840

# Build the feathered stream mask in the 1080x1920 composition coordinate
# system. The page keeps the complete 2160x3840 Retina poster underneath; the
# sprite contains only the moving water crop, so Safari does not have to decode
# a quarter-gigabyte full-frame atlas merely to animate a narrow stream.
python - "$work/water-mask.pgm" <<'PY'
from pathlib import Path
import math
import sys

width, height = 1080, 1920
points = [
    (690, 920, 35),
    (790, 915, 55),
    (900, 900, 85),
    (1040, 892, 115),
    (1200, 900, 150),
    (1380, 925, 190),
    (1580, 965, 235),
    (1780, 1000, 280),
    (1919, 1015, 315),
]
feather = 72.0
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
    f"P5\n{width} {height}\n255\n".encode() + pixels
)
PY

# Sample the true 2160x3840 source into a 1080x1920 composition, apply the
# feathered mask, and retain only the 400x1200 region containing water. Thirty
# frames are packed into a 6x5 static WebP atlas. This preserves Retina-level
# moving detail while keeping decoded memory close to the former 540p atlas.
ffmpeg -hide_banner -v error -y \
  -i "$source_video" \
  -loop 1 -framerate 6 -i "$work/water-mask.pgm" \
  -filter_complex "
    [0:v]fps=6,scale=1080:1920:flags=lanczos,format=rgba[video];
    [1:v]crop=956:1700:62:0,scale=1080:1920:flags=lanczos,
      format=gray,gblur=sigma=20[mask];
    [video][mask]alphamerge,crop=400:1200:680:720[water];
    [water]tile=6x5:nb_frames=30:padding=0:margin=0[sheet]
  " \
  -map '[sheet]' -frames:v 1 \
  -c:v libwebp -lossless 0 -quality 88 -compression_level 6 \
  "$output"

test "$(dd if="$output" bs=1 count=4 status=none)" = RIFF
test "$(dd if="$output" bs=1 skip=8 count=4 status=none)" = WEBP
grep -aq ALPH "$output"

sprite_dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$output"
)"
test "$sprite_dimensions" = 2400x6000

webpmux -info "$output" > "$work/webpmux-info.txt"
grep -Eq 'Canvas size:[[:space:]]*2400 x 6000' "$work/webpmux-info.txt"

# Decode three cells and prove that the atlas contains changing water frames.
for sample in first middle last; do
  case "$sample" in
    first) x=0; y=0 ;;
    middle) x=800; y=2400 ;;
    last) x=2000; y=4800 ;;
  esac
  ffmpeg -hide_banner -v error -y -i "$output" \
    -vf "crop=400:1200:${x}:${y}" -frames:v 1 \
    "$work/frame-${sample}.png"
  test -s "$work/frame-${sample}.png"
done

first_sha="$(sha256sum "$work/frame-first.png" | awk '{print $1}')"
middle_sha="$(sha256sum "$work/frame-middle.png" | awk '{print $1}')"
last_sha="$(sha256sum "$work/frame-last.png" | awk '{print $1}')"
test "$first_sha" != "$middle_sha"
test "$middle_sha" != "$last_sha"

bytes="$(wc -c < "$output" | tr -d '[:space:]')"
sha="$(sha256sum "$output" | awk '{print $1}')"
test "$bytes" -gt 1000000
test "$bytes" -lt 12000000

printf 'output=%s\nbytes=%s\nsha256=%s\ncomposition_width=1080\ncomposition_height=1920\nframe_left=680\nframe_top=720\nframe_width=400\nframe_height=1200\nframes=30\nfps=6\n' \
  "$output" "$bytes" "$sha"
