import { COPY } from "./copy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

// Keep the live chat shell independent of the historical landing-page generators.
// Account, billing, feedback, and memory middleware retain their existing hooks.
export function renderPage(options = {}) {
  const { page, client } = COPY;
  const signedIn = options.signedIn === true;
  const notice = String(options.authNotice || "").trim();
  const authControl = signedIn
    ? `<div class="auth-account-controls">
        <form class="auth-session" action="/auth/logout" method="post">
          <span class="auth-state">${escapeHtml(page.auth.signedIn)}</span>
          <button class="auth-link" type="submit">${escapeHtml(page.auth.signOut)}</button>
        </form>
        <button id="delete-memory-button" class="auth-link memory-delete-button" type="button" aria-describedby="memory-delete-status">${escapeHtml(client.deleteMemoryButton)}</button>
        <p id="memory-delete-status" class="memory-delete-status" role="status" aria-live="polite" hidden></p>
      </div>`
    : options.googleSignInAvailable === true
      ? `<a class="google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : `<span class="menu-account-note">Chat without an account.</span>`;
  const privateChatControl = signedIn
    ? `<div class="private-chat-control">
        <button id="private-chat-button" class="private-chat-button" type="button" aria-pressed="false">${escapeHtml(client.privateChatButton)}</button>
        <p class="private-chat-menu-note">${escapeHtml(client.privateChatMenuNote)}</p>
      </div>`
    : "";
  const privacyNote = signedIn
    ? "Signed-in chats use condensed context for up to 30 days. You can delete it in the menu."
    : "Guest conversation stays in this tab. Sign in to remember condensed context between visits.";
  const productCopy = { outcomeQuestion: "What would help next?", outcomeActions: [] };
  const description = "Tell Stabilize what is getting in the way and find a manageable next step.";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Stabilize",
    url: "https://stabilize.info/",
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    description,
  }).replaceAll("<", "\\u003c");

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}" data-signed-in="${signedIn}" data-simple-chat="true">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${description}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#ffffff" />
    <link rel="canonical" href="https://stabilize.info/" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Stabilize" />
    <meta property="og:title" content="Stabilize — One Safe, Practical Next Step" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="https://stabilize.info/" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="Stabilize — One Safe, Practical Next Step" />
    <meta name="twitter:description" content="${description}" />
    <meta name="application-name" content="STABILIZE" />
    <meta name="apple-mobile-web-app-title" content="STABILIZE" />
    <title>Stabilize — One Safe, Practical Next Step</title>
    <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/stabilize-app-20260805-180.png" sizes="180x180" />
    <link rel="manifest" href="/site.webmanifest" />
    <script type="application/ld+json">${structuredData}</script>
    <link rel="preload" href="/fonts/lexend-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin />
    <link rel="stylesheet" href="/styles.css?v=20260807-priority-latency-1" />
    <link rel="stylesheet" href="/seo.css?v=20260808-memory-controls-1" />
    <link rel="stylesheet" href="/product.css?v=20260804-compact-outcomes-2" />
    <link rel="stylesheet" href="/simple-chat.css?v=20260925-1" />
  </head>
  <body class="simple-chat">
    <div class="page-shell">
      <header class="site-header">
        <a class="simple-brand" href="/">Stabilize</a>
        <nav class="header-navigation" aria-label="Primary navigation">
          <details class="site-menu">
            <summary class="menu-toggle" aria-label="Open site menu">Menu</summary>
            <div class="menu-panel">
              <button id="new-conversation-button" class="new-conversation-button" type="button">New chat</button>
              <div class="menu-account" aria-label="${escapeHtml(page.auth.label)}">${authControl}</div>
              <nav class="menu-links" aria-label="Site pages">
                <a href="/privacy.html">Privacy</a>
                <a href="/about.html">About</a>
              </nav>
              <!-- simple-chat-settings -->
              <details class="simple-more">
                <summary>More</summary>
                ${privateChatControl}
                <nav class="menu-links" aria-label="More information">
                  <a href="/safety.html">Safety and limits</a>
                  <a href="/how-it-works.html">How it works</a>
                  <a href="/floor-first.html">Floor-first approach</a>
                  <a href="/sustainability.html">Sustainability</a>
                </nav>
                <details class="menu-info-disclosure">
                  <summary>${escapeHtml(page.chat.infoLabel)}</summary>
                  <p>${escapeHtml(page.chat.infoDetails)}</p>
                </details>
                <a class="menu-admin-link" href="/admin/impact" aria-label="Open admin dashboard" rel="nofollow">Admin</a>
                <!-- simple-chat-feedback -->
              </details>
            </div>
          </details>
        </nav>
      </header>
      ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}
      <main class="chat-card" aria-label="Stabilize AI check-in">
        <section id="conversation-surface" class="conversation-surface" data-view="compose">
          <section id="seo-intro" class="seo-intro simple-intro" aria-labelledby="seo-heading">
            <h1 id="seo-heading">What’s getting in the way?</h1>
          </section>
          <div id="chat-log" class="chat-log" role="log" aria-label="${escapeHtml(page.chat.responseLabel)}" aria-live="polite" aria-atomic="false" tabindex="0" hidden></div>
          <div class="composer-dock">
            ${signedIn ? `<p id="private-chat-status" class="private-chat-status" role="status" hidden>${escapeHtml(client.privateChatStatus)}</p>` : ""}
            <section id="outcome-tray" class="outcome-tray" aria-live="polite" hidden></section>
            <form id="chat-form" class="chat-form">
              <label class="sr-only" for="message-input">${escapeHtml(page.chat.inputLabel)}</label>
              <textarea id="message-input" name="message" rows="2" maxlength="4000" placeholder="Type your message…" required></textarea>
              <button id="send-button" type="submit">${escapeHtml(page.chat.sendButton)}</button>
            </form>
            <p class="simple-boundary">AI can make mistakes. Not emergency care. <a href="/privacy.html" title="${escapeHtml(privacyNote)}">Privacy</a></p>
          </div>
        </section>
      </main>
    </div>
    <template id="client-copy">${escapeHtml(JSON.stringify(client))}</template>
    <template id="product-copy">${escapeHtml(JSON.stringify(productCopy))}</template>
    <script type="module" src="/app.js?v=20260925-simple-chat-1"></script>
    <script type="module" src="/reasoning-choice.js?v=20260807-instant-thinking-2-fastest-1"></script>
  </body>
</html>`;
}
