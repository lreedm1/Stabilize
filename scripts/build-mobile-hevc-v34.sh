#!/usr/bin/env bash
set -euo pipefail

VERSION="20260813-mobile-hevc-v34-1"
SOURCE="public/scenes/mobile-forest-stream-video-v24-native-1080.mp4"
SOURCE_METADATA="scripts/native-selected-mobile-video-v24.json"
OUTPUT="public/scenes/mobile-forest-stream-video-v34-hevc-720.mp4"
METADATA="scripts/mobile-hevc-v34.json"
WORK="${RUNNER_TEMP:-/tmp}/stabilize-mobile-hevc-v34"
mkdir -p "$WORK"

for tool in ffmpeg ffprobe python3 sha256sum grep awk; do
  command -v "$tool" >/dev/null || {
    echo "$tool is required" >&2
    exit 1
  }
done

ffmpeg -hide_banner -encoders 2>/dev/null | grep -Fq libx265 || {
  echo "ffmpeg libx265 support is required" >&2
  exit 1
}
ffmpeg -hide_banner -filters 2>/dev/null | grep -Fq minterpolate || {
  echo "ffmpeg minterpolate support is required" >&2
  exit 1
}

test -s "$SOURCE"
test -s "$SOURCE_METADATA"

python3 - "$SOURCE" "$SOURCE_METADATA" <<'PY'
import hashlib
import json
import pathlib
import sys

source = pathlib.Path(sys.argv[1])
metadata = json.loads(pathlib.Path(sys.argv[2]).read_text(encoding="utf-8"))
data = source.read_bytes()
actual_sha = hashlib.sha256(data).hexdigest()
if len(data) != int(metadata["videoBytes"]):
    raise SystemExit(
        f"source byte count changed: {len(data)} != {metadata['videoBytes']}"
    )
if actual_sha != metadata["videoSha256"]:
    raise SystemExit(f"source checksum changed: {actual_sha}")
if metadata.get("width") != 2160 or metadata.get("height") != 3840:
    raise SystemExit("expected the native 2160x3840 source")
if metadata.get("fps") != 24:
    raise SystemExit("expected the native 24 fps source")
PY

if [[ ! -s "$OUTPUT" || ! -s "$METADATA" ]]; then
  rm -f "$OUTPUT" "$METADATA"

  ffmpeg -hide_banner -v error -y \
    -i "$SOURCE" \
    -t 5.0 -an \
    -vf "scale=720:1280:force_original_aspect_ratio=increase:flags=lanczos,crop=720:1280,setsar=1,minterpolate=fps=60:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p" \
    -c:v libx265 -profile:v main -preset slow -crf 22 \
    -maxrate 5000k -bufsize 10000k \
    -x265-params "log-level=error:numa-pools=0:keyint=60:min-keyint=60:scenecut=0:open-gop=0:repeat-headers=1:aq-mode=3" \
    -tag:v hvc1 -pix_fmt yuv420p -fps_mode cfr \
    -map_metadata -1 -metadata creation_time=1970-01-01T00:00:00Z \
    -movflags +faststart \
    "$OUTPUT"

  ffprobe -hide_banner -v error \
    -show_entries \
      stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate \
    -of json "$OUTPUT" > "$WORK/probe.json"

  python3 - "$WORK/probe.json" "$OUTPUT" "$SOURCE" "$METADATA" "$VERSION" <<'PY'
import hashlib
import json
import pathlib
import sys

probe_path, output_path, source_path, metadata_path, version = sys.argv[1:]
probe = json.loads(pathlib.Path(probe_path).read_text(encoding="utf-8"))
streams = probe.get("streams", [])
if len(streams) != 1:
    raise SystemExit(f"expected one HEVC video stream, found {len(streams)}")
stream = streams[0]
expected = {
    "codec_name": "hevc",
    "codec_tag_string": "hvc1",
    "profile": "Main",
    "pix_fmt": "yuv420p",
    "width": 720,
    "height": 1280,
    "r_frame_rate": "60/1",
    "avg_frame_rate": "60/1",
}
for key, value in expected.items():
    if stream.get(key) != value:
        raise SystemExit(
            f"unexpected {key}: {stream.get(key)!r}; expected {value!r}"
        )

duration = float(probe["format"]["duration"])
if not 4.75 <= duration <= 5.10:
    raise SystemExit(f"unexpected duration: {duration}")

output = pathlib.Path(output_path)
source = pathlib.Path(source_path)
data = output.read_bytes()
if not 700_000 < len(data) < 4_000_000:
    raise SystemExit(f"unexpected HEVC size: {len(data)} bytes")
sha256 = hashlib.sha256(data).hexdigest()
source_data = source.read_bytes()
metadata = {
    "version": version,
    "sourceAsset": "/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
    "hevcAsset": "/scenes/mobile-forest-stream-video-v34-hevc-720.mp4",
    "h264Asset": "/scenes/mobile-forest-stream-video-v12-720.mp4",
    "videoBytes": len(data),
    "videoSha256": sha256,
    "sourceBytes": len(source_data),
    "sourceSha256": hashlib.sha256(source_data).hexdigest(),
    "width": 720,
    "height": 1280,
    "fps": 60,
    "codec": "hevc",
    "codecTag": "hvc1",
    "profile": stream["profile"],
    "pixelFormat": stream["pix_fmt"],
    "level": stream.get("level"),
    "duration": duration,
    "bitRate": int(probe["format"].get("bit_rate", 0) or 0),
    "quality": "native-video-hevc-720x1280-60fps",
}
pathlib.Path(metadata_path).write_text(
    json.dumps(metadata, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY
fi

ffmpeg -hide_banner -v error -xerror -err_detect explode \
  -i "$OUTPUT" -map 0:v:0 -f null -

ffprobe -hide_banner -v error \
  -show_entries \
    stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate:format=duration,size,bit_rate \
  -of json "$OUTPUT" > "$WORK/probe-verify.json"

python3 - "$WORK/probe-verify.json" "$OUTPUT" "$METADATA" "$VERSION" <<'PY'
import hashlib
import json
import pathlib
import sys

probe_path, output_path, metadata_path, version = sys.argv[1:]
probe = json.loads(pathlib.Path(probe_path).read_text(encoding="utf-8"))
metadata = json.loads(pathlib.Path(metadata_path).read_text(encoding="utf-8"))
data = pathlib.Path(output_path).read_bytes()
stream = probe["streams"][0]
checks = {
    "version": version,
    "videoBytes": len(data),
    "videoSha256": hashlib.sha256(data).hexdigest(),
    "width": 720,
    "height": 1280,
    "fps": 60,
    "codec": "hevc",
    "codecTag": "hvc1",
    "profile": "Main",
    "pixelFormat": "yuv420p",
}
for key, expected in checks.items():
    if metadata.get(key) != expected:
        raise SystemExit(
            f"metadata mismatch for {key}: {metadata.get(key)!r} != {expected!r}"
        )
stream_checks = {
    "codec_name": "hevc",
    "codec_tag_string": "hvc1",
    "profile": "Main",
    "pix_fmt": "yuv420p",
    "width": 720,
    "height": 1280,
    "r_frame_rate": "60/1",
    "avg_frame_rate": "60/1",
}
for key, expected in stream_checks.items():
    if stream.get(key) != expected:
        raise SystemExit(
            f"stream mismatch for {key}: {stream.get(key)!r} != {expected!r}"
        )
PY

ffmpeg -hide_banner -v error -i "$OUTPUT" \
  -vf "select='between(n,30,89)'" -fps_mode vfr \
  -f framemd5 "$WORK/framemd5.txt"
unique_frames="$(
  awk '!/^#/ && NF >= 6 {print $6}' "$WORK/framemd5.txt" \
    | sort -u | wc -l | tr -d '[:space:]'
)"
test "$unique_frames" -ge 48

test "$(dd if="$OUTPUT" bs=1 skip=4 count=4 status=none)" = ftyp
moov_offset="$(grep -abo -m1 moov "$OUTPUT" | cut -d: -f1)"
mdat_offset="$(grep -abo -m1 mdat "$OUTPUT" | cut -d: -f1)"
test "$moov_offset" -lt "$mdat_offset"

bytes="$(wc -c < "$OUTPUT" | tr -d '[:space:]')"
sha="$(sha256sum "$OUTPUT" | awk '{print $1}')"
printf 'HEVC output=%s bytes=%s sha256=%s unique_frames=%s\n' \
  "$OUTPUT" "$bytes" "$sha" "$unique_frames"
