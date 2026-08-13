from pathlib import Path
import re

source_path = Path("src/uw-madison-chat.js")
source = source_path.read_text()

source = source.replace(
    '<p class="uw-campus-strip-copy"><strong>Independent project.</strong> Not operated or endorsed by UW–Madison; campus resources are built in.</p>',
    '<p class="uw-campus-strip-copy"><strong>Independent from UW–Madison.</strong> Not operated or endorsed by UW; resources are built in.</p>',
)

unused_cards = re.compile(
    r'\nfunction resourceCardsMarkup\(\) \{[\s\S]*?\n\}\n\nfunction campusPage\(\) \{',
)
source, count = unused_cards.subn('\nfunction campusPage() {', source, count=1)
if count != 1:
    raise SystemExit(f"Expected one unused resource-card helper, removed {count}")
source_path.write_text(source)

test_path = Path("test/uw-madison-chat.test.mjs")
test_source = test_path.read_text()
replacements = {
    '/uwmadison-chat\\.css\\?v=20260813-document-scroll-1/': '/uwmadison-chat\\.css\\?v=20260813-first-screen-1/',
    '/not affiliated with, operated by, or endorsed by UW–Madison/i': '/Independent from UW–Madison/i',
}
for old, new in replacements.items():
    if test_source.count(old) != 1:
        raise SystemExit(f"Expected exactly one test marker: {old}")
    test_source = test_source.replace(old, new)
test_path.write_text(test_source)

css_path = Path("public/uwmadison-chat.css")
css = css_path.read_text()
old_order = '''  width: 100%;
  min-height: 0;
  height: auto;
  flex: 1 1 auto;'''
new_order = '''  width: 100%;
  height: auto;
  flex: 1 1 auto;
  min-height: 0;'''
if css.count(old_order) != 1:
    raise SystemExit("Expected the UW chat-card sizing block")
css_path.write_text(css.replace(old_order, new_order))
