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
  const canonicalUrl = "https://reedlokken.com/";
  const seoTitle = "Stabilize — Free AI Check-In for Overwhelmed Moments";
  const seoDescription =
    "A free, floor-first AI check-in that helps adults reduce overload, protect immediate needs, and choose one manageable next step. Not therapy or emergency care.";
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Stabilize",
    url: canonicalUrl,
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    description: seoDescription,
    creator: {
      "@type": "Person",
      name: "Reed Lokken",
    },
  }).replaceAll("<", "\\u003c");
  const authControl = signedIn
    ? `<form class="auth-session" action="/auth/logout" method="post">
          <span class="auth-state">${escapeHtml(page.auth.signedIn)}</span>
          <button class="auth-link" type="submit">${escapeHtml(page.auth.signOut)}</button>
        </form>`
    : googleSignInAvailable
      ? `<a class="google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : `<span class="menu-account-note">Guest chat is available without an account.</span>`;
  const headerAuthControl = signedIn
    ? `<form class="auth-session header-auth-session" action="/auth/logout" method="post">
          <button class="auth-link header-sign-out" type="submit">${escapeHtml(page.auth.signOut)}</button>
        </form>`
    : googleSignInAvailable
      ? `<a class="google-sign-in header-google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : "";

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(seoDescription)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#173f31" />
    <link rel="canonical" href="${canonicalUrl}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="Stabilize" />
    <meta property="og:title" content="${escapeHtml(seoTitle)}" />
    <meta property="og:description" content="${escapeHtml(seoDescription)}" />
    <meta property="og:url" content="${canonicalUrl}" />
    <meta name="twitter:card" content="summary" />
    <meta name="twitter:title" content="${escapeHtml(seoTitle)}" />
    <meta name="twitter:description" content="${escapeHtml(seoDescription)}" />
    <title>${escapeHtml(seoTitle)}</title>
    <script type="application/ld+json">${structuredData}</script>
    <link
      rel="preload"
      href="/fonts/lexend-latin-wght-normal.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/seo.css" />
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
        <a class="site-name" href="/" aria-label="Stabilize home">${escapeHtml(page.header.name)}</a>
        <div class="header-actions">
          ${headerAuthControl ? `<nav class="auth-actions header-auth-actions" aria-label="${escapeHtml(page.auth.label)}">${headerAuthControl}</nav>` : ""}
          <details class="site-menu">
            <summary class="menu-toggle" aria-label="Open site menu">
              <span class="sr-only">Menu</span>
              <span class="menu-icon" aria-hidden="true">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </summary>
            <div class="menu-panel">
              <nav class="menu-links" aria-label="Site pages">
                <a href="/how-it-works.html">How it works</a>
                <a href="/floor-first.html">Floor-first approach</a>
                <a href="/safety.html">Safety and limits</a>
                <a href="/privacy.html">Privacy</a>
              </nav>
              <div class="menu-account" aria-label="${escapeHtml(page.auth.label)}">
                ${authControl}
              </div>
            </div>
          </details>
        </div>
      </header>

      ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <main class="chat-card" aria-label="Stabilize AI check-in">
        <section id="conversation-surface" class="conversation-surface" data-view="compose">
          <section id="seo-intro" class="seo-intro" aria-labelledby="seo-heading">
            <p class="eyebrow">Floor-first support</p>
            <h1 id="seo-heading">A free AI check-in for overwhelmed moments</h1>
            <p>
              Stabilize helps adults protect immediate needs, reduce overload, and choose one
              manageable next step. It is not therapy, diagnosis, or emergency care.
            </p>
            <p class="seo-start-cue">Describe what is happening right now to begin.</p>
            <div class="landing-meta">
              <p class="landing-note">${escapeHtml(page.chat.supportNote)}</p>
              <details class="info-disclosure">
                <summary>${escapeHtml(page.chat.infoLabel)}</summary>
                <div class="info-popover">
                  <p>${escapeHtml(page.chat.infoDetails)}</p>
                </div>
              </details>
            </div>
          </section>

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
