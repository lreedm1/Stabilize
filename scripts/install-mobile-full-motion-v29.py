#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

root = Path.cwd()
regression_path = root / "scripts/finalize-native-selected-mobile-v24-regressions.mjs"
source = regression_path.read_text(encoding="utf-8")

start = "// mobile-full-motion-v29-finalizer-hook-start"
end = "// mobile-full-motion-v29-finalizer-hook-end"
hook = f'''{start}
await import("./finalize-mobile-full-motion-v29.mjs");
{end}'''

if start in source or end in source:
    if start not in source or end not in source:
        raise SystemExit("incomplete mobile full-motion finalizer hook")
    source = re.sub(
        re.escape(start) + r"[\s\S]*?" + re.escape(end),
        hook,
        source,
        count=1,
    )
else:
    source = source.rstrip() + "\n\n" + hook + "\n"

regression_path.write_text(source, encoding="utf-8")
print("Installed the mobile full-motion v29 finalizer hook.")
