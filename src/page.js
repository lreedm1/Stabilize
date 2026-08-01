import { COPY } from "./copy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderPage(options = {}) {
  const { page, client } = COPY;
  const copyData = escapeHtml(JSON.stringify(client));
  const signedIn = options.signedIn === true;
  const googleSignInAvailable = options.googleSignInAvailable === true;
  const notice = String(options.authNotice || "").trim();
  const authControl = signedIn
    ? `<form class="auth-session" action="/auth/logout" method="post">
          <span class="auth-state">${escapeHtml(page.auth.signedIn)}</span>
          <button class="auth-link" type="submit">${escapeHtml(page.auth.signOut)}</button>
        </form>`
    : googleSignInAvailable
      ? `<a class="google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : `<span class="auth-state auth-unavailable" title="${escapeHtml(page.auth.unavailable)}">${escapeHtml(page.auth.unavailable)}</span>`;

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
    <canvas
      id="terrain-background"
      class="terrain-background terrain-fallback"
      aria-hidden="true"
    ></canvas>
    <picture
      id="photo-backdrop"
      class="photo-backdrop"
      aria-hidden="true"
    >
      <source
        media="(orientation: portrait)"
        sizes="100vw"
        srcset="
          /scenes/lake-valley-portrait-720.webp 720w,
          /scenes/lake-valley-portrait-1440.webp 1440w,
          /scenes/lake-valley-portrait-2160.webp 2160w
        "
      />
      <img
        id="photo-backdrop-image"
        src="/scenes/lake-valley-landscape-1280.webp"
        srcset="
          /scenes/lake-valley-landscape-1280.webp 1280w,
          /scenes/lake-valley-landscape-2560.webp 2560w,
          /scenes/lake-valley-landscape-3840.webp 3840w
        "
        sizes="100vw"
        alt=""
        decoding="async"
        fetchpriority="high"
      />
    </picture>
    <canvas
      id="photo-background"
      class="terrain-background photo-background"
      aria-hidden="true"
    ></canvas>
    <div class="page-shell">
      <header class="site-header">
        <h1>${escapeHtml(page.header.name)}</h1>
        <nav class="auth-actions" aria-label="${escapeHtml(page.auth.label)}">
          ${authControl}
        </nav>
      </header>

      ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <main class="chat-card" aria-label="${escapeHtml(page.title)}">
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

          <div class="composer-dock">
            <div class="composer-meta">
              <p>${escapeHtml(page.chat.supportNote)}</p>
              <details class="info-disclosure">
                <summary>${escapeHtml(page.chat.infoLabel)}</summary>
                <div class="info-popover">
                  <p>${escapeHtml(page.chat.infoDetails)}</p>
                </div>
              </details>
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
          </div>
        </section>

      </main>
    </div>

    <template id="client-copy">${copyData}</template>
    <script type="module" src="/app.js"></script>
  </body>
</html>`;
}
