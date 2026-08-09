#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-motion-v16}"
mkdir -p "$work"

source_video="public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
output="$work/mobile-forest-stream-motion-v16-1440.webp"

for tool in ffmpeg webpmux dwebp sha256sum; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

test -f "$source_video"

# iOS can reject media autoplay under device/browser policy even for a muted
# inline video. Animated WebP is not gated by the media-autoplay permission, so
# it provides immediate water motion at a width above current iPhone screen
# resolution without requiring a tap.
ffmpeg -hide_banner -v error -y \
  -i "$source_video" \
  -vf "fps=10,scale=1440:2560:flags=lanczos" \
  -an -c:v libwebp -lossless 0 -quality 62 -compression_level 6 \
  -loop 0 -vsync 0 "$output"

test "$(dd if="$output" bs=1 count=4 status=none)" = RIFF
test "$(dd if="$output" bs=1 skip=8 count=4 status=none)" = WEBP
grep -aq ANIM "$output"
grep -aq ANMF "$output"

# FFmpeg 6 can encode animated WebP but its decoder does not reliably inspect
# every animation. Use libwebp's native mux tools for structural validation.
webpmux -info "$output" > "$work/webpmux-info.txt"
grep -Eq 'Canvas size:[[:space:]]*1440 x 2560' "$work/webpmux-info.txt"
frame_count="$(
  sed -n 's/.*Number of frames:[[:space:]]*\([0-9][0-9]*\).*/\1/p' \
    "$work/webpmux-info.txt" | head -n 1
)"
test -n "$frame_count"
test "$frame_count" -ge 48

# Extract representative frames with libwebp and decode them. Different hashes
# prove that the file contains visible motion rather than repeated still frames.
mid_frame="$((frame_count / 2))"
for frame in 1 "$mid_frame" "$frame_count"; do
  webpmux -get frame "$frame" "$output" -o "$work/frame-${frame}.webp" >/dev/null
  dwebp "$work/frame-${frame}.webp" -o "$work/frame-${frame}.png" >/dev/null 2>&1
  test -s "$work/frame-${frame}.png"
done

first_sha="$(sha256sum "$work/frame-1.png" | awk '{print $1}')"
mid_sha="$(sha256sum "$work/frame-${mid_frame}.png" | awk '{print $1}')"
last_sha="$(sha256sum "$work/frame-${frame_count}.png" | awk '{print $1}')"
test "$first_sha" != "$mid_sha"
test "$mid_sha" != "$last_sha"
unique_frames=3

bytes="$(wc -c < "$output" | tr -d '[:space:]')"
sha="$(sha256sum "$output" | awk '{print $1}')"
test "$bytes" -gt 700000
test "$bytes" -lt 25000000

printf 'output=%s\nbytes=%s\nsha256=%s\nframes=%s\nvalidated_distinct_samples=%s\n' \
  "$output" "$bytes" "$sha" "$frame_count" "$unique_frames"
