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
  const signedIn = options.signedIn === true;
  const googleSignInAvailable = options.googleSignInAvailable === true;
  const copyData = escapeHtml(JSON.stringify(client));
  const productCopyData = escapeHtml(
    JSON.stringify({
      signedIn,
      outcomeQuestion: "What would help next?",
      outcomeActions: [
        {
          label: "Make it smaller",
          prompt: "Make the practical next step smaller and easier to start.",
        },
        {
          label: "Help me start",
          prompt:
            "Help me begin the next step right now with one concrete first move.",
        },
      ],
    }),
  );
  const notice = String(options.authNotice || "").trim();
  const canonicalUrl = "https://stabilize.info/";
  const seoTitle = "Stabilize — Get One Clear Next Step";
  const seoDescription =
    "Free, floor-first AI support for overloaded moments. Describe what is happening and get one manageable next step.";
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
      : `<span class="menu-account-note">Chat without an account.</span>`;
  const headerAuthControl = signedIn
    ? `<span class="header-auth-state">${escapeHtml(page.auth.signedIn)}</span>`
    : googleSignInAvailable
      ? `<a class="google-sign-in header-google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : "";

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="description" content="${escapeHtml(seoDescription)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#173f31" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <meta name="apple-mobile-web-app-title" content="Stabilize" />
    <link rel="canonical" href="${canonicalUrl}" />
    <link rel="manifest" href="/manifest.webmanifest" />
    <link rel="icon" href="/icons/icon.svg" type="image/svg+xml" />
    <link rel="apple-touch-icon" href="/icons/icon.svg" />
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
    <link
      rel="preload"
      as="image"
      href="/scenes/mobile-golden-alpine-v3-1440.webp"
      imagesrcset="
        /scenes/mobile-golden-alpine-v3-720.webp 720w,
        /scenes/mobile-golden-alpine-v3-1080.webp 1080w,
        /scenes/mobile-golden-alpine-v3-1440.webp 1440w,
        /scenes/mobile-golden-alpine-v3-2160.webp 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link rel="stylesheet" href="/styles.css" />
    <link rel="stylesheet" href="/seo.css" />
    <link rel="stylesheet" href="/product.css" />
    <link rel="stylesheet" href="/experience.css?v=20260803-1" />
    <link rel="stylesheet" href="/photo-tuning.css?v=20260802-8" />
    <link rel="stylesheet" href="/mobile-woodland-loop.css?v=20260803-14" />
  </head>
  <body data-signed-in="${signedIn ? "true" : "false"}">
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
        media="(max-width: 980px) and (orientation: portrait)"
        type="image/webp"
        sizes="100vw"
        srcset="
          /scenes/mobile-golden-alpine-v3-720.webp 720w,
          /scenes/mobile-golden-alpine-v3-1080.webp 1080w,
          /scenes/mobile-golden-alpine-v3-1440.webp 1440w,
          /scenes/mobile-golden-alpine-v3-2160.webp 2160w
        "
      />
      <img
        id="photo-backdrop-image"
        src="/scenes/lake-valley-landscape-1280.webp"
        srcset="
          /scenes/lake-valley-landscape-1280.webp 1280w,
          /scenes/lake-valley-landscape-2560.webp 2560w,
          /scenes/lake-valley-landscape-3840.webp 3840w,
          /scenes/lake-valley-landscape-7680.webp 7680w
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
        <div class="brand-actions">
          <a class="site-name" href="/" aria-label="Stabilize home">${escapeHtml(page.header.name)}</a>
          <button id="new-chat-button" class="header-new-chat" type="button">New chat</button>
        </div>
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
                <a href="/about.html">About</a>
                <a href="/how-it-works.html">How it works</a>
                <a href="/floor-first.html">Floor-first approach</a>
                <a href="/safety.html">Safety and limits</a>
                <a href="/privacy.html">Privacy</a>
                <a href="/changelog.html">What changed</a>
                <a href="/sustainability.html">Sustainability</a>
              </nav>
              <section class="menu-product-controls" aria-label="Product controls">
                <button id="memory-button" type="button"${signedIn ? "" : " disabled"}>View or delete memory</button>
                <button id="background-mode-button" type="button" aria-pressed="false">Use still background</button>
                <button id="install-button" type="button" hidden>Install Stabilize</button>
                <p class="service-state"><span id="service-status-dot" aria-hidden="true"></span><span id="service-status">Checking service…</span></p>
              </section>
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
          <section id="seo-intro" class="seo-intro product-intro" aria-labelledby="seo-heading">
            <h1 id="seo-heading">Get unstuck.</h1>
            <p class="product-promise">Describe what is happening. Stabilize will help identify what matters now and one manageable next step.</p>
            <p class="product-example"><strong>Example:</strong> “I have three things due and cannot start.” Stabilize helps choose the first ten-minute action.</p>
            <ul class="trust-signals" aria-label="Important limits">
              <li>AI-generated support</li>
              <li>Fixed routing for urgent messages</li>
              <li>Not therapy or emergency care</li>
            </ul>
            <div class="landing-meta">
              <p class="privacy-signal">Guest chats are not remembered by Stabilize. This tab can restore the current thread.</p>
              <details class="info-disclosure">
                <summary>Privacy &amp; limits</summary>
                <div class="info-popover">
                  <p>Messages are processed by Cloudflare and OpenAI to provide replies. Signed-in memory is optional, condensed, viewable, editable, and deletable. Private chat does not read or write account memory. Do not enter passwords or financial account numbers. Adults 18+.</p>
                </div>
              </details>
            </div>
          </section>

          <div
            id="chat-log"
            class="chat-log"
            role="log"
            aria-label="Conversation"
            aria-live="polite"
            aria-relevant="additions text"
            hidden
          ></div>

          <div class="composer-dock">
            <div class="composer-tools" aria-label="Chat options">
              <button id="microphone-button" class="composer-tool" type="button" aria-pressed="false" hidden>Voice</button>
              <button id="private-toggle" class="composer-tool" type="button" aria-pressed="false">Private off</button>
              <span id="composer-status" class="composer-status" role="status" aria-live="polite"></span>
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
              <button id="stop-button" type="button" hidden>Stop</button>
            </form>
          </div>
        </section>
      </main>
    </div>

    <dialog id="memory-dialog" class="memory-dialog" aria-labelledby="memory-dialog-title">
      <form method="dialog" class="memory-dialog-close-form">
        <button class="memory-dialog-close" value="close" aria-label="Close memory settings">×</button>
      </form>
      <h2 id="memory-dialog-title">Your Stabilize memory</h2>
      <p class="memory-intro">This is condensed context used between signed-in visits. Private chats do not use it.</p>
      <p id="memory-status" class="memory-status" role="status" aria-live="polite"></p>
      <label for="memory-summary">Remembered summary</label>
      <textarea id="memory-summary" rows="8" maxlength="1000" placeholder="Nothing remembered yet."></textarea>
      <section class="memory-recent-section" aria-labelledby="memory-recent-title">
        <h3 id="memory-recent-title">Recent context awaiting condensation</h3>
        <div id="memory-recent" class="memory-recent"></div>
      </section>
      <div class="memory-actions">
        <button id="memory-save-button" type="button">Save correction</button>
        <button id="memory-delete-button" class="danger-button" type="button">Delete all memory</button>
      </div>
    </dialog>

    <template id="client-copy">${copyData}</template>
    <template id="product-copy">${productCopyData}</template>
    <script src="/mobile-quality.js?v=20260802-8"></script>
    <script type="module" src="/app.js?v=20260803-product-table-stakes-1"></script>
  </body>
</html>`;
}
