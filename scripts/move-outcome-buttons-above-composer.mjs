import { readFile, writeFile } from "node:fs/promises";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

function requireText(text, expected, label) {
  if (!text.includes(expected)) {
    throw new Error(`Outcome-tray policy could not find ${label}`);
  }
}

await update("src/page.js", (source) => {
  let text = source;
  if (!text.includes('id="outcome-tray"')) {
    const anchor = `          <div class="composer-dock">\n            <form id="chat-form" class="chat-form">`;
    requireText(text, anchor, "the composer dock");
    text = text.replace(
      anchor,
      `          <div class="composer-dock">\n            <section\n              id="outcome-tray"\n              class="outcome-tray"\n              aria-live="polite"\n              hidden\n            ></section>\n            <form id="chat-form" class="chat-form">`,
    );
  }

  text = text.replace(
    /<script type="module" src="\/app\.js\?v=[^"]+"><\/script>/,
    '<script type="module" src="/app.js?v=20260804-outcome-tray-1"></script>',
  );

  requireText(text, 'id="outcome-tray"', "the outcome tray");
  return text;
});

await update("public/app.js", (source) => {
  let text = source;

  if (!text.includes('const outcomeTray = document.querySelector("#outcome-tray")')) {
    const anchor = 'const chatLog = document.querySelector("#chat-log");';
    requireText(text, anchor, "the chat-log selector");
    text = text.replace(
      anchor,
      `${anchor}\nconst outcomeTray = document.querySelector("#outcome-tray");`,
    );
  }

  if (!text.includes("function clearOutcomeTray()")) {
    const start = text.indexOf("function appendOutcomeCheck(article, previousReply, route) {");
    const end = text.indexOf("\nfunction scrollConversationToLatest()", start);
    if (start < 0 || end < 0) {
      throw new Error("Outcome-tray policy could not find the outcome-check function");
    }

    const replacement = `function clearOutcomeTray() {
  if (!(outcomeTray instanceof HTMLElement)) return;
  outcomeTray.replaceChildren();
  outcomeTray.hidden = true;
}

function renderOutcomeCheck(previousReply, route) {
  if (!(outcomeTray instanceof HTMLElement)) return;
  const selected = selectOutcomeActionSet(route, previousReply);
  const section = document.createElement("section");
  section.className = "outcome-check";
  section.setAttribute("aria-label", selected.question);

  const question = document.createElement("p");
  question.className = "outcome-question";
  question.textContent = selected.question;

  const actions = document.createElement("div");
  actions.className = "outcome-actions";

  const configuredActions = Array.isArray(selected.actions)
    ? selected.actions.slice(0, 3)
    : [];
  const buttons = [];

  function disableButtons() {
    for (const button of buttons) button.disabled = true;
  }

  for (const action of configuredActions) {
    const label = String(action?.label || "").trim();
    const prompt = String(action?.prompt || "").trim();
    if (!label || !prompt) continue;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "outcome-button";
    button.textContent = label;
    button.addEventListener("click", () => {
      if (pending) return;
      disableButtons();
      outcomeTray.hidden = true;
      nextVisibleUserText = label;
      void sendMessage(buildOutcomeActionPrompt(prompt, previousReply));
    });
    buttons.push(button);
    actions.appendChild(button);
  }

  section.append(question, actions);
  outcomeTray.replaceChildren(section);
  outcomeTray.hidden = buttons.length === 0;
}`;

    text = text.slice(0, start) + replacement + text.slice(end);
  }

  text = text.replace(
    "  if (offerOutcomeCheck) appendOutcomeCheck(article, content, route);",
    `  if (offerOutcomeCheck) renderOutcomeCheck(content, route);\n  else clearOutcomeTray();`,
  );

  text = text.replace(
    `function restoreComposeView() {\n  chatLog.replaceChildren();`,
    `function restoreComposeView() {\n  clearOutcomeTray();\n  chatLog.replaceChildren();`,
  );

  if (!text.includes("clearOutcomeTray();\n  activeAssistantOutput = null;")) {
    text = text.replace(
      `  thinkingOutput?.remove();\n  activeAssistantOutput = null;`,
      `  thinkingOutput?.remove();\n  clearOutcomeTray();\n  activeAssistantOutput = null;`,
    );
  }

  requireText(text, "function renderOutcomeCheck(previousReply, route)", "the tray renderer");
  requireText(text, "outcomeTray.replaceChildren(section)", "the tray placement");
  requireText(text, "else clearOutcomeTray();", "stale prompt cleanup");
  if (text.includes("appendOutcomeCheck(article")) {
    throw new Error("Outcome buttons are still attached to assistant responses");
  }
  return text;
});

await update("public/product.css", (source) => {
  let text = source;

  if (!text.includes(".outcome-tray {")) {
    const anchor = ".outcome-check {";
    requireText(text, anchor, "the outcome-check styles");
    text = text.replace(
      anchor,
      `.outcome-tray {
  width: min(760px, 100%);
  margin: 0 auto 9px;
}

.outcome-tray[hidden] {
  display: none;
}

${anchor}`,
    );
  }

  text = text.replace(
    `.outcome-check {\n  margin-top: 1.1rem;\n  border-top: 1px solid var(--line);\n  padding-top: 0.9rem;\n}`,
    `.outcome-check {\n  border: 1px solid rgba(31, 111, 84, 0.22);\n  border-radius: 14px;\n  background: rgba(255, 253, 247, 0.82);\n  box-shadow: 0 6px 18px rgba(7, 31, 21, 0.12);\n  padding: 10px 12px;\n  backdrop-filter: blur(10px);\n}`,
  );
  text = text.replace(
    ".assistant-output .outcome-question {",
    ".outcome-question {",
  );

  requireText(text, ".outcome-tray {", "the tray styles");
  requireText(text, ".outcome-question {", "the tray question styles");
  return text;
});

console.log("Moved follow-up prompt buttons above the user composer.");
