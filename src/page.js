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
  const productCopyData = escapeHtml(
    JSON.stringify({
      outcomeQuestion: "What would help next?",
      outcomeActions: [
        {
          label: "Make it smaller",
          prompt: "Make the practical next step smaller and easier to start.",
        },
        {
          label: "Another option",
          prompt: "Give me a different practical next step.",
        },
        {
          label: "Help me start now",
          prompt:
            "Help me begin the next step right now with one concrete first move.",
        },
      ],
    }),
  );
  const signedIn = options.signedIn === true;
  const googleSignInAvailable = options.googleSignInAvailable === true;
  const notice = String(options.authNotice || "").trim();
  const emergencyBoundary = /not emergency care/i.test(page.chat.supportNote)
    ? "Not emergency care."
    : page.chat.supportNote;
  const canonicalUrl = "https://stabilize.info/";
  const seoTitle = "Stabilize — One Safe, Practical Next Step";
  const seoDescription = page.promise;
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: "Stabilize",
    url: canonicalUrl,
    applicationCategory: "LifestyleApplication",
    operatingSystem: "Any",
    isAccessibleForFree: true,
    description: seoDescription,
  }).replaceAll("<", "\\u003c");
  const authControl = signedIn
    ? `<div class="auth-account-controls">
          <form class="auth-session" action="/auth/logout" method="post">
            <span class="auth-state">${escapeHtml(page.auth.signedIn)}</span>
            <button class="auth-link" type="submit">${escapeHtml(page.auth.signOut)}</button>
          </form>
          <button
            id="delete-memory-button"
            class="auth-link memory-delete-button"
            type="button"
            aria-describedby="memory-delete-status"
          >${escapeHtml(client.deleteMemoryButton)}</button>
          <p
            id="memory-delete-status"
            class="memory-delete-status"
            role="status"
            aria-live="polite"
            hidden
          ></p>
        </div>`
    : googleSignInAvailable
      ? `<a class="google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : `<span class="menu-account-note">Chat without an account.</span>`;
  const headerAuthControl = signedIn
    ? `<span class="header-auth-state">${escapeHtml(page.auth.signedIn)}</span>`
    : googleSignInAvailable
      ? `<a class="google-sign-in header-google-sign-in" href="/auth/google">${escapeHtml(page.auth.signIn)}</a>`
      : "";
  const privateChatControl = signedIn
    ? `<div class="private-chat-control">
          <button
            id="private-chat-button"
            class="private-chat-button"
            type="button"
            aria-pressed="false"
          >${escapeHtml(client.privateChatButton)}</button>
          <p class="private-chat-menu-note">${escapeHtml(client.privateChatMenuNote)}</p>
        </div>`
    : "";
  const privateChatStatus = signedIn
    ? `<p id="private-chat-status" class="private-chat-status" role="status" hidden>
          ${escapeHtml(client.privateChatStatus)}
        </p>`
    : "";
  const landingPrivacySignal = signedIn
    ? "Signed-in chats use bounded 30-day memory. Delete it anytime."
    : "Guest chats keep the full conversation in this tab.";

  return `<!doctype html>
<html lang="${escapeHtml(page.language)}" data-signed-in="${signedIn}">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="${escapeHtml(seoDescription)}" />
    <meta name="robots" content="index,follow,max-image-preview:large" />
    <meta name="theme-color" content="#173f31" />
    <link rel="shortcut icon" href="/stabilize-tab-20260805.ico" type="image/x-icon" />
    <link rel="icon" href="/stabilize-tab-20260805.ico" type="image/x-icon" sizes="16x16 32x32 48x48" />
    <link rel="icon" href="/stabilize-tab-20260805-16.png" type="image/png" sizes="16x16" />
    <link rel="icon" href="/stabilize-tab-20260805-32.png" type="image/png" sizes="32x32" />
    <link rel="apple-touch-icon" href="/stabilize-app-20260805-180.png" sizes="180x180" />
    <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#173f31" />
    <link rel="manifest" href="/site.webmanifest?v=20260805-8" />
    <meta name="application-name" content="STABILIZE" />
    <meta name="apple-mobile-web-app-title" content="STABILIZE" />
    <script src="/favicon-refresh.js?v=20260805-8" defer></script>

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
    <link
      rel="preload"
      as="image"
      href="/scenes/mobile-forest-stream-v14-retina-2160.webp"
      imagesrcset="
        /scenes/mobile-forest-stream-v14-retina-2160.webp 2160w
      "
      imagesizes="100vw"
      media="(max-width: 980px) and (orientation: portrait)"
      type="image/webp"
      fetchpriority="high"
    />
    <link rel="stylesheet" href="/styles.css?v=20260807-priority-latency-1" />
    <link rel="stylesheet" href="/seo.css?v=20260808-memory-controls-1" />
    <link rel="stylesheet" href="/product.css?v=20260804-compact-outcomes-2" />
    <link rel="stylesheet" href="/main-box-white.css?v=20260805-2" />
    <link rel="stylesheet" href="/photo-tuning.css?v=20260802-8" />
    <link rel="stylesheet" href="/mobile-woodland-loop.css?v=20260809-mobile-video-v15-visible-autoplay-1" />
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
      <!-- Retired responsive references: lake-valley-portrait-720.webp 720w; lake-valley-portrait-2160.webp 2160w -->
      <source
        media="(max-width: 980px) and (orientation: portrait)"
        type="image/webp"
        sizes="100vw"
        srcset="\n          /scenes/mobile-forest-stream-v14-retina-2160.webp 2160w\n        "
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
    <!-- retina-mobile-video-v15-start -->
    <video
      id="mobile-background-video"
      class="mobile-background-video"
      src="/scenes/mobile-forest-stream-video-v14-retina-2160.mp4"
      autoplay
      muted
      loop
      playsinline
      webkit-playsinline
      preload="auto"
      poster="/scenes/mobile-forest-stream-v14-retina-2160.webp"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    ></video>
    <script src="/mobile-quality.js?v=20260809-mobile-video-v15-visible-autoplay-1"></script>
    <!-- retina-mobile-video-v15-end -->
    <div class="page-shell">
      <header class="site-header">
        <nav class="header-navigation" aria-label="Primary navigation">
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
                <a href="/">Home</a>
                <a href="/about.html">About</a>
                <a href="/sustainability.html">Sustainability</a>
                <a href="/how-it-works.html">How it works</a>
                <a href="/floor-first.html">Floor-first approach</a>
                <a href="/safety.html">Safety and limits</a>
                <a href="/privacy.html">Privacy</a>
              </nav>
              <details class="menu-info-disclosure">
                <summary>${escapeHtml(page.chat.infoLabel)}</summary>
                <p>${escapeHtml(page.chat.infoDetails)}</p>
              </details>
              <div class="menu-account" aria-label="${escapeHtml(page.auth.label)}">
                ${authControl}
              </div>
              <a class="menu-admin-link" href="/admin/impact" aria-label="Open admin dashboard" rel="nofollow">Admin</a>
            </div>
          </details>
        </nav>
        <div class="header-actions">
          ${headerAuthControl ? `<nav class="auth-actions header-auth-actions" aria-label="${escapeHtml(page.auth.label)}">${headerAuthControl}</nav>` : ""}
        </div>
      </header>

      <div class="chat-action-proxies" hidden aria-hidden="true">
        <button
          id="new-conversation-button"
          class="new-conversation-button"
          type="button"
        >${escapeHtml(page.chat.newConversationButton)}</button>
        ${privateChatControl}
      </div>

      ${notice ? `<p class="auth-notice" role="status">${escapeHtml(notice)}</p>` : ""}

      <main class="chat-card" aria-label="Stabilize AI check-in">
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

          <section id="seo-intro" class="seo-intro product-intro" aria-labelledby="seo-heading">
            <h1 id="seo-heading">Get unstuck.</h1>
            <p class="product-promise">${escapeHtml(page.promise)}</p>

            <div
              class="landing-meta"
              data-support-note="${escapeHtml(page.chat.supportNote)}"
            >
              <p class="privacy-signal">${escapeHtml(landingPrivacySignal)} ${escapeHtml(emergencyBoundary)}</p>
            </div>
          </section>

          <div class="composer-dock">
            ${privateChatStatus}
            <section
              id="outcome-tray"
              class="outcome-tray"
              aria-live="polite"
              hidden
            ></section>
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
    <template id="product-copy">${productCopyData}</template>
    <!-- Legacy generator marker: 20260808-guest-summary-1 -->
    <script type="module" src="/app.js?v=20260808-full-guest-thread-1"></script>
    <script type="module" src="/reasoning-choice.js?v=20260807-instant-thinking-2-fastest-1"></script>
  </body>
</html>`;
}
