#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import json
import re
import shutil
import sys
from pathlib import Path

ROOT = Path.cwd()
VIDEO_PATH = Path("public/scenes/mobile-forest-stream-video-v12-720.mp4")
METADATA_PATH = Path("scripts/mobile-smooth-v32.json")

OLD_VERSION = "20260813-mobile-smooth-v32-1"
NEW_VERSION = "20260813-mobile-smooth-v33-1"
OLD_SHA256 = "78b6c1f1928d369e2d2a5b15d3b0de44b0458e1f5a940034080c0d8861e14bc3"
OLD_BYTES = 1_314_209
OLD_QUALITY = "native-video-720x1280-24fps"
NEW_QUALITY = "native-video-720x1280-60fps"
CACHE_POLICY = "public, max-age=31536000, immutable"

if len(sys.argv) != 2:
    raise SystemExit("usage: finalize-mobile-smooth-v33.py GENERATED_VIDEO")

generated_video = Path(sys.argv[1])
if not generated_video.is_file():
    raise SystemExit(f"generated video is missing: {generated_video}")

video = generated_video.read_bytes()
video_bytes = len(video)
video_sha256 = hashlib.sha256(video).hexdigest()
video_bytes_literal = f"{video_bytes:,}".replace(",", "_")

if not 800_000 < video_bytes < 4_500_000:
    raise SystemExit(f"unexpected v33 video size: {video_bytes}")
if len(video) < 12 or video[4:8] != b"ftyp":
    raise SystemExit("generated v33 video is not an MP4")
for marker in (b"moov", b"mdat", b"vide", b"avc1"):
    if marker not in video:
        raise SystemExit(f"generated v33 video is missing {marker!r}")
if b"mp4a" in video or b"soun" in video:
    raise SystemExit("generated v33 video must not contain audio")

VIDEO_PATH.parent.mkdir(parents=True, exist_ok=True)
shutil.copyfile(generated_video, VIDEO_PATH)


def read_text(path: str | Path) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write_text(path: str | Path, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_required(
    source: str,
    old: str,
    new: str,
    label: str,
    *,
    minimum: int = 1,
) -> str:
    count = source.count(old)
    if count < minimum:
        raise RuntimeError(f"Could not find {label}; expected at least {minimum}, found {count}")
    return source.replace(old, new)


def sub_required(
    source: str,
    pattern: str,
    replacement: str,
    label: str,
    *,
    flags: int = 0,
    count: int = 1,
) -> str:
    updated, replacements = re.subn(pattern, replacement, source, count=count, flags=flags)
    if replacements != count:
        raise RuntimeError(
            f"Could not update {label}; expected {count} replacement(s), found {replacements}"
        )
    return updated


metadata = json.loads(read_text(METADATA_PATH))
if metadata.get("videoAsset") != "/scenes/mobile-forest-stream-video-v12-720.mp4":
    raise RuntimeError("Unexpected canonical mobile video asset")
metadata.update(
    {
        "version": NEW_VERSION,
        "videoBytes": video_bytes,
        "videoSha256": video_sha256,
        "fps": 60,
        "uniqueSampleFrames": 60,
        "quality": NEW_QUALITY,
    }
)
write_text(METADATA_PATH, json.dumps(metadata, indent=2) + "\n")

responder_path = Path("src/mobile-video-response.js")
responder = read_text(responder_path)
responder = sub_required(
    responder,
    r"export const MOBILE_VIDEO_BYTES = [\d_]+;",
    f"export const MOBILE_VIDEO_BYTES = {video_bytes_literal};",
    "mobile video byte count",
)
responder = sub_required(
    responder,
    r"export const MOBILE_VIDEO_ETAG =\n\s+'\"[0-9a-f]+\"';",
    f"export const MOBILE_VIDEO_ETAG =\n  '\"{video_sha256}\"';",
    "mobile video ETag",
)
responder = replace_required(
    responder,
    '"Cache-Control": "private, no-store, max-age=0, must-revalidate",',
    f'"Cache-Control": "{CACHE_POLICY}",',
    "private mobile video cache policy",
)
responder = replace_required(
    responder,
    '"CDN-Cache-Control": "no-store",',
    f'"CDN-Cache-Control": "{CACHE_POLICY}",',
    "CDN mobile video cache policy",
)
responder = replace_required(
    responder,
    '"Cloudflare-CDN-Cache-Control": "no-store",',
    f'"Cloudflare-CDN-Cache-Control": "{CACHE_POLICY}",',
    "Cloudflare mobile video cache policy",
)
responder = responder.replace('    Pragma: "no-cache",\n', "")
write_text(responder_path, responder)

handoff_path = Path("public/mobile-video-handoff-v31.js")
handoff = read_text(handoff_path)
handoff = sub_required(
    handoff,
    r'const VERSION = "[^"]+";',
    f'const VERSION = "{NEW_VERSION}";',
    "mobile handoff version",
)
handoff = replace_required(
    handoff,
    OLD_QUALITY,
    NEW_QUALITY,
    "24 fps mobile quality label",
)
write_text(handoff_path, handoff)

page_path = Path("src/page.js")
page = read_text(page_path)
page = replace_required(page, OLD_VERSION, NEW_VERSION, "v32 page asset version", minimum=2)
page = sub_required(
    page,
    r"/main-box-white\.css\?v=[A-Za-z0-9._-]+",
    f"/main-box-white.css?v={NEW_VERSION}",
    "mobile reading-surface stylesheet cache key",
)
write_text(page_path, page)

materializer_path = Path("scripts/materialize-mobile-forest-stream.mjs")
materializer = read_text(materializer_path)
materializer = replace_required(
    materializer,
    f"const smoothVideoExpectedBytes = {OLD_BYTES:,};".replace(",", "_"),
    f"const smoothVideoExpectedBytes = {video_bytes_literal};",
    "materialized smooth video byte count",
)
materializer = replace_required(
    materializer,
    f'const smoothVideoExpectedSha256 = "{OLD_SHA256}";',
    f'const smoothVideoExpectedSha256 = "{video_sha256}";',
    "materialized smooth video checksum",
)
write_text(materializer_path, materializer)

canonical_finalizer_path = Path("scripts/finalize-mobile-smooth-v32.mjs")
canonical_finalizer = read_text(canonical_finalizer_path)
canonical_finalizer = replace_required(
    canonical_finalizer,
    r"next = next.replace(/native-video-\d+x\d+-24fps/g, QUALITY);",
    r"next = next.replace(/native-video-\d+x\d+-\d+fps/g, QUALITY);",
    "future-proof mobile quality replacement",
)
canonical_finalizer = canonical_finalizer.replace("The v32", "The v33")
canonical_finalizer = canonical_finalizer.replace("the v32", "the v33")
canonical_finalizer = canonical_finalizer.replace(
    "baseline H.264, and no animated canvas on first load.",
    "60 fps baseline H.264, and no animated canvas on first load.",
)
write_text(canonical_finalizer_path, canonical_finalizer)


def apply_release_tokens(source: str) -> str:
    source = source.replace(OLD_VERSION, NEW_VERSION)
    source = source.replace(OLD_SHA256, video_sha256)
    source = source.replace(str(OLD_BYTES), str(video_bytes))
    source = source.replace(
        f"{OLD_BYTES:,}".replace(",", "_"),
        video_bytes_literal,
    )
    source = source.replace(OLD_QUALITY, NEW_QUALITY)
    return source


node_test_path = Path("test/mobile-smooth-v32.test.mjs")
node_test = apply_release_tokens(read_text(node_test_path))
node_test = replace_required(
    node_test,
    "mobile smooth v32 uses a small native stream",
    "mobile smooth v33 uses a small genuine 60 fps stream",
    "mobile smooth test title",
)
node_test = replace_required(
    node_test,
    "assert.equal(metadata.fps, 24);",
    "assert.equal(metadata.fps, 60);\n  assert.ok(metadata.uniqueSampleFrames >= 48);",
    "metadata frame-rate assertion",
)
cache_constant = f'const CACHE_POLICY = "{CACHE_POLICY}";\n'
if "const CACHE_POLICY =" not in node_test:
    node_test = replace_required(
        node_test,
        f'const VIDEO_SHA256 =\n  "{video_sha256}";\n',
        f'const VIDEO_SHA256 =\n  "{video_sha256}";\n{cache_constant}',
        "cache policy test constant",
    )
cache_assertions = '''  assert.equal(full.headers.get("cache-control"), CACHE_POLICY);
  assert.equal(full.headers.get("cdn-cache-control"), CACHE_POLICY);
  assert.equal(full.headers.get("cloudflare-cdn-cache-control"), CACHE_POLICY);
'''
if 'full.headers.get("cdn-cache-control")' not in node_test:
    node_test = replace_required(
        node_test,
        '  assert.equal(full.headers.get("accept-ranges"), "bytes");\n',
        '  assert.equal(full.headers.get("accept-ranges"), "bytes");\n' + cache_assertions,
        "cache header assertions",
    )
style_assertions = '''  const mobileSurfaceStyle = await readFile(
    new URL("../public/main-box-white.css", import.meta.url),
    "utf8",
  );
  assert.match(mobileSurfaceStyle, /mobile-video-smooth-v33-start/);
  assert.match(mobileSurfaceStyle, /-webkit-backdrop-filter: none/);
  assert.match(mobileSurfaceStyle, /backdrop-filter: none/);

'''
if "mobile-video-smooth-v33-start" not in node_test:
    node_test = replace_required(
        node_test,
        "  const env = {\n",
        style_assertions + "  const env = {\n",
        "mobile no-blur assertions",
    )
node_test = node_test.replace(/Verify mobile smooth v32/.pattern if False else "Verify mobile smooth v32", "Verify mobile smooth v33")
write_text(node_test_path, node_test)

workflow_paths = [
    Path("scripts/verify-mobile-smooth-v32.yml"),
    Path(".github/workflows/verify-mobile-video.yml"),
]
for workflow_path in workflow_paths:
    workflow = apply_release_tokens(read_text(workflow_path))
    workflow = workflow.replace("Verify mobile smooth v32", "Verify mobile smooth v33")
    workflow = workflow.replace("verify-mobile-smooth-v32-${{ github.ref }}", "verify-mobile-smooth-v33-${{ github.ref }}")
    workflow = workflow.replace("verification/mobile-smooth-v32", "verification/mobile-smooth-v33")
    workflow = workflow.replace("Waiting for mobile smooth v32", "Waiting for mobile smooth v33")
    workflow = workflow.replace("mobile-v32=", "mobile-v33=")
    workflow = workflow.replace("v32 attempt", "v33 attempt")
    workflow = workflow.replace("Mobile smooth v32", "Mobile smooth v33")
    workflow = workflow.replace("mobile smooth v32", "mobile smooth v33")
    workflow = workflow.replace("exact v32", "exact v33")
    workflow = workflow.replace("Exact v32", "Exact v33")
    workflow = workflow.replace("mobile-smooth-v32-webkit", "mobile-smooth-v33-webkit")
    workflow = workflow.replace("/tmp/mobile-smooth-v32", "/tmp/mobile-smooth-v33")
    workflow = workflow.replace("v32 video", "v33 video")
    workflow = workflow.replace("v32 canvas", "v33 canvas")
    workflow = workflow.replace("24/1", "60/1")
    release_guards = f'''          grep -Fq 'Cache-Control": "{CACHE_POLICY}' src/mobile-video-response.js
          grep -Fq 'mobile-video-smooth-v33-start' public/main-box-white.css
          grep -Fq -- '-webkit-backdrop-filter: none' public/main-box-white.css
          grep -Fq '/main-box-white.css?v={NEW_VERSION}' src/page.js
'''
    if "mobile-video-smooth-v33-start" not in workflow:
        workflow = replace_required(
            workflow,
            "          grep -Fq 'Content-Range' src/mobile-video-response.js\n",
            "          grep -Fq 'Content-Range' src/mobile-video-response.js\n" + release_guards,
            f"v33 release guards in {workflow_path}",
        )
    write_text(workflow_path, workflow)

legacy_test_path = Path("test/mobile-background-loading.test.mjs")
legacy_test = read_text(legacy_test_path)
legacy_test = legacy_test.replace(
    "the mobile video response has a strong ETag and exact uncached ranges",
    "the mobile video response has a strong ETag and exact cacheable ranges",
)
legacy_test = legacy_test.replace(
    'assert.match(full.headers.get("cache-control"), /no-store/);',
    f'assert.equal(full.headers.get("cache-control"), "{CACHE_POLICY}");',
)
legacy_test = legacy_test.replace(
    'assert.equal(full.headers.get("cdn-cache-control"), "no-store");',
    f'assert.equal(full.headers.get("cdn-cache-control"), "{CACHE_POLICY}");',
)
legacy_test = legacy_test.replace(
    'assert.equal(full.headers.get("cloudflare-cdn-cache-control"), "no-store");',
    f'assert.equal(full.headers.get("cloudflare-cdn-cache-control"), "{CACHE_POLICY}");',
)
write_text(legacy_test_path, legacy_test)

style_path = Path("public/main-box-white.css")
style = read_text(style_path).rstrip() + "\n"
style_start = "/* mobile-video-smooth-v33-start */"
style_end = "/* mobile-video-smooth-v33-end */"
style_block = f'''\n{style_start}
@media (max-width: 980px) and (orientation: portrait) {{
  .seo-intro,
  .assistant-output {{
    background: rgba(42, 47, 46, 0.76);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }}
}}
{style_end}
'''
if style_start in style:
    style = re.sub(
        re.escape(style_start) + r"[\s\S]*?" + re.escape(style_end),
        style_block.strip(),
        style,
        count=1,
    )
else:
    style += style_block
write_text(style_path, style)

# The canonical finalizer copies the template over the active workflow. Keep
# them byte-identical before running the repository's policy chain.
template = read_text("scripts/verify-mobile-smooth-v32.yml")
write_text(".github/workflows/verify-mobile-video.yml", template)

for path in (
    responder_path,
    handoff_path,
    page_path,
    materializer_path,
    node_test_path,
    METADATA_PATH,
):
    source = read_text(path)
    if OLD_VERSION in source or OLD_SHA256 in source or OLD_QUALITY in source:
        raise RuntimeError(f"stale v32 payload identity remains in {path}")

print(
    json.dumps(
        {
            "version": NEW_VERSION,
            "video": str(VIDEO_PATH),
            "bytes": video_bytes,
            "sha256": video_sha256,
            "fps": 60,
            "cache": CACHE_POLICY,
            "mobileBackdropBlur": False,
        },
        sort_keys=True,
    )
)
