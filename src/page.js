import { COPY } from "./copy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
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
      </header>

      <main class="chat-card" aria-label="${escapeHtml(page.title)}">
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
