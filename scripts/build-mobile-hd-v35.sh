#!/usr/bin/env bash
set -euo pipefail

VERSION="20260813-mobile-hd-v35-1"
SOURCE="public/scenes/mobile-forest-stream-video-v24-native-1080.mp4"
SOURCE_METADATA="scripts/native-selected-mobile-video-v24.json"
HEVC_OUTPUT="public/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4"
H264_OUTPUT="public/scenes/mobile-forest-stream-video-v35-h264-1080.mp4"
METADATA="scripts/mobile-hd-v35.json"
WORK="${RUNNER_TEMP:-/tmp}/stabilize-mobile-hd-v35"
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
ffmpeg -hide_banner -encoders 2>/dev/null | grep -Fq libx264 || {
  echo "ffmpeg libx264 support is required" >&2
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

if [[ ! -s "$HEVC_OUTPUT" || ! -s "$H264_OUTPUT" || ! -s "$METADATA" ]]; then
  rm -f "$HEVC_OUTPUT" "$H264_OUTPUT" "$METADATA"

  # Resolve the source once at 1080x1920, then create a genuine 30 fps stream
  # before splitting it between the HEVC and H.264 encoders. This prioritizes
  # visible detail over the previous 720p60 frame-count tradeoff.
  ffmpeg -hide_banner -v error -y \
    -i "$SOURCE" \
    -filter_complex "[0:v]scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos,crop=1080:1920,setsar=1,minterpolate=fps=30:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1,format=yuv420p,split=2[hevc][h264]" \
    -map '[hevc]' -t 4.933333 -an \
    -c:v libx265 -profile:v main -preset slow -crf 20 \
    -maxrate 8000k -bufsize 16000k \
    -x265-params "log-level=error:keyint=30:min-keyint=30:scenecut=0:open-gop=0:repeat-headers=1:aq-mode=3" \
    -tag:v hvc1 -pix_fmt yuv420p -fps_mode cfr \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -map_metadata -1 -metadata creation_time=1970-01-01T00:00:00Z \
    -movflags +faststart \
    "$HEVC_OUTPUT" \
    -map '[h264]' -t 4.933333 -an \
    -c:v libx264 -profile:v high -level:v 4.0 -preset slow -crf 20 \
    -maxrate 10000k -bufsize 20000k \
    -g 30 -keyint_min 30 -sc_threshold 0 -bf 2 -refs 3 \
    -tag:v avc1 -pix_fmt yuv420p -fps_mode cfr \
    -color_primaries bt709 -color_trc bt709 -colorspace bt709 \
    -map_metadata -1 -metadata creation_time=1970-01-01T00:00:00Z \
    -movflags +faststart \
    "$H264_OUTPUT"

  ffprobe -hide_banner -v error \
    -show_entries \
      stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate \
    -of json "$HEVC_OUTPUT" > "$WORK/hevc-probe.json"
  ffprobe -hide_banner -v error \
    -show_entries \
      stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,level,r_frame_rate,avg_frame_rate,nb_frames:format=duration,size,bit_rate \
    -of json "$H264_OUTPUT" > "$WORK/h264-probe.json"

  python3 - \
    "$WORK/hevc-probe.json" \
    "$WORK/h264-probe.json" \
    "$HEVC_OUTPUT" \
    "$H264_OUTPUT" \
    "$SOURCE" \
    "$METADATA" \
    "$VERSION" <<'PY'
import hashlib
import json
import pathlib
import sys

(
    hevc_probe_path,
    h264_probe_path,
    hevc_path,
    h264_path,
    source_path,
    metadata_path,
    version,
) = sys.argv[1:]

hevc_probe = json.loads(pathlib.Path(hevc_probe_path).read_text(encoding="utf-8"))
h264_probe = json.loads(pathlib.Path(h264_probe_path).read_text(encoding="utf-8"))
hevc_stream = hevc_probe["streams"][0]
h264_stream = h264_probe["streams"][0]

expected_common = {
    "pix_fmt": "yuv420p",
    "width": 1080,
    "height": 1920,
    "r_frame_rate": "30/1",
    "avg_frame_rate": "30/1",
}
for label, stream in (("HEVC", hevc_stream), ("H.264", h264_stream)):
    for key, expected in expected_common.items():
        if stream.get(key) != expected:
            raise SystemExit(
                f"unexpected {label} {key}: {stream.get(key)!r}; expected {expected!r}"
            )

for key, expected in {
    "codec_name": "hevc",
    "codec_tag_string": "hvc1",
    "profile": "Main",
}.items():
    if hevc_stream.get(key) != expected:
        raise SystemExit(
            f"unexpected HEVC {key}: {hevc_stream.get(key)!r}; expected {expected!r}"
        )
for key, expected in {
    "codec_name": "h264",
    "codec_tag_string": "avc1",
    "profile": "High",
}.items():
    if h264_stream.get(key) != expected:
        raise SystemExit(
            f"unexpected H.264 {key}: {h264_stream.get(key)!r}; expected {expected!r}"
        )

hevc_duration = float(hevc_probe["format"]["duration"])
h264_duration = float(h264_probe["format"]["duration"])
for label, duration in (("HEVC", hevc_duration), ("H.264", h264_duration)):
    if not 4.80 <= duration <= 5.05:
        raise SystemExit(f"unexpected {label} duration: {duration}")

hevc = pathlib.Path(hevc_path).read_bytes()
h264 = pathlib.Path(h264_path).read_bytes()
source = pathlib.Path(source_path).read_bytes()
if not 1_000_000 < len(hevc) < 8_000_000:
    raise SystemExit(f"unexpected HEVC size: {len(hevc)} bytes")
if not 1_500_000 < len(h264) < 12_000_000:
    raise SystemExit(f"unexpected H.264 size: {len(h264)} bytes")

metadata = {
    "version": version,
    "sourceAsset": "/scenes/mobile-forest-stream-video-v24-native-1080.mp4",
    "hevcAsset": "/scenes/mobile-forest-stream-video-v35-hevc-1080.mp4",
    "h264Asset": "/scenes/mobile-forest-stream-video-v35-h264-1080.mp4",
    "sourceBytes": len(source),
    "sourceSha256": hashlib.sha256(source).hexdigest(),
    "hevcBytes": len(hevc),
    "hevcSha256": hashlib.sha256(hevc).hexdigest(),
    "h264Bytes": len(h264),
    "h264Sha256": hashlib.sha256(h264).hexdigest(),
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "hevcCodec": "hevc",
    "hevcCodecTag": "hvc1",
    "hevcProfile": hevc_stream["profile"],
    "hevcBitRate": int(hevc_probe["format"].get("bit_rate", 0) or 0),
    "h264Codec": "h264",
    "h264CodecTag": "avc1",
    "h264Profile": h264_stream["profile"],
    "h264BitRate": int(h264_probe["format"].get("bit_rate", 0) or 0),
    "pixelFormat": "yuv420p",
    "duration": min(hevc_duration, h264_duration),
    "quality": "native-video-1080x1920-30fps",
}
pathlib.Path(metadata_path).write_text(
    json.dumps(metadata, indent=2, sort_keys=True) + "\n",
    encoding="utf-8",
)
PY
fi

for video in "$HEVC_OUTPUT" "$H264_OUTPUT"; do
  ffmpeg -hide_banner -v error -xerror -err_detect explode \
    -i "$video" -map 0:v:0 -f null -
  test "$(dd if="$video" bs=1 skip=4 count=4 status=none)" = ftyp
  moov_offset="$(grep -abo -m1 moov "$video" | cut -d: -f1)"
  mdat_offset="$(grep -abo -m1 mdat "$video" | cut -d: -f1)"
  test "$moov_offset" -lt "$mdat_offset"
  audio="$(
    ffprobe -v error -select_streams a \
      -show_entries stream=index -of csv=p=0 "$video"
  )"
  test -z "$audio"
done

ffprobe -hide_banner -v error \
  -show_entries stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate:format=duration,size,bit_rate \
  -of json "$HEVC_OUTPUT" > "$WORK/hevc-verify.json"
ffprobe -hide_banner -v error \
  -show_entries stream=codec_name,codec_tag_string,profile,pix_fmt,width,height,r_frame_rate,avg_frame_rate:format=duration,size,bit_rate \
  -of json "$H264_OUTPUT" > "$WORK/h264-verify.json"

python3 - \
  "$WORK/hevc-verify.json" \
  "$WORK/h264-verify.json" \
  "$HEVC_OUTPUT" \
  "$H264_OUTPUT" \
  "$METADATA" \
  "$VERSION" <<'PY'
import hashlib
import json
import pathlib
import sys

hevc_probe_path, h264_probe_path, hevc_path, h264_path, metadata_path, version = sys.argv[1:]
hevc_probe = json.loads(pathlib.Path(hevc_probe_path).read_text(encoding="utf-8"))
h264_probe = json.loads(pathlib.Path(h264_probe_path).read_text(encoding="utf-8"))
metadata = json.loads(pathlib.Path(metadata_path).read_text(encoding="utf-8"))
hevc = pathlib.Path(hevc_path).read_bytes()
h264 = pathlib.Path(h264_path).read_bytes()

checks = {
    "version": version,
    "hevcBytes": len(hevc),
    "hevcSha256": hashlib.sha256(hevc).hexdigest(),
    "h264Bytes": len(h264),
    "h264Sha256": hashlib.sha256(h264).hexdigest(),
    "width": 1080,
    "height": 1920,
    "fps": 30,
    "hevcCodec": "hevc",
    "hevcCodecTag": "hvc1",
    "h264Codec": "h264",
    "h264CodecTag": "avc1",
    "pixelFormat": "yuv420p",
    "quality": "native-video-1080x1920-30fps",
}
for key, expected in checks.items():
    if metadata.get(key) != expected:
        raise SystemExit(
            f"metadata mismatch for {key}: {metadata.get(key)!r} != {expected!r}"
        )

stream_checks = (
    (hevc_probe["streams"][0], "hevc", "hvc1", "Main"),
    (h264_probe["streams"][0], "h264", "avc1", "High"),
)
for stream, codec, tag, profile in stream_checks:
    expected = {
        "codec_name": codec,
        "codec_tag_string": tag,
        "profile": profile,
        "pix_fmt": "yuv420p",
        "width": 1080,
        "height": 1920,
        "r_frame_rate": "30/1",
        "avg_frame_rate": "30/1",
    }
    for key, value in expected.items():
        if stream.get(key) != value:
            raise SystemExit(
                f"stream mismatch for {codec} {key}: {stream.get(key)!r} != {value!r}"
            )
PY

ffmpeg -hide_banner -v error -i "$HEVC_OUTPUT" \
  -vf "select='between(n,15,44)'" -fps_mode vfr \
  -f framemd5 "$WORK/framemd5.txt"
unique_frames="$(
  awk '!/^#/ && NF >= 6 {print $6}' "$WORK/framemd5.txt" \
    | sort -u | wc -l | tr -d '[:space:]'
)"
test "$unique_frames" -ge 24

hevc_bytes="$(wc -c < "$HEVC_OUTPUT" | tr -d '[:space:]')"
h264_bytes="$(wc -c < "$H264_OUTPUT" | tr -d '[:space:]')"
hevc_sha="$(sha256sum "$HEVC_OUTPUT" | awk '{print $1}')"
h264_sha="$(sha256sum "$H264_OUTPUT" | awk '{print $1}')"
printf 'Mobile HD v35 HEVC=%s bytes=%s sha256=%s H264=%s bytes=%s sha256=%s unique_frames=%s\n' \
  "$HEVC_OUTPUT" "$hevc_bytes" "$hevc_sha" \
  "$H264_OUTPUT" "$h264_bytes" "$h264_sha" "$unique_frames"
