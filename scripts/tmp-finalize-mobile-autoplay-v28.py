#!/usr/bin/env python3
from pathlib import Path

VERSION = "20260812-mobile-autoplay-v28-1"

page_path = Path("src/page.js")
page = page_path.read_text()
page = page.replace(
    "/mobile-autoplay-v27.css?v=20260812-mobile-autoplay-v27-1",
    f"/mobile-autoplay-v27.css?v={VERSION}",
)
page = page.replace(
    "/mobile-autoplay-v27.js?v=20260812-mobile-autoplay-v27-1",
    f"/mobile-autoplay-v27.js?v={VERSION}",
)
page_path.write_text(page)

finalizer_path = Path("scripts/finalize-mobile-autoplay-v27.mjs")
finalizer = finalizer_path.read_text()
finalizer = finalizer.replace(
    'const VERSION = "20260812-mobile-autoplay-v27-1";',
    f'const VERSION = "{VERSION}";',
)
finalizer = finalizer.replace(
    "Finalized parser-early mobile autoplay with animated fallback v27.",
    "Finalized render-visible parser-early mobile autoplay v28.",
)
finalizer_path.write_text(finalizer)

test_path = Path("test/mobile-autoplay-v27.test.mjs")
test = test_path.read_text()
test = test.replace(
    'const VERSION = "20260812-mobile-autoplay-v27-1";',
    f'const VERSION = "{VERSION}";',
)
test = test.replace(
    'test("mobile autoplay starts beside the parsed video and preserves motion fallback", async () => {',
    'test("mobile autoplay keeps the video render-visible before the first tap", async () => {',
)
test = test.replace(
    'assert.match(client, /setState\\("blocked", error\\)/);',
    'assert.match(client, /setState\\("blocked", error\\)/);\n'
    '  assert.match(client, /video\\.removeAttribute\\("poster"\\)/);\n'
    '  assert.match(client, /video\\.src = VIDEO_ASSET/);\n'
    '  assert.match(client, /mobileAutoplayV28/);',
)
old_style_assertion = '''  assert.match(
    styles,
    /data-mobile-autoplay-v27="playing"[\\s\\S]*#mobile-background-video/,
  );
  assert.match(
    styles,
    /not\\(\\[data-mobile-autoplay-v27="playing"\\]\\)[\\s\\S]*#mobile-motion-canvas/,
  );
  assert.match(styles, /visibility: hidden !important;[\\s\\S]*opacity: 0 !important;/);'''
new_style_assertion = '''  assert.match(styles, /data-mobile-autoplay-v28/);
  assert.match(
    styles,
    /#mobile-background-video[\\s\\S]*visibility: visible !important;[\\s\\S]*opacity: 1 !important;/,
  );
  assert.doesNotMatch(
    styles,
    /not\\(\\[data-mobile-autoplay-v28="playing"\\]\\)[\\s\\S]{0,500}#mobile-background-video[\\s\\S]{0,300}visibility: hidden/,
  );
  assert.match(
    styles,
    /not\\(\\[data-mobile-autoplay-v28="playing"\\]\\)[\\s\\S]*#mobile-motion-canvas/,
  );'''
if old_style_assertion not in test and new_style_assertion not in test:
    raise SystemExit("autoplay style assertion block was not found")
test = test.replace(old_style_assertion, new_style_assertion)
test_path.write_text(test)
