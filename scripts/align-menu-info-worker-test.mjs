import { readFile, writeFile } from "node:fs/promises";

const path = "test/worker.test.mjs";
const before = await readFile(path, "utf8");
const legacy = `  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const infoIndex = html.indexOf(COPY.page.chat.infoDetails);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(outputIndex >= 0 && outputIndex < noteIndex);
  assert.ok(noteIndex < infoIndex && infoIndex < composerIndex);`;
const updated = `  const menuIndex = html.indexOf('class="menu-panel"');
  const infoIndex = html.indexOf(COPY.page.chat.infoDetails, menuIndex);
  const outputIndex = html.indexOf('id="chat-log"');
  const noteIndex = html.indexOf(COPY.page.chat.supportNote);
  const composerIndex = html.indexOf('id="chat-form"');
  assert.ok(menuIndex >= 0 && menuIndex < infoIndex);
  assert.ok(infoIndex < outputIndex);
  assert.ok(outputIndex >= 0 && outputIndex < noteIndex);
  assert.ok(noteIndex < composerIndex);`;

let after = before;
if (after.includes(legacy)) {
  after = after.replace(legacy, updated);
} else if (!after.includes(updated)) {
  throw new Error("Menu Info worker alignment could not find the layout assertion");
}

if (after !== before) await writeFile(path, after);
console.log("Aligned the root-page integration test with Info inside the hamburger menu.");
