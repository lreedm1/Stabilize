#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

root = Path.cwd()
path = root / "scripts/finalize-native-selected-mobile-v24-regressions.mjs"
source = path.read_text(encoding="utf-8")


def remove_block(text: str, start: str, end: str) -> str:
    if start not in text and end not in text:
        return text
    if start not in text or end not in text:
        raise SystemExit(f"incomplete finalizer hook: {start}")
    return re.sub(
        r"\n?" + re.escape(start) + r"[\s\S]*?" + re.escape(end) + r"\n?",
        "\n",
        text,
        count=1,
    )


source = remove_block(
    source,
    "// mobile-full-motion-v29-finalizer-hook-start",
    "// mobile-full-motion-v29-finalizer-hook-end",
)
source = remove_block(
    source,
    "// mobile-background-v30-finalizer-hook-start",
    "// mobile-background-v30-finalizer-hook-end",
)

hook = '''// mobile-background-v30-finalizer-hook-start
await import("./finalize-mobile-background-v30.mjs");
// mobile-background-v30-finalizer-hook-end'''
source = source.rstrip() + "\n\n" + hook + "\n"
path.write_text(source, encoding="utf-8")
print("Installed the v30 mobile background as the final canonical media step.")
