#!/usr/bin/env bash
set -euo pipefail

work="${1:-/tmp/stabilize-mobile-smooth-v33}"
mkdir -p "$work"

for tool in ffmpeg ffprobe sha256sum awk grep; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

if ! ffmpeg -hide_banner -filters 2>/dev/null | grep -Fq minterpolate; then
  echo "ffmpeg minterpolate support is required" >&2
  exit 1
fi

input="public/scenes/mobile-forest-stream-video-v12-720.mp4"
output="$work/mobile-forest-stream-video-v12-720.mp4"
probe="$work/probe.json"

test -s "$input"
test "$(
  ffprobe -v error -select_streams v:0 \
    -show_entries stream=width,height -of csv=s=x:p=0 "$input"
)" = 720x1280

# Motion-compensated interpolation creates genuinely new temporal samples.
# Merely duplicating the existing 24 fps frames would still judder on a 60 Hz
# display. Baseline H.264, no B-frames, and one-second keyframes keep iOS
# hardware decoding and seeking predictable.
ffmpeg -hide_banner -v error -y \
  -i "$input" \
  -vf "minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p" \
  -t 5.0 -an \
  -c:v libx264 -profile:v baseline -level:v 3.2 \
  -preset slow -crf 21 -maxrate 2600k -bufsize 5200k \
  -g 60 -keyint_min 60 -sc_threshold 0 -bf 0 -refs 1 \
  -pix_fmt yuv420p -tag:v avc1 -movflags +faststart \
  "$output"

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$output" -map 0:v:0 -f null -

ffprobe -hide_banner -v error \
  -show_entries \
    stream=codec_name,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate \
  -of json "$output" > "$probe"

python3 - "$probe" <<'PY'
import json
import sys

data = json.load(open(sys.argv[1], encoding="utf-8"))
streams = data.get("streams", [])
if len(streams) != 1:
    raise SystemExit(f"Expected one video stream, found {len(streams)}")
stream = streams[0]
expected = {
    "codec_name": "h264",
    "profile": "Constrained Baseline",
    "pix_fmt": "yuv420p",
    "width": 720,
    "height": 1280,
    "level": 32,
    "r_frame_rate": "60/1",
    "avg_frame_rate": "60/1",
}
for key, value in expected.items():
    if stream.get(key) != value:
        raise SystemExit(
            f"Unexpected {key}: {stream.get(key)!r}; expected {value!r}"
        )
frames = int(stream.get("nb_frames", 0))
if frames < 285:
    raise SystemExit(f"Too few frames for a 60 fps five-second clip: {frames}")
duration = float(data["format"]["duration"])
if not 4.75 <= duration <= 5.10:
    raise SystemExit(f"Unexpected duration: {duration}")
PY

audio_streams="$(
  ffprobe -v error -select_streams a \
    -show_entries stream=index -of csv=p=0 "$output"
)"
test -z "$audio_streams"

# Verify that the interpolator produced distinct decoded frames rather than a
# 60 fps container filled with duplicated 24 fps pictures.
ffmpeg -hide_banner -v error -i "$output" \
  -vf "select='between(n,30,89)'" -vsync 0 \
  -f framemd5 "$work/framemd5.txt"
unique_frames="$(
  awk '!/^#/ && NF >= 6 {print $6}' "$work/framemd5.txt" \
    | sort -u | wc -l | tr -d '[:space:]'
)"
test "$unique_frames" -ge 48

ffmpeg -hide_banner -v error -ss 0.5 -i "$output" \
  -frames:v 1 "$work/frame-early.png"
ffmpeg -hide_banner -v error -ss 3.0 -i "$output" \
  -frames:v 1 "$work/frame-late.png"
early_sha="$(sha256sum "$work/frame-early.png" | awk '{print $1}')"
late_sha="$(sha256sum "$work/frame-late.png" | awk '{print $1}')"
test "$early_sha" != "$late_sha"

bytes="$(wc -c < "$output" | tr -d '[:space:]')"
sha="$(sha256sum "$output" | awk '{print $1}')"
test "$bytes" -gt 800000
test "$bytes" -lt 4500000
test "$(dd if="$output" bs=1 skip=4 count=4 status=none)" = ftyp
moov_offset="$(grep -abo -m1 moov "$output" | cut -d: -f1)"
mdat_offset="$(grep -abo -m1 mdat "$output" | cut -d: -f1)"
test "$moov_offset" -lt "$mdat_offset"

printf 'output=%s\nbytes=%s\nsha256=%s\nunique_frames=%s\n' \
  "$output" "$bytes" "$sha" "$unique_frames"
