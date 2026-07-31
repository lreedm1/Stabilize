import { COPY } from "./copy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderEmergencyActions(actions) {
  return actions
    .map((action) => {
      const className = action.primary ? ' class="emergency-primary"' : "";
      return `<a${className} href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`;
    })
    .join("\n            ");
}

function renderQuickActions(actions) {
  return actions
    .map(
      (action) =>
        `<button type="button" data-prompt="${escapeHtml(action.prompt)}">${escapeHtml(action.label)}</button>`,
    )
    .join("\n          ");
}

export function renderPage() {
  const { page, client } = COPY;
  const copyData = escapeHtml(
    JSON.stringify({
      ...client,
      introPlaceholder: page.chat.introPlaceholder,
      followupPlaceholder: page.chat.inputPlaceholder,
    }),
  );

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(page.description)}" />
    <title>${escapeHtml(page.title)}</title>
    <link
      rel="preload"
      href="/fonts/lexend-latin-wght-normal.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />
    <link rel="stylesheet" href="/styles.css" />
  </head>
  <body>
    <div class="page-shell">
      <header class="site-header">
        <h1>${escapeHtml(page.header.name)}</h1>
      </header>

      <main class="chat-card" aria-label="${escapeHtml(page.title)}">
        <button id="danger-button" class="danger-button" type="button">${escapeHtml(page.chat.dangerButton)}</button>

        <section id="emergency-panel" class="emergency-panel" hidden aria-live="assertive">
          <h3>${escapeHtml(page.chat.emergency.title)}</h3>
          <p>${escapeHtml(page.chat.emergency.body)}</p>
          <div class="emergency-actions">
            ${renderEmergencyActions(page.chat.emergency.actions)}
          </div>
          <p class="outside-us">${escapeHtml(page.chat.emergency.outsideUs)}</p>
        </section>

        <section id="conversation-surface" class="conversation-surface" data-view="compose">
          <div
            id="chat-log"
            class="chat-log"
            role="log"
            aria-label="${escapeHtml(page.chat.responseLabel)}"
            aria-live="polite"
            aria-atomic="true"
            hidden
          ></div>

          <form id="chat-form" class="chat-form">
            <label class="sr-only" for="message-input">${escapeHtml(page.chat.inputLabel)}</label>
            <textarea
              id="message-input"
              name="message"
              rows="2"
              maxlength="4000"
              placeholder="${escapeHtml(page.chat.introPlaceholder)}"
              required
            ></textarea>
            <button id="send-button" type="submit">${escapeHtml(page.chat.sendButton)}</button>
          </form>
        </section>

        <div id="quick-actions" class="quick-actions" aria-label="${escapeHtml(page.chat.quickActionsLabel)}">
          ${renderQuickActions(page.chat.quickActions)}
        </div>

      </main>
    </div>

    <template id="client-copy">${copyData}</template>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}
