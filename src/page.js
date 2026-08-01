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

export function renderPage() {
  const { page, client } = COPY;
  const copyData = escapeHtml(JSON.stringify(client));

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
    <canvas id="terrain-background" class="terrain-background" aria-hidden="true"></canvas>
    <div class="page-shell">
      <header class="site-header">
        <h1>${escapeHtml(page.header.name)}</h1>
        <div class="sound-controls" role="group" aria-label="${escapeHtml(page.sound.groupLabel)}">
          <button
            id="sound-toggle"
            class="sound-toggle"
            type="button"
            aria-pressed="false"
            aria-label="${escapeHtml(COPY.client.soundTurnOn)}"
          >
            <span class="sound-icon" aria-hidden="true">♪</span>
            <span class="sound-name">${escapeHtml(page.sound.toggleLabel)}</span>
            <span id="sound-status" class="sound-status">${escapeHtml(page.sound.statusOff)}</span>
          </button>
          <label class="volume-control" for="sound-volume">
            <span class="sr-only">${escapeHtml(page.sound.volumeLabel)}</span>
            <input
              id="sound-volume"
              type="range"
              min="0"
              max="1"
              step="0.05"
              value="0.36"
              aria-label="${escapeHtml(page.sound.volumeLabel)}"
            />
          </label>
        </div>
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
          >
            <article class="assistant-output intro-output">
              <p>${escapeHtml(page.chat.introBlurb)}</p>
            </article>
          </div>

          <form id="chat-form" class="chat-form">
            <label class="sr-only" for="message-input">${escapeHtml(page.chat.inputLabel)}</label>
            <textarea
              id="message-input"
              name="message"
              rows="2"
              maxlength="4000"
              placeholder="${escapeHtml(page.chat.inputPlaceholder)}"
              required
            ></textarea>
            <button id="send-button" type="submit">${escapeHtml(page.chat.sendButton)}</button>
          </form>
        </section>

      </main>
    </div>

    <template id="client-copy">${copyData}</template>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}
