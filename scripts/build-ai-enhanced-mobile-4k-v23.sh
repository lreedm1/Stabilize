#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/mobile-ai-4k-v23}"
mkdir -p "$work/source" "$work/output" "$work/metrics"

for tool in ffmpeg ffprobe python sha256sum; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

# The current production poster is the exact selected forest scene and crop the
# user approved. Its 2160x3840 container came from a smaller master, so reduce it
# to its effective 1080 working resolution before applying learned restoration.
selected_poster='public/scenes/mobile-forest-stream-v14-retina-2160.webp'
selected_motion='public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4'

test -s "$selected_poster"
test -s "$selected_motion"
test "$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$selected_poster"
)" = 2160x3840
test "$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$selected_motion"
)" = 2160x3840

ffmpeg -hide_banner -v error -y \
  -i "$selected_poster" \
  -vf 'scale=1080:1920:flags=lanczos,format=rgb24' \
  -frames:v 1 "$work/source/selected-forest-1080.png"
ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$selected_motion" -map 0:v:0 -f null -

# Restore the full stationary scene with the official Real-ESRGAN x2 model.
cd /tmp/Real-ESRGAN
python inference_realesrgan.py \
  -n RealESRGAN_x2plus \
  -i "$work/source/selected-forest-1080.png" \
  -o "$work/output/upscaled" \
  --outscale 2 \
  --tile 192 \
  --tile_pad 16 \
  --pre_pad 0 \
  --fp32 \
  --ext png
cd - >/dev/null

upscaled="$(
  find "$work/output/upscaled" -maxdepth 1 -type f -name '*.png' | head -n 1
)"
test -n "$upscaled"
cp "$upscaled" "$work/output/selected-forest-ai-2160.png"
test "$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 \
    "$work/output/selected-forest-ai-2160.png"
)" = 2160x3840

# The approved motion layer occupies the creek on the right. Keep the enhanced
# forest and trail untouched, and borrow moving pixels only inside this soft
# mask so low-resolution motion can no longer soften the whole image.
python - "$work/source/water-mask-2160.pgm" <<'PY'
from pathlib import Path
import math
import sys

width, height = 2160, 3840
points = [
    (1380, 1840, 70),
    (1580, 1830, 110),
    (1800, 1800, 170),
    (2080, 1784, 230),
    (2400, 1800, 300),
    (2760, 1850, 380),
    (3160, 1930, 470),
    (3560, 2000, 560),
    (3838, 2030, 630),
]
feather = 144.0
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
            alpha = 230
        elif distance >= half_width + feather:
            alpha = 0
        else:
            phase = (distance - half_width) / feather
            alpha = round(230 * 0.5 * (1 + math.cos(math.pi * phase)))
        pixels[row + x] = alpha
Path(sys.argv[1]).write_bytes(
    f"P5\n{width} {height}\n255\n".encode() + pixels
)
PY

video="$work/output/mobile-forest-stream-video-v23-ai-2160.mp4"
poster="$work/output/mobile-forest-stream-v23-ai-2160.webp"

ffmpeg -hide_banner -v error -y \
  -loop 1 -framerate 24 \
    -i "$work/output/selected-forest-ai-2160.png" \
  -stream_loop -1 -i "$selected_motion" \
  -loop 1 -framerate 24 -i "$work/source/water-mask-2160.pgm" \
  -filter_complex "
    [0:v]scale=2160:3840:flags=lanczos,setsar=1,setpts=PTS-STARTPTS,format=yuv420p[base];
    [1:v]scale=2160:3840:flags=lanczos,setsar=1,setpts=PTS-STARTPTS,
      unsharp=5:5:0.25:5:5:0.0,format=rgb24[motion];
    [2:v]scale=2160:3840:flags=neighbor,setsar=1,setpts=PTS-STARTPTS,
      format=gray,gblur=sigma=28[mask];
    [motion][mask]alphamerge[water];
    [base][water]overlay=shortest=1:format=auto,format=yuv420p[out]
  " \
  -map '[out]' \
  -t 5.0 -r 24 -an \
  -c:v libx264 -profile:v high -level:v 5.1 \
  -preset slow -crf 14 -maxrate 40000k -bufsize 80000k \
  -g 24 -keyint_min 24 -sc_threshold 0 -bf 3 -refs 4 \
  -pix_fmt yuv420p -tag:v avc1 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart \
  "$video"

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$video" -map 0:v:0 -f null -
ffmpeg -hide_banner -v error -y \
  -i "$work/output/selected-forest-ai-2160.png" \
  -frames:v 1 -c:v libwebp -quality 95 -compression_level 6 \
  "$poster"

for asset in "$video" "$poster"; do
  test "$(
    ffprobe -v error -select_streams v:0 \
      -show_entries stream=width,height -of csv=s=x:p=0 "$asset"
  )" = 2160x3840
done
video_bytes="$(wc -c < "$video" | tr -d '[:space:]')"
test "$video_bytes" -gt 5000000
test "$video_bytes" -lt 30000000
ffprobe -v error -show_streams -show_format "$video" \
  > "$work/metrics/new-ffprobe.txt"
sha256sum "$video" "$poster" > "$work/metrics/sha256.txt"

# Compare the replacement against the same selected scene, not against an
# unrelated source image. Require materially more display-scale edge detail and
# high low-resolution structural similarity.
ffmpeg -hide_banner -v error -y -ss 1.5 -i "$selected_motion" \
  -frames:v 1 "$work/metrics/old-frame.png"
ffmpeg -hide_banner -v error -y -ss 1.5 -i "$video" \
  -frames:v 1 "$work/metrics/new-frame.png"

python - "$work/metrics/detail-report.json" <<'PY'
from pathlib import Path
import cv2
import json
import numpy as np
import sys
from skimage.metrics import structural_similarity

output = Path(sys.argv[1])
work = output.parent
old = cv2.imread(str(work / 'old-frame.png'))
new = cv2.imread(str(work / 'new-frame.png'))
if old is None or new is None:
    raise SystemExit('Could not decode comparison frames')

display_size = (1170, 2532)
old_display = cv2.resize(old, display_size, interpolation=cv2.INTER_LANCZOS4)
new_display = cv2.resize(new, display_size, interpolation=cv2.INTER_LANCZOS4)
# The left 70 percent contains the tree bark, foliage, and trail whose softness
# prompted the change; it excludes most naturally blurred moving water.
roi_old = old_display[0:2450, 0:820]
roi_new = new_display[0:2450, 0:820]
gray_old = cv2.cvtColor(roi_old, cv2.COLOR_BGR2GRAY)
gray_new = cv2.cvtColor(roi_new, cv2.COLOR_BGR2GRAY)
lap_old = float(cv2.Laplacian(gray_old, cv2.CV_64F).var())
lap_new = float(cv2.Laplacian(gray_new, cv2.CV_64F).var())
edge_ratio = lap_new / max(lap_old, 1e-9)

old_small = cv2.resize(old, (540, 960), interpolation=cv2.INTER_AREA)
new_small = cv2.resize(new, (540, 960), interpolation=cv2.INTER_AREA)
ssim = float(structural_similarity(
    cv2.cvtColor(old_small, cv2.COLOR_BGR2GRAY),
    cv2.cvtColor(new_small, cv2.COLOR_BGR2GRAY),
    data_range=255,
))
mae = float(np.abs(
    old_small.astype(np.float32) - new_small.astype(np.float32)
).mean())
report = {
    'old_display_laplacian_variance': lap_old,
    'new_display_laplacian_variance': lap_new,
    'edge_detail_ratio': edge_ratio,
    'scene_ssim_at_540x960': ssim,
    'scene_mean_absolute_error': mae,
}
output.write_text(json.dumps(report, indent=2))
print(json.dumps(report, indent=2))
if edge_ratio < 1.08:
    raise SystemExit(
        f'Enhanced frame did not add enough display-scale detail: {edge_ratio:.3f}'
    )
if ssim < 0.80:
    raise SystemExit(
        f'Enhanced frame drifted from the selected scene: SSIM={ssim:.3f}'
    )
PY

printf 'video=%s\nvideo_bytes=%s\nposter=%s\n' \
  "$video" "$video_bytes" "$poster"
