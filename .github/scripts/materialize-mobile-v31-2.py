from pathlib import Path

OLD_BACKGROUND = "20260813-mobile-background-v31-1"
NEW_BACKGROUND = "20260813-mobile-background-v31-2"
OLD_HANDOFF = "20260813-mobile-video-handoff-v31-1"
NEW_HANDOFF = "20260813-mobile-video-handoff-v31-2"
TEXT_SUFFIXES = {
    ".js",
    ".mjs",
    ".cjs",
    ".css",
    ".json",
    ".yml",
    ".yaml",
    ".md",
    ".txt",
}


def replace_once(source: str, before: str, after: str, label: str) -> str:
    count = source.count(before)
    if count != 1:
        raise SystemExit(f"Expected one {label}, found {count}")
    return source.replace(before, after, 1)


for root_name in ["scripts", "test", ".github/workflows", "src", "public"]:
    root = Path(root_name)
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in TEXT_SUFFIXES:
            continue
        try:
            before = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        after = before.replace(OLD_BACKGROUND, NEW_BACKGROUND).replace(
            OLD_HANDOFF,
            NEW_HANDOFF,
        )
        if after != before:
            path.write_text(after, encoding="utf-8")

finalizer_path = Path("scripts/finalize-mobile-video-handoff-v31.mjs")
finalizer = finalizer_path.read_text(encoding="utf-8")
finalizer = replace_once(
    finalizer,
    "      !(parserSource instanceof HTMLSourceElement)\n",
    "      !parserSource\n",
    "constructor-based parser-source guard",
)
finalizer = replace_once(
    finalizer,
    "  if (source.includes(PARSER_SOURCE_GUARD)) return source;\n",
    """  if (source.includes(PARSER_SOURCE_GUARD)) {
    return source.replace(
      "      !(parserSource instanceof HTMLSourceElement)",
      "      !parserSource",
    );
  }
""",
    "marker-based parser-source early return",
)

helper_anchor = "async function writeMobileBackgroundRouteModule() {\n"
helper = """function requireTimelineAdvanceBeforeLegacyReveal(source) {
  const marker = "mobile-v31-legacy-reveal-needs-progress";
  if (source.includes(marker)) return source;

  const previous = `      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      !motionEligible()`;
  if (!source.includes(previous)) {
    throw new Error(
      "Could not find the v30 reveal guard before requiring timeline progress.",
    );
  }

  const replacement = `      video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA ||
      // ${marker}
      video.currentTime <= 0 ||
      !motionEligible()`;
  return source.replace(previous, replacement);
}

"""
if "function requireTimelineAdvanceBeforeLegacyReveal" not in finalizer:
    finalizer = replace_once(
        finalizer,
        helper_anchor,
        helper + helper_anchor,
        "route-module helper anchor",
    )

old_update = "await update(BACKGROUND_CLIENT_PATH, preserveParserLoadedSource);\n"
new_update = """await update(BACKGROUND_CLIENT_PATH, (source) =>
  requireTimelineAdvanceBeforeLegacyReveal(preserveParserLoadedSource(source)),
);
"""
if old_update in finalizer:
    finalizer = replace_once(
        finalizer,
        old_update,
        new_update,
        "background-client update call",
    )
elif new_update not in finalizer:
    raise SystemExit("Could not wire the legacy reveal progress guard.")
finalizer_path.write_text(finalizer, encoding="utf-8")

handoff_path = Path("public/mobile-video-handoff-v31.js")
handoff = handoff_path.read_text(encoding="utf-8")
handoff = replace_once(
    handoff,
    '    video.style.setProperty("visibility", "hidden", "important");\n',
    '    video.style.setProperty("visibility", "visible", "important");\n',
    "hidden preroll visibility line",
)
handoff = replace_once(
    handoff,
    '    video.style.setProperty("opacity", "0", "important");\n',
    '    video.style.setProperty("opacity", "0.001", "important");\n',
    "zero-opacity preroll line",
)
handoff_path.write_text(handoff, encoding="utf-8")

test_path = Path("test/mobile-video-handoff-v31.test.mjs")
test = test_path.read_text(encoding="utf-8")
test = replace_once(
    test,
    """  assert.match(
    backgroundClient,
    /!\\(parserSource instanceof HTMLSourceElement\\)/,
  );
""",
    """  assert.match(backgroundClient, /!parserSource/);
  assert.match(
    backgroundClient,
    /mobile-v31-legacy-reveal-needs-progress/,
  );
""",
    "constructor-based regression assertion",
)

touch_assertion = "  assert.match(client, /touchstart/);\n"
preroll_assertions = """  const fallbackFunction = client.match(
    /function keepFallbackVisible\\(detail = "fallback"\\) \\{[\\s\\S]*?\\n  \\}/,
  )?.[0];
  assert.ok(fallbackFunction);
  assert.match(
    fallbackFunction,
    /video\\.style\\.setProperty\\("visibility", "visible", "important"\\)/,
  );
  assert.match(
    fallbackFunction,
    /video\\.style\\.setProperty\\("opacity", "0\\.001", "important"\\)/,
  );
"""
if preroll_assertions not in test:
    test = replace_once(
        test,
        touch_assertion,
        touch_assertion + preroll_assertions,
        "touch assertion anchor",
    )

finalizer_assertion = (
    "  assert.match(finalizer, /mobile-v31-parser-source-guard/);\n"
)
progress_assertion = (
    "  assert.match(finalizer, /mobile-v31-legacy-reveal-needs-progress/);\n"
)
if progress_assertion not in test:
    test = replace_once(
        test,
        finalizer_assertion,
        finalizer_assertion + progress_assertion,
        "finalizer assertion anchor",
    )
test_path.write_text(test, encoding="utf-8")

workflow_path = Path(".github/workflows/verify-mobile-video.yml")
workflow = workflow_path.read_text(encoding="utf-8")

payload_anchor = (
    "          grep -Fq 'native-video-2160x3840-24fps' "
    "public/mobile-background-v30.js\n"
)
payload_checks = """          grep -Fq 'mobile-v31-parser-source-guard' public/mobile-background-v30.js
          grep -Fq 'mobile-v31-legacy-reveal-needs-progress' public/mobile-background-v30.js
"""
if payload_checks not in workflow:
    workflow = replace_once(
        workflow,
        payload_anchor,
        payload_anchor + payload_checks,
        "payload client anchor",
    )

handoff_anchor = (
    "          grep -Fq 'playInsideUserGesture' "
    "public/mobile-video-handoff-v31.js\n"
)
handoff_checks = """          grep -Fq 'video.style.setProperty("visibility", "visible", "important")' public/mobile-video-handoff-v31.js
          grep -Fq 'video.style.setProperty("opacity", "0.001", "important")' public/mobile-video-handoff-v31.js
"""
if handoff_checks not in workflow:
    workflow = replace_once(
        workflow,
        handoff_anchor,
        handoff_anchor + handoff_checks,
        "payload handoff anchor",
    )

production_anchor = (
    "              && grep -Fq 'result = video.play()' "
    '"$tmpdir/client.js" \\\n'
)
production_checks = """              && grep -Fq 'mobile-v31-parser-source-guard' "$tmpdir/client.js" \\
              && grep -Fq 'mobile-v31-legacy-reveal-needs-progress' "$tmpdir/client.js" \\
"""
if production_checks not in workflow:
    workflow = replace_once(
        workflow,
        production_anchor,
        production_anchor + production_checks,
        "production client anchor",
    )

production_handoff_anchor = (
    "              && grep -Fq 'playInsideUserGesture' "
    '"$tmpdir/handoff.js" \\\n'
)
production_handoff_checks = """              && grep -Fq 'video.style.setProperty("visibility", "visible", "important")' "$tmpdir/handoff.js" \\
              && grep -Fq 'video.style.setProperty("opacity", "0.001", "important")' "$tmpdir/handoff.js" \\
"""
if production_handoff_checks not in workflow:
    workflow = replace_once(
        workflow,
        production_handoff_anchor,
        production_handoff_anchor + production_handoff_checks,
        "production handoff anchor",
    )

workflow_path.write_text(workflow, encoding="utf-8")

print(
    "Prepared v31-2: stable parser source, visible 0.001-opacity preroll, "
    "and timeline-gated legacy reveal."
)
