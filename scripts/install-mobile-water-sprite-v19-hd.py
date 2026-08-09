#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: install-mobile-water-sprite-v19-hd.py SPRITE_WEBP")

root = Path.cwd()
source = Path(sys.argv[1])
if not source.is_file():
    raise SystemExit(f"sprite is missing: {source}")

SPRITE_FILE = "mobile-forest-stream-water-sprite-v19-hd-1080.webp"
SPRITE_PATH = f"public/scenes/{SPRITE_FILE}"
EXPECTED_WIDTH = 2400
EXPECTED_HEIGHT = 6000

sprite = source.read_bytes()
bytes_count = len(sprite)
sha256 = hashlib.sha256(sprite).hexdigest()

if sprite[:4] != b"RIFF" or sprite[8:12] != b"WEBP":
    raise SystemExit("generated high-resolution water sprite is not a WebP file")
if b"ALPH" not in sprite:
    raise SystemExit("generated high-resolution water sprite has no transparency")
if b"ANIM" in sprite or b"ANMF" in sprite:
    raise SystemExit("water sprite must be a static atlas, not an animated image")
if not 1_000_000 < bytes_count < 12_000_000:
    raise SystemExit(f"unexpected high-resolution water sprite size: {bytes_count}")


def webp_dimensions(data: bytes) -> tuple[int, int]:
    offset = 12
    while offset + 8 <= len(data):
        chunk_type = data[offset : offset + 4]
        chunk_size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        chunk_data = offset + 8
        chunk_end = chunk_data + chunk_size
        if chunk_end > len(data):
            raise SystemExit("truncated high-resolution water sprite WebP")
        if chunk_type == b"VP8X" and chunk_size >= 10:
            width = 1 + int.from_bytes(data[chunk_data + 4 : chunk_data + 7], "little")
            height = 1 + int.from_bytes(data[chunk_data + 7 : chunk_data + 10], "little")
            return width, height
        offset = chunk_end + (chunk_size % 2)
    raise SystemExit("high-resolution water sprite WebP is missing VP8X dimensions")


width, height = webp_dimensions(sprite)
if (width, height) != (EXPECTED_WIDTH, EXPECTED_HEIGHT):
    raise SystemExit(
        f"unexpected high-resolution water sprite dimensions: {width}x{height}; "
        f"expected {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}"
    )

output = root / SPRITE_PATH
output.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, output)

materializer_path = root / "scripts/materialize-mobile-forest-stream.mjs"
materializer = materializer_path.read_text()
start = "// mobile-water-sprite-v19-hd-validation-start"
end = "// mobile-water-sprite-v19-hd-validation-end"
block = f'''{start}
const hdWaterSpritePath = "{SPRITE_PATH}";
const hdWaterSpriteExpectedBytes = {bytes_count:_};
const hdWaterSpriteExpectedSha256 = "{sha256}";
const hdWaterSprite = await readFile(hdWaterSpritePath);
if (hdWaterSprite.byteLength !== hdWaterSpriteExpectedBytes) {{
  throw new Error(
    `Unexpected HD mobile water sprite size: ${{hdWaterSprite.byteLength}}; expected ${{hdWaterSpriteExpectedBytes}}`,
  );
}}
const hdWaterSpriteSha256 = createHash("sha256")
  .update(hdWaterSprite)
  .digest("hex");
if (hdWaterSpriteSha256 !== hdWaterSpriteExpectedSha256) {{
  throw new Error(`HD mobile water sprite checksum mismatch: ${{hdWaterSpriteSha256}}`);
}}
const hdWaterSpriteInfo = webpInfo(hdWaterSprite);
if (
  hdWaterSpriteInfo.width !== {EXPECTED_WIDTH} ||
  hdWaterSpriteInfo.height !== {EXPECTED_HEIGHT} ||
  hdWaterSpriteInfo.animated
) {{
  throw new Error(
    `Unexpected HD mobile water sprite: ${{hdWaterSpriteInfo.width}}x${{hdWaterSpriteInfo.height}}, animated=${{hdWaterSpriteInfo.animated}}`,
  );
}}
if (!hdWaterSprite.includes(Buffer.from("ALPH", "ascii"))) {{
  throw new Error("HD mobile water sprite is missing its alpha channel");
}}
console.log(
  `Validated ${{hdWaterSpritePath}}: {EXPECTED_WIDTH}x{EXPECTED_HEIGHT}, ${{hdWaterSprite.byteLength}} bytes, sha256=${{hdWaterSpriteSha256}}`,
);
{end}
'''
pattern = re.compile(re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?")
if start in materializer:
    materializer, count = pattern.subn(lambda _: block, materializer, count=1)
    if count != 1:
        raise SystemExit("could not replace the HD water sprite validation block")
else:
    materializer = materializer.rstrip() + "\n\n" + block
materializer_path.write_text(materializer)

print(
    f"Installed {SPRITE_FILE}: {width}x{height}, {bytes_count} bytes, "
    f"sha256={sha256}."
)
