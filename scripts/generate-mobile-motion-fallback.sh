#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-motion-v16}"
mkdir -p "$work"

source_video="public/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
output="$work/mobile-forest-stream-motion-v16-1080.webp"

for tool in ffmpeg ffprobe sha256sum; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

test -f "$source_video"

# iOS can reject media autoplay under device/browser policy even for a muted
# inline video. Animated WebP is not gated by the media-autoplay permission, so
# it provides immediate water motion beneath the higher-resolution MP4.
ffmpeg -hide_banner -v error -y \
  -i "$source_video" \
  -vf "fps=12,scale=1080:1920:flags=lanczos" \
  -an -c:v libwebp -lossless 0 -quality 68 -compression_level 6 \
  -loop 0 -vsync 0 "$output"

test "$(dd if="$output" bs=1 count=4 status=none)" = RIFF
test "$(dd if="$output" bs=1 skip=8 count=4 status=none)" = WEBP
grep -aq ANIM "$output"
grep -aq ANMF "$output"

dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height \
    -of csv=s=x:p=0 "$output"
)"
test "$dimensions" = 1080x1920

# Decode the full loop and verify genuine visible motion.
ffmpeg -hide_banner -v error -i "$output" -f framemd5 "$work/framemd5.txt"
frame_count="$(awk '!/^#/ && NF >= 6 {count += 1} END {print count + 0}' "$work/framemd5.txt")"
unique_frames="$(
  awk '!/^#/ && NF >= 6 {print $6}' "$work/framemd5.txt" \
    | sort -u | wc -l | tr -d '[:space:]'
)"
test "$frame_count" -ge 58
test "$unique_frames" -ge 45

bytes="$(wc -c < "$output" | tr -d '[:space:]')"
sha="$(sha256sum "$output" | awk '{print $1}')"
test "$bytes" -gt 500000
test "$bytes" -lt 18000000

printf 'output=%s\nbytes=%s\nsha256=%s\nframes=%s\nunique_frames=%s\n' \
  "$output" "$bytes" "$sha" "$frame_count" "$unique_frames"
