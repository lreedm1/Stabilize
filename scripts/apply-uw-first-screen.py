from pathlib import Path
import re

source_path = Path("src/uw-madison-chat.js")
source = source_path.read_text()

banner_pattern = re.compile(
    r'  const banner = `<section class="uw-chat-banner"[\s\S]*?\n  </section>`;\n',
)
replacement = '''  const campusChrome = `<section class="uw-campus-strip" aria-label="About this UW–Madison chat">
    <p class="uw-campus-strip-copy"><strong>Independent project.</strong> Not operated or endorsed by UW–Madison; campus resources are built in.</p>
    <div class="uw-campus-strip-actions">
      <a class="uw-resource-link" href="https://uwmadison.stabilize.info/#campus-resources">UW resources</a>
      <details class="uw-urgent-disclosure">
        <summary>Urgent help</summary>
        <div class="uw-urgent-panel" role="group" aria-label="Urgent support options">
          <p class="uw-urgent-note">Do not wait on this chat during an emergency.</p>
          <a href="tel:911"><strong>Call 911</strong><span>Immediate danger or medical emergency</span></a>
          <a href="tel:+16082655600"><strong>Call UHS · option 9</strong><span>24/7 mental-health crisis support</span></a>
          <a href="tel:988"><strong>Call or text 988</strong><span>Suicide &amp; Crisis Lifeline</span></a>
        </div>
      </details>
    </div>
  </section>`;
'''
source, count = banner_pattern.subn(replacement, source, count=1)
if count != 1:
    raise SystemExit(f"Expected one UW banner block, replaced {count}")

old_opening = '''      `${banner}\\n      <main class="chat-card" aria-label="UW–Madison resource-aware Stabilize chat">`,'''
new_opening = '''      `<main class="chat-card" aria-label="UW–Madison resource-aware Stabilize chat">\\n        ${campusChrome}`,'''
if source.count(old_opening) != 1:
    raise SystemExit("Expected one UW chat-card insertion")
source = source.replace(old_opening, new_opening)

old_version = "/uwmadison-chat.css?v=20260813-document-scroll-1"
new_version = "/uwmadison-chat.css?v=20260813-first-screen-1"
if source.count(old_version) != 1:
    raise SystemExit("Expected one UW stylesheet version")
source = source.replace(old_version, new_version)
source_path.write_text(source)

test_path = Path("test/uw-madison-chat.test.mjs")
test_source = test_path.read_text()
old_heading_assertion = "  assert.match(html, /Campus help is built into the conversation/);"
new_heading_assertions = """  assert.match(html, /Independent project/);
  assert.match(html, /Urgent help/);
  assert.match(html, /Do not wait on this chat during an emergency/);"""
if test_source.count(old_heading_assertion) != 1:
    raise SystemExit("Expected one old banner heading assertion")
test_source = test_source.replace(old_heading_assertion, new_heading_assertions)

test_source = test_source.replace(
    "    /uwmadison-chat\\.css\\?v=20260813-document-scroll-1/\,",
    "    /uwmadison-chat\\.css\\?v=20260813-first-screen-1/\,",
)
test_source = test_source.replace(
    'test("the campus stylesheet creates document overflow instead of shrinking the chat", async () => {',
    'test("the campus stylesheet keeps the composer above the fold with compact urgent help", async () => {',
)

start_marker = '''  assert.match(
    css,
    /html\\[data-campus-chat="uwmadison"\\][\\s\\S]*?overflow-y:\\s*auto\\s*!important/,
  );'''
end_marker = '''  assert.doesNotMatch(
    css,
    /html\\[data-campus-chat="uwmadison"\\]\\s+\\.page-shell\\s*\\{[^}]*overflow-y:\\s*auto/,
  );'''
start = test_source.find(start_marker)
end = test_source.find(end_marker)
if start < 0 or end < 0:
    raise SystemExit("Could not find the old UW scroll assertion block")
end += len(end_marker)
new_block = '''  assert.match(css, /\\.uw-campus-strip/);
  assert.match(css, /\\.uw-urgent-disclosure/);
  assert.match(css, /\\.uw-urgent-panel/);
  assert.match(
    css,
    /html\\[data-campus-chat="uwmadison"\\]\\s+\\.page-shell[\\s\\S]*?height:\\s*100dvh\\s*!important[\\s\\S]*?overflow:\\s*hidden\\s*!important/,
  );
  assert.match(
    css,
    /html\\[data-campus-chat="uwmadison"\\]\\s+\\.chat-card[\\s\\S]*?flex:\\s*1 1 auto[\\s\\S]*?min-height:\\s*0/,
  );
  assert.match(css, /position:\\s*absolute/);
  assert.match(css, /max-height:\\s*calc\\(100dvh - 120px\\)/);
  assert.doesNotMatch(css, /\\.uw-chat-banner/);
  assert.doesNotMatch(css, /\\.uw-emergency-links/);'''
test_source = test_source[:start] + new_block + test_source[end:]
test_path.write_text(test_source)
