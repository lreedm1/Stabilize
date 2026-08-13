#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-water-sprite-v18}"
mkdir -p "$work"

source_video="public/scenes/mobile-forest-stream-video-v12-720.mp4"
output="$work/mobile-forest-stream-water-sprite-v18-540.webp"

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
test "$source_dimensions" = 720x1280

# Rebuild the same feathered stream mask used by the source video. The visible
# page keeps a full Retina still underneath; only the water region is animated
# on a small transparent canvas, avoiding both video-autoplay and animated-image
# autoplay policies while preserving a sharp overall background.
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

# Thirty transparent 540x960 frames cover the complete five-second loop at
# six visible frames per second. They are packed into one 6x5 WebP atlas so the
# browser decodes one image and JavaScript can draw frames without media.play().
ffmpeg -hide_banner -v error -y \
  -i "$source_video" \
  -loop 1 -framerate 6 -i "$work/water-mask.pgm" \
  -filter_complex "
    [0:v]fps=6,scale=540:960:flags=lanczos,format=rgba[video];
    [1:v]crop=956:1700:62:0,scale=540:960:flags=lanczos,
      format=gray,gblur=sigma=10[mask];
    [video][mask]alphamerge[water];
    [water]tile=6x5:nb_frames=30:padding=0:margin=0[sheet]
  " \
  -map '[sheet]' -frames:v 1 \
  -c:v libwebp -lossless 0 -quality 82 -compression_level 6 \
  "$output"

test "$(dd if="$output" bs=1 count=4 status=none)" = RIFF
test "$(dd if="$output" bs=1 skip=8 count=4 status=none)" = WEBP
grep -aq ALPH "$output"

sprite_dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$output"
)"
test "$sprite_dimensions" = 3240x4800

webpmux -info "$output" > "$work/webpmux-info.txt"
grep -Eq 'Canvas size:[[:space:]]*3240 x 4800' "$work/webpmux-info.txt"

# Decode three cells and prove that the atlas contains changing water frames.
for sample in first middle last; do
  case "$sample" in
    first) x=0; y=0 ;;
    middle) x=1080; y=1920 ;;
    last) x=2700; y=3840 ;;
  esac
  ffmpeg -hide_banner -v error -y -i "$output" \
    -vf "crop=540:960:${x}:${y}" -frames:v 1 \
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
test "$bytes" -lt 10000000

printf 'output=%s\nbytes=%s\nsha256=%s\nframe_width=540\nframe_height=960\nframes=30\nfps=6\n' \
  "$output" "$bytes" "$sha"
