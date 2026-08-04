import { readFile, writeFile } from "node:fs/promises";

const path = "src/page.js";
const before = await readFile(path, "utf8");
const tray = `            <section
              id="outcome-tray"
              class="outcome-tray"
              aria-live="polite"
              hidden
            ></section>
`;
let after = before;

if (after.includes(tray)) {
  after = after.replace(tray, "");
} else if (after.includes('id="outcome-tray"')) {
  throw new Error("Could not isolate the outcome tray before private-chat layout");
}

if (
  !after.includes(
    '<div class="composer-dock">\n            <form id="chat-form" class="chat-form">',
  ) &&
  !after.includes(
    '<div class="composer-dock">\n            ${privateChatStatus}\n            <form id="chat-form" class="chat-form">',
  )
) {
  throw new Error("Private-chat preparation could not find the composer form");
}

if (after !== before) await writeFile(path, after);
console.log("Prepared private-chat layout after the outcome tray pass.");
