#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: prepare-mobile-motion-hq-release.py ANIMATED_WEBP")

root = Path.cwd()
source = Path(sys.argv[1])
if not source.is_file():
    raise SystemExit(f"animated WebP is missing: {source}")

MOTION_FILE = "mobile-forest-stream-motion-v17-hq-1440.webp"
MOTION_NAME = MOTION_FILE.removesuffix(".webp")
MOTION_ASSET = f"/scenes/{MOTION_FILE}"
VERSION = "20260809-mobile-motion-v17-hq-no-tap-1"
WIDTH = 1440
HEIGHT = 2560
PREVIOUS_FILE = "mobile-forest-stream-motion-v16-1440.webp"
PREVIOUS_NAME = PREVIOUS_FILE.removesuffix(".webp")
PREVIOUS_ASSET = f"/scenes/{PREVIOUS_FILE}"
PREVIOUS_VERSION = "20260809-mobile-motion-v16-no-tap-1"
PREVIOUS_BYTES = 10_592_086

motion = source.read_bytes()
bytes_count = len(motion)
sha256 = hashlib.sha256(motion).hexdigest()

if motion[:4] != b"RIFF" or motion[8:12] != b"WEBP":
    raise SystemExit("generated high-bitrate motion asset is not a WebP file")
if b"ANIM" not in motion or b"ANMF" not in motion:
    raise SystemExit("generated high-bitrate motion asset is not animated")
if not PREVIOUS_BYTES < bytes_count < 45_000_000:
    raise SystemExit(
        f"unexpected high-bitrate WebP size: {bytes_count}; "
        f"expected more than the {PREVIOUS_BYTES}-byte v16 release"
    )

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, scenes / MOTION_FILE)


def read(path: str) -> str:
    return (root / path).read_text()


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_marked_variants(
    source_text: str,
    variants: list[tuple[str, str]],
    replacement: str,
) -> str:
    for start, end in variants:
        if start not in source_text:
            continue
        pattern = re.compile(
            re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?"
        )
        updated, count = pattern.subn(lambda _: replacement, source_text, count=1)
        if count != 1:
            raise SystemExit(f"could not replace marked block {start}")
        return updated
    suffix = "" if source_text.endswith("\n") else "\n"
    return source_text + suffix + "\n" + replacement


# The canonical generator is what every test, build, dev run, and deployment
# executes. Move it to the cache-busted high-bitrate asset and update its exact
# byte regression before invoking the normal generation pipeline.
use_path = "scripts/use-mobile-forest-stream.mjs"
use = read(use_path)
for old, new in (
    (PREVIOUS_ASSET, MOTION_ASSET),
    (PREVIOUS_NAME, MOTION_NAME),
    (PREVIOUS_VERSION, VERSION),
    (str(PREVIOUS_BYTES), str(bytes_count)),
):
    use = use.replace(old, new)

if f'const MOBILE_ASSET = "{MOTION_ASSET}";' not in use:
    raise SystemExit("canonical mobile generator did not receive the HQ asset")
if f'const GUIDE_VERSION = "{VERSION}";' not in use:
    raise SystemExit("canonical mobile generator did not receive the HQ version")
if f"assert.equal(image.byteLength, {bytes_count});" not in use:
    raise SystemExit("canonical mobile test did not receive the HQ byte count")
write(use_path, use)

validation_start = "// no-tap-mobile-motion-v17-hq-validation-start"
validation_end = "// no-tap-mobile-motion-v17-hq-validation-end"
validation_block = f'''{validation_start}
const noTapMotionPath = "public/scenes/{MOTION_FILE}";
const noTapMotionExpectedBytes = {bytes_count:_};
const noTapMotionExpectedSha256 = "{sha256}";

const noTapMotion = await readFile(noTapMotionPath);
if (noTapMotion.byteLength !== noTapMotionExpectedBytes) {{
  throw new Error(
    `Unexpected high-bitrate mobile motion size: ${{noTapMotion.byteLength}}; expected ${{noTapMotionExpectedBytes}}`,
  );
}}
const noTapMotionSha256 = createHash("sha256")
  .update(noTapMotion)
  .digest("hex");
if (noTapMotionSha256 !== noTapMotionExpectedSha256) {{
  throw new Error(`High-bitrate mobile motion checksum mismatch: ${{noTapMotionSha256}}`);
}}
const noTapMotionInfo = webpInfo(noTapMotion);
if (
  noTapMotionInfo.width !== {WIDTH} ||
  noTapMotionInfo.height !== {HEIGHT} ||
  !noTapMotionInfo.animated
) {{
  throw new Error(
    `Unexpected high-bitrate mobile motion: ${{noTapMotionInfo.width}}x${{noTapMotionInfo.height}}, animated=${{noTapMotionInfo.animated}}`,
  );
}}
if (!noTapMotion.includes(Buffer.from("ANMF", "ascii"))) {{
  throw new Error("High-bitrate mobile motion does not contain animation frames");
}}
if (noTapMotion.byteLength <= {PREVIOUS_BYTES}) {{
  throw new Error("High-bitrate mobile motion is not larger than the v16 release");
}}
console.log(
  `Validated ${{noTapMotionPath}}: {WIDTH}x{HEIGHT}, ${{noTapMotion.byteLength}} bytes, sha256=${{noTapMotionSha256}}`,
);
{validation_end}
'''
materializer_path = "scripts/materialize-mobile-forest-stream.mjs"
write(
    materializer_path,
    replace_marked_variants(
        read(materializer_path),
        [
            (
                "// no-tap-mobile-motion-v16-validation-start",
                "// no-tap-mobile-motion-v16-validation-end",
            ),
            (validation_start, validation_end),
        ],
        validation_block,
    ),
)

headers_start = "# no-tap-mobile-motion-v17-hq-start"
headers_end = "# no-tap-mobile-motion-v17-hq-end"
headers_block = f'''{headers_start}
/scenes/{MOTION_FILE}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
{headers_end}
'''
headers_path = "public/_headers"
write(
    headers_path,
    replace_marked_variants(
        read(headers_path),
        [
            (
                "# no-tap-mobile-motion-v16-start",
                "# no-tap-mobile-motion-v16-end",
            ),
            (headers_start, headers_end),
        ],
        headers_block,
    ),
)

# Keep a direct regression proving the browser receives a genuinely animated,
# larger, cache-busted asset without restoring a tap-gated video element.
test_start = "// no-tap-mobile-motion-v17-hq-test-start"
test_end = "// no-tap-mobile-motion-v17-hq-test-end"
test_block = f'''{test_start}
test("portrait mobile uses the higher-bitrate no-tap motion release", async () => {{
  const [pageSource, styleSource, materializerSource, motion] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-woodland-loop.css"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(new URL("../public/scenes/{MOTION_FILE}", import.meta.url)),
  ]);

  assert.equal(motion.byteLength, {bytes_count});
  assert.ok(motion.byteLength > {PREVIOUS_BYTES});
  assert.equal(motion.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(motion.subarray(8, 12).toString("ascii"), "WEBP");
  assert.ok(motion.includes(Buffer.from("ANIM", "ascii")));
  assert.ok(motion.includes(Buffer.from("ANMF", "ascii")));
  assert.equal(
    [...pageSource.matchAll(/{re.escape(MOTION_FILE)} 1440w/g)].length,
    2,
  );
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\\.js/);
  assert.match(styleSource, /no-tap-mobile-motion-v16-start/);
  assert.match(styleSource, /mobile-background-video[\\s\\S]*display:\\s*none/);
  assert.match(materializerSource, /no-tap-mobile-motion-v17-hq-validation-start/);
  assert.match(materializerSource, /{re.escape(MOTION_FILE)}/);
}});
{test_end}
'''
loading_test_path = "test/mobile-background-loading.test.mjs"
write(
    loading_test_path,
    replace_marked_variants(
        read(loading_test_path),
        [
            (
                "// no-tap-mobile-motion-v16-test-start",
                "// no-tap-mobile-motion-v16-test-end",
            ),
            (test_start, test_end),
        ],
        test_block,
    ),
)

print(
    f"Prepared higher-bitrate no-tap mobile motion: {MOTION_FILE}, "
    f"{WIDTH}x{HEIGHT}, {bytes_count} bytes, sha256={sha256}."
)
