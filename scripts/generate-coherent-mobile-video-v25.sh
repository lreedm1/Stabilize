#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-coherent-mobile-v25}"
mkdir -p "$work"

for tool in ffmpeg ffprobe base64 sha256sum; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

mapfile -t motion_parts < <(
  find public/scenes -maxdepth 1 -type f \
    -name 'mobile-forest-stream-loop-v1.part*.b64' | sort
)
test "${#motion_parts[@]}" -eq 5
cat "${motion_parts[@]}" \
  | tr -d '[:space:]' \
  | base64 --decode \
  > "$work/source-motion.mp4"

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$work/source-motion.mp4" -map 0:v:0 -f null -

video="$work/mobile-forest-stream-video-v25-coherent-4k.mp4"
poster="$work/mobile-forest-stream-v25-coherent-4k.webp"

# Use one visual source for every pixel. The previous release placed a masked
# creek clip over a different still image, which created the visible vertical
# scene split on iOS. This release crops the generator edge from the motion
# source itself and scales that single coherent frame to 4K portrait.
ffmpeg -hide_banner -v error -y \
  -stream_loop -1 -i "$work/source-motion.mp4" \
  -vf "scale=1080:1920:flags=lanczos,crop=956:1700:62:0,scale=2160:3840:flags=lanczos,setsar=1,fps=24,format=yuv420p" \
  -t 5.0 -an \
  -c:v libx264 -profile:v high -level:v 5.1 \
  -preset slow -crf 18 -maxrate 14000k -bufsize 28000k \
  -g 24 -keyint_min 24 -sc_threshold 0 -bf 2 -refs 3 \
  -pix_fmt yuv420p -tag:v avc1 \
  -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
  -movflags +faststart \
  "$video"

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$video" -map 0:v:0 -f null -

probe="$work/probe.json"
ffprobe -hide_banner -v error \
  -show_entries stream=codec_name,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate \
  -of json "$video" > "$probe"

python - "$probe" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1]))
streams = data.get("streams", [])
if len(streams) != 1:
    raise SystemExit(f"Expected one video stream, found {len(streams)}")
stream = streams[0]
expected = {
    "codec_name": "h264",
    "profile": "High",
    "pix_fmt": "yuv420p",
    "width": 2160,
    "height": 3840,
    "level": 51,
    "r_frame_rate": "24/1",
    "avg_frame_rate": "24/1",
}
for key, value in expected.items():
    if stream.get(key) != value:
        raise SystemExit(f"Unexpected {key}: {stream.get(key)!r}; expected {value!r}")
frames = int(stream.get("nb_frames", 0))
if frames < 118:
    raise SystemExit(f"Too few frames: {frames}")
duration = float(data["format"]["duration"])
if not 4.9 <= duration <= 5.2:
    raise SystemExit(f"Unexpected duration: {duration}")
PY

audio_streams="$(
  ffprobe -v error -select_streams a \
    -show_entries stream=index -of csv=p=0 "$video"
)"
test -z "$audio_streams"

# Verify decoded motion rather than trusting container metadata.
ffmpeg -hide_banner -v error -i "$video" \
  -vf "select='between(n,12,35)'" -vsync 0 \
  -f framemd5 "$work/framemd5.txt"
unique_frames="$(
  awk '!/^#/ && NF >= 6 {print $6}' "$work/framemd5.txt" \
    | sort -u | wc -l | tr -d '[:space:]'
)"
test "$unique_frames" -ge 20

ffmpeg -hide_banner -v error -y -ss 0.5 -i "$video" \
  -frames:v 1 -c:v libwebp -quality 92 -compression_level 6 "$poster"
poster_dimensions="$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$poster"
)"
test "$poster_dimensions" = 2160x3840

test "$(dd if="$video" bs=1 skip=4 count=4 status=none)" = ftyp
test "$(dd if="$poster" bs=1 count=4 status=none)" = RIFF
test "$(dd if="$poster" bs=1 skip=8 count=4 status=none)" = WEBP

bytes="$(wc -c < "$video" | tr -d '[:space:]')"
sha="$(sha256sum "$video" | awk '{print $1}')"
poster_bytes="$(wc -c < "$poster" | tr -d '[:space:]')"
poster_sha="$(sha256sum "$poster" | awk '{print $1}')"
test "$bytes" -gt 1500000
test "$bytes" -lt 25000000
moov_offset="$(grep -abo -m1 moov "$video" | cut -d: -f1)"
mdat_offset="$(grep -abo -m1 mdat "$video" | cut -d: -f1)"
test "$moov_offset" -lt "$mdat_offset"

printf 'video=%s\nvideo_bytes=%s\nvideo_sha256=%s\nposter=%s\nposter_bytes=%s\nposter_sha256=%s\nunique_frames=%s\n' \
  "$video" "$bytes" "$sha" "$poster" "$poster_bytes" "$poster_sha" "$unique_frames"
