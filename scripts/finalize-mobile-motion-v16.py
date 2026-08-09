#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

MOTION_NAME = "mobile-forest-stream-motion-v16-1440"
MOTION_ASSET = f"/scenes/{MOTION_NAME}.webp"
VERSION = "20260809-mobile-motion-v16-no-tap-1"


def update(path: str, transform) -> None:
    target = Path(path)
    before = target.read_text()
    after = transform(before)
    if after != before:
        target.write_text(after)


def remove_retired_autoplay_test(source: str) -> str:
    source, _ = re.subn(
        r"\n?// retina-mobile-video-v(?:14|15)-test-start[\s\S]*?"
        r"// retina-mobile-video-v(?:14|15)-test-end\n?",
        "\n",
        source,
        count=1,
    )
    source, _ = re.subn(
        r'\n?test\("portrait mobile always autoplays the Retina background",'
        r"[\s\S]*?\n\}\);\n?",
        "\n",
        source,
        count=1,
    )
    return source


update("test/mobile-background-loading.test.mjs", remove_retired_autoplay_test)


def align_shared_theme_test(source: str) -> str:
    source = re.sub(
        r'^const VERSION = "[^"]+";$',
        f'const VERSION = "{VERSION}";',
        source,
        count=1,
        flags=re.MULTILINE,
    )
    source = source.replace(
        "/scenes/mobile-forest-stream-v14-retina-2160.webp",
        MOTION_ASSET,
    )
    source = source.replace(
        "mobile-forest-stream-v14-retina-2160",
        MOTION_NAME,
    )
    return source


update("test/shared-site-theme.test.mjs", align_shared_theme_test)


def align_mobile_generator(source: str) -> str:
    # The release preparer has already changed the selected asset and generated
    # test. Replace any remaining migration-era v14 names so future canonical
    # builds cannot restore the tap-gated poster expectation.
    source = source.replace(
        "/scenes/mobile-forest-stream-v14-retina-2160.webp",
        MOTION_ASSET,
    )
    source = source.replace(
        "mobile-forest-stream-v14-retina-2160",
        MOTION_NAME,
    )
    source = re.sub(
        r'^const GUIDE_VERSION = "[^"]+";$',
        f'const GUIDE_VERSION = "{VERSION}";',
        source,
        count=1,
        flags=re.MULTILINE,
    )
    source = re.sub(
        r'^const MOBILE_STYLE_VERSION = "[^"]+";$',
        f'const MOBILE_STYLE_VERSION = "{VERSION}";',
        source,
        count=1,
        flags=re.MULTILINE,
    )
    return source


update("scripts/use-mobile-forest-stream.mjs", align_mobile_generator)

loading = Path("test/mobile-background-loading.test.mjs").read_text()
shared = Path("test/shared-site-theme.test.mjs").read_text()
generator = Path("scripts/use-mobile-forest-stream.mjs").read_text()

if "portrait mobile always autoplays the Retina background" in loading:
    raise SystemExit("retired video-autoplay regression is still present")
if MOTION_NAME not in loading:
    raise SystemExit("no-tap motion regression is missing")
if MOTION_NAME not in shared or VERSION not in shared:
    raise SystemExit("shared theme regression does not follow the motion asset")
if MOTION_ASSET not in generator or VERSION not in generator:
    raise SystemExit("canonical mobile generator does not follow the motion asset")

print("Finalized the no-tap mobile motion regression and canonical generator.")
