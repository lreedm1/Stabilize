import { readFile, writeFile } from "node:fs/promises";

const path = "src/impact-dashboard.js";
const before = await readFile(path, "utf8");
let after = before;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Conversation outcome update could not find ${label}`);
  }
}

if (!after.includes("summary.conversationHelpRate < 0.7")) {
  const marker = `function weeklyDecision(summary, finance) {\n`;
  requireText(after, marker, "the weekly decision function");
  after = after.replace(
    marker,
    `${marker}  if (\n    summary.conversationPrompts >= 30 &&\n    summary.conversationResponses < 10\n  ) {\n    return \"Keep the new-conversation outcome prompt visible but unobtrusive before judging whole-chat quality.\";\n  }\n  if (\n    summary.conversationResponses >= 20 &&\n    summary.conversationHelpRate !== null &&\n    summary.conversationHelpRate < 0.7\n  ) {\n    return \"Review conversations marked No, then test one focused change to whole-chat usefulness.\";\n  }\n`,
  );
}

if (!after.includes("<span>Conversation help rate</span>")) {
  const marker = `<div class="tile"><span>Written comments</span><strong>\${formatInteger(summary.feedbackComments)}</strong></div>\n</section>`;
  requireText(after, marker, "the engagement metric grid ending");
  after = after.replace(
    marker,
    `<div class="tile"><span>Written comments</span><strong>\${formatInteger(summary.feedbackComments)}</strong></div>\n<div class="tile"><span>Conversation help rate</span><strong>\${formatPercent(summary.conversationHelpRate)}</strong></div>\n<div class="tile"><span>Conversation feedback rate</span><strong>\${formatPercent(summary.conversationResponseRate)}</strong></div>\n</section>`,
  );
}

if (after !== before) await writeFile(path, after);
console.log("Added whole-conversation outcome metrics.");
