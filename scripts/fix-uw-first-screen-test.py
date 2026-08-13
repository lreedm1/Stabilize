from pathlib import Path

path = Path("test/uw-madison-chat.test.mjs")
text = path.read_text()
old = '''  assert.match(html, /Independent project/);
  assert.match(html, /Urgent help/);
  assert.match(html, /Do not wait on this chat during an emergency/);
  assert.match(html, /Independent from UW–Madison/i);
  assert.match(html, /UHS option 9/);
  assert.match(html, /Basic Needs/);
  assert.match(html, /OSAS/);'''
new = '''  assert.match(html, /Independent from UW–Madison/i);
  assert.match(html, /Not operated or endorsed by UW/i);
  assert.match(html, /UW resources/);
  assert.match(html, /Urgent help/);
  assert.match(html, /Do not wait on this chat during an emergency/);
  assert.match(html, /Call 911/);
  assert.match(html, /UHS option 9/);
  assert.match(html, /Call or text 988/);'''
if text.count(old) != 1:
    raise SystemExit("Expected one outdated UW homepage assertion block")
path.write_text(text.replace(old, new))
