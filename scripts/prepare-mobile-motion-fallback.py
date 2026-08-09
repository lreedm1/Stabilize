#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import re
import shutil
import sys
from pathlib import Path

if len(sys.argv) != 2:
    raise SystemExit("usage: prepare-mobile-motion-fallback.py ANIMATED_WEBP")

root = Path.cwd()
source = Path(sys.argv[1])
if not source.is_file():
    raise SystemExit(f"animated WebP is missing: {source}")

MOTION_FILE = "mobile-forest-stream-motion-v16-1440.webp"
MOTION_ASSET = f"/scenes/{MOTION_FILE}"
WIDTH = 1440
HEIGHT = 2560
VERSION = "20260809-mobile-motion-v16-no-tap-1"
STYLE_VERSION = VERSION

motion = source.read_bytes()
bytes_count = len(motion)
sha256 = hashlib.sha256(motion).hexdigest()
if motion[:4] != b"RIFF" or motion[8:12] != b"WEBP":
    raise SystemExit("generated motion fallback is not a WebP file")
if b"ANIM" not in motion or b"ANMF" not in motion:
    raise SystemExit("generated motion fallback is not animated")
if not 700_000 < bytes_count < 25_000_000:
    raise SystemExit(f"unexpected animated WebP size: {bytes_count}")

scenes = root / "public/scenes"
scenes.mkdir(parents=True, exist_ok=True)
shutil.copyfile(source, scenes / MOTION_FILE)


def read(path: str) -> str:
    return (root / path).read_text()


def write(path: str, content: str) -> None:
    target = root / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content)


def replace_required(
    source_text: str,
    pattern: str,
    replacement: str,
    label: str,
    *,
    count: int = 1,
    flags: int = 0,
) -> str:
    updated, replacements = re.subn(
        pattern,
        replacement,
        source_text,
        count=count,
        flags=flags,
    )
    if replacements != count:
        raise SystemExit(
            f"expected {count} replacement(s) for {label}; found {replacements}"
        )
    return updated


def replace_marked(
    source_text: str,
    start: str,
    end: str,
    block: str,
) -> str:
    pattern = re.compile(re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?")
    if start in source_text:
        updated, replacements = pattern.subn(lambda _: block, source_text, count=1)
        if replacements != 1:
            raise SystemExit(f"could not replace marked block {start}")
        return updated
    suffix = "" if source_text.endswith("\n") else "\n"
    return source_text + suffix + "\n" + block


# Validate the generated asset on every build so deployment cannot silently
# revert to a static or truncated file.
validation_start = "// no-tap-mobile-motion-v16-validation-start"
validation_end = "// no-tap-mobile-motion-v16-validation-end"
validation_block = f'''{validation_start}
const noTapMotionPath = "public/scenes/{MOTION_FILE}";
const noTapMotionExpectedBytes = {bytes_count:_};
const noTapMotionExpectedSha256 = "{sha256}";

const noTapMotion = await readFile(noTapMotionPath);
if (noTapMotion.byteLength !== noTapMotionExpectedBytes) {{
  throw new Error(
    `Unexpected no-tap mobile motion size: ${{noTapMotion.byteLength}}; expected ${{noTapMotionExpectedBytes}}`,
  );
}}
const noTapMotionSha256 = createHash("sha256")
  .update(noTapMotion)
  .digest("hex");
if (noTapMotionSha256 !== noTapMotionExpectedSha256) {{
  throw new Error(`No-tap mobile motion checksum mismatch: ${{noTapMotionSha256}}`);
}}
const noTapMotionInfo = webpInfo(noTapMotion);
if (
  noTapMotionInfo.width !== {WIDTH} ||
  noTapMotionInfo.height !== {HEIGHT} ||
  !noTapMotionInfo.animated
) {{
  throw new Error(
    `Unexpected no-tap mobile motion: ${{noTapMotionInfo.width}}x${{noTapMotionInfo.height}}, animated=${{noTapMotionInfo.animated}}`,
  );
}}
if (!noTapMotion.includes(Buffer.from("ANMF", "ascii"))) {{
  throw new Error("No-tap mobile motion does not contain animation frames");
}}
console.log(
  `Validated ${{noTapMotionPath}}: {WIDTH}x{HEIGHT}, ${{noTapMotion.byteLength}} bytes, sha256=${{noTapMotionSha256}}`,
);
{validation_end}
'''
materializer_path = "scripts/materialize-mobile-forest-stream.mjs"
write(
    materializer_path,
    replace_marked(
        read(materializer_path),
        validation_start,
        validation_end,
        validation_block,
    ),
)

# Make the canonical mobile-background generator select the animated image.
# This script already runs during every test, build, and deployment.
use_path = "scripts/use-mobile-forest-stream.mjs"
use = read(use_path)
use = replace_required(
    use,
    r'^const MOBILE_ASSET = "[^"]+";$',
    f'const MOBILE_ASSET = "{MOTION_ASSET}";',
    "mobile motion asset",
    flags=re.MULTILINE,
)
use = replace_required(
    use,
    r'^const GUIDE_VERSION = "[^"]+";$',
    f'const GUIDE_VERSION = "{VERSION}";',
    "guide cache version",
    flags=re.MULTILINE,
)
use = replace_required(
    use,
    r'^const MOBILE_STYLE_VERSION = "[^"]+";$',
    f'const MOBILE_STYLE_VERSION = "{STYLE_VERSION}";',
    "mobile style cache version",
    flags=re.MULTILINE,
)
use = re.sub(r"\$\{MOBILE_ASSET\} [0-9]+w", "${MOBILE_ASSET} 1440w", use)
use = use.replace(
    "    'test(\"mobile uses the project-owner forest stream as its static portrait background\", async () => {',",
    "    'test(\"mobile uses the project-owner forest stream as its static portrait background\", async () => {',\n"
    "    'test(\"portrait mobile moves without a media gesture\", async () => {',",
)
if '"/scenes/mobile-forest-stream-v14-retina-2160.webp",' not in use:
    use = use.replace(
        '    "/scenes/mobile-forest-stream-v1-540.webp",\n',
        '    "/scenes/mobile-forest-stream-v1-540.webp",\n'
        '    "/scenes/mobile-forest-stream-v14-retina-2160.webp",\n',
        1,
    )
if '"mobile-forest-stream-v14-retina-2160",' not in use:
    insertion = '''  next = next.replaceAll(
    "mobile-forest-stream-v14-retina-2160",
    "mobile-forest-stream-motion-v16-1440",
  );
'''
    anchor = '  return next;\n});\n\nawait update(".github/workflows/verify-mobile-background.yml"'
    if anchor not in use:
        raise SystemExit("could not find shared-theme update boundary")
    use = use.replace(anchor, insertion + anchor, 1)

mobile_quality_test = f'''const mobileQualityTest = String.raw`test("portrait mobile moves without a media gesture", async () => {{
  const tier = {{
    filename: "{MOTION_FILE}",
    width: {WIDTH},
    height: {HEIGHT},
  }};
  const [pageSource, mobileStyles, image] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/mobile-woodland-loop.css", import.meta.url), "utf8"),
    readFile(new URL("../public/scenes/" + tier.filename, import.meta.url)),
  ]);
  const imageInfo = webpInfo(image);
  assert.deepEqual(
    {{ width: imageInfo.width, height: imageInfo.height }},
    {{ width: tier.width, height: tier.height }},
  );
  assert.equal(image.byteLength, {bytes_count});
  assert.equal(imageInfo.chunks.includes("ANIM"), true);
  assert.equal(imageInfo.chunks.includes("ANMF"), true);
  assert.equal(
    [...pageSource.matchAll(new RegExp(tier.filename + " " + tier.width + "w", "g"))].length,
    2,
  );
  assert.match(pageSource, /<source[\\s\\S]*sizes="100vw"[\\s\\S]*srcset=/);
  assert.match(pageSource, /<link[\\s\\S]*rel="preload"[\\s\\S]*imagesrcset=/);
  assert.match(pageSource, /imagesizes="100vw"/);
  assert.ok(pageSource.includes('href="{MOTION_ASSET}"'));
  assert.doesNotMatch(pageSource, /id="mobile-background-video"/);
  assert.doesNotMatch(pageSource, /mobile-quality\\.js/);
  assert.match(
    pageSource,
    /mobile-woodland-loop\\.css\\?v={re.escape(STYLE_VERSION).replace('\\-', '-')}/,
  );
  assert.match(mobileStyles, /no-tap-mobile-motion-v16-start/);
  assert.match(mobileStyles, /object-fit:\\s*cover/);
  assert.match(mobileStyles, /mobile-background-video[\\s\\S]*display:\\s*none/);
}});

`;

'''
start = use.find("const mobileQualityTest = String.raw`")
end = use.find('await update("test/mobile-quality.test.mjs"', start)
if start < 0 or end < 0:
    raise SystemExit("could not replace generated mobile quality test")
use = use[:start] + mobile_quality_test + use[end:]
write(use_path, use)

# Eliminate the tap-gated media element from the rendered page. The animated
# WebP now supplies the visible motion directly through the responsive picture.
page_path = "src/page.js"
page = read(page_path)
for marker_start, marker_end in (
    ("<!-- retina-mobile-video-v15-start -->", "<!-- retina-mobile-video-v15-end -->"),
    ("<!-- retina-mobile-video-v14-start -->", "<!-- retina-mobile-video-v14-end -->"),
):
    page = re.sub(
        r"\n?    " + re.escape(marker_start) + r"[\s\S]*?    " + re.escape(marker_end) + r"\n?",
        "\n",
        page,
        count=1,
    )
page = re.sub(
    r'\n?    <script src="/mobile-quality\.js\?v=[^"]+"></script>\n?',
    "\n",
    page,
)
write(page_path, page)

style_path = "public/mobile-woodland-loop.css"
style = read(style_path)
for marker_start, marker_end in (
    ("/* retina-mobile-video-v15-start */", "/* retina-mobile-video-v15-end */"),
    ("/* retina-mobile-video-v14-start */", "/* retina-mobile-video-v14-end */"),
):
    style = re.sub(
        re.escape(marker_start) + r"[\s\S]*?" + re.escape(marker_end) + r"\n?",
        "",
        style,
        count=1,
    )
style_start = "/* no-tap-mobile-motion-v16-start */"
style_end = "/* no-tap-mobile-motion-v16-end */"
style_block = f'''{style_start}
/* The moving WebP is the visual background. Keep any stale/cached video node
   from covering it or reintroducing a media-gesture dependency. */
.mobile-background-video {{
  display: none !important;
}}

@media (max-width: 980px) and (orientation: portrait) {{
  .photo-backdrop img {{
    object-fit: cover;
    object-position: 50% 50%;
    image-rendering: auto;
  }}
}}
{style_end}
'''
style = replace_marked(style, style_start, style_end, style_block)
write(style_path, style)

headers_path = "public/_headers"
headers_start = "# no-tap-mobile-motion-v16-start"
headers_end = "# no-tap-mobile-motion-v16-end"
headers_block = f'''{headers_start}
/scenes/{MOTION_FILE}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
{headers_end}
'''
write(
    headers_path,
    replace_marked(
        read(headers_path),
        headers_start,
        headers_end,
        headers_block,
    ),
)

# Replace the former autoplay claim with a regression that verifies the
# animation itself is the page background and no media gesture can be required.
loading_test_path = "test/mobile-background-loading.test.mjs"
loading_test = read(loading_test_path)
old_start = "// retina-mobile-video-v14-test-start"
old_end = "// retina-mobile-video-v14-test-end"
new_start = "// no-tap-mobile-motion-v16-test-start"
new_end = "// no-tap-mobile-motion-v16-test-end"
loading_test_block = f'''{new_start}
test("portrait mobile motion does not depend on video autoplay", async () => {{
  const [pageSource, styleSource, materializerSource, motion] = await Promise.all([
    read("src/page.js"),
    read("public/mobile-woodland-loop.css"),
    read("scripts/materialize-mobile-forest-stream.mjs"),
    readFile(new URL("../public/scenes/{MOTION_FILE}", import.meta.url)),
  ]);

  assert.equal(motion.byteLength, {bytes_count});
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
  assert.match(materializerSource, /no-tap-mobile-motion-v16-validation-start/);
  assert.match(materializerSource, /{re.escape(MOTION_FILE)}/);
}});
{new_end}
'''
if old_start in loading_test:
    loading_test = replace_marked(
        loading_test,
        old_start,
        old_end,
        loading_test_block,
    )
elif new_start in loading_test:
    loading_test = replace_marked(
        loading_test,
        new_start,
        new_end,
        loading_test_block,
    )
else:
    loading_test += "\n" + loading_test_block
write(loading_test_path, loading_test)

print(
    f"Prepared no-tap mobile motion: {MOTION_FILE}, {WIDTH}x{HEIGHT}, "
    f"{bytes_count} bytes, sha256={sha256}."
)
