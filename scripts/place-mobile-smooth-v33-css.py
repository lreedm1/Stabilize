#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

NEW_VERSION = "20260813-mobile-smooth-v33-1"
MAIN_BOX_VERSION = "20260805-2"
START = "/* mobile-video-smooth-v33-start */"
END = "/* mobile-video-smooth-v33-end */"


def read(path: str) -> str:
    return Path(path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding="utf-8")


def remove_block(source: str) -> str:
    pattern = r"\n*" + re.escape(START) + r"[\s\S]*?" + re.escape(END) + r"\n*"
    return re.sub(pattern, "\n", source, count=1).rstrip() + "\n"


block = f'''{START}
@media (max-width: 980px) and (orientation: portrait) {{
  .seo-intro,
  .assistant-output {{
    background: rgba(42, 47, 46, 0.76);
    -webkit-backdrop-filter: none;
    backdrop-filter: none;
  }}
}}
{END}
'''

# Keep the reading-surface stylesheet and its long-standing ordering contract
# unchanged. The override belongs in the mobile background layer, which loads
# after the reading surface and is already served by the Worker with no-store.
main_box_path = "public/main-box-white.css"
main_box = remove_block(read(main_box_path))
write(main_box_path, main_box)

mobile_style_path = "public/mobile-background-v30.css"
mobile_style = remove_block(read(mobile_style_path)).rstrip() + "\n\n" + block
write(mobile_style_path, mobile_style)

page_path = "src/page.js"
page = read(page_path).replace(
    f"/main-box-white.css?v={NEW_VERSION}",
    f"/main-box-white.css?v={MAIN_BOX_VERSION}",
)
write(page_path, page)

node_test_path = "test/mobile-smooth-v32.test.mjs"
node_test = read(node_test_path).replace(
    "../public/main-box-white.css",
    "../public/mobile-background-v30.css",
)
write(node_test_path, node_test)

for workflow_path in (
    "scripts/verify-mobile-smooth-v32.yml",
    ".github/workflows/verify-mobile-video.yml",
):
    workflow = read(workflow_path)
    workflow = workflow.replace(
        "public/main-box-white.css",
        "public/mobile-background-v30.css",
    )
    workflow = re.sub(
        rf"^\s*grep -Fq '/main-box-white\.css\?v={re.escape(NEW_VERSION)}' src/page\.js\n",
        "",
        workflow,
        flags=re.MULTILINE,
    )
    write(workflow_path, workflow)

# The v31 finalizer embeds the mobile stylesheet into this Worker module later
# in the canonical policy chain. These checks make a misplaced or lost override
# fail before the release can be published.
assert START not in read(main_box_path)
assert f"/main-box-white.css?v={MAIN_BOX_VERSION}" in read(page_path)
assert START in read(mobile_style_path)
assert "-webkit-backdrop-filter: none" in read(mobile_style_path)
assert "../public/mobile-background-v30.css" in read(node_test_path)

print("Placed the v33 no-blur override in the Worker-served mobile stylesheet.")
