import { COPY } from "./copy.js";

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const CONTINUITY_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

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
  const requestedContinuity = options.continuity;
  const continuity =
    signedIn &&
    requestedContinuity?.mode === "account" &&
    CONTINUITY_TOKEN_PATTERN.test(String(requestedContinuity.token || ""))
      ? { mode: "account", token: String(requestedContinuity.token) }
      : { mode: "guest", token: null };
  const continuityData = escapeHtml(JSON.stringify(continuity));
  const memoryDeletionData = escapeHtml(
    JSON.stringify({ confirmed: options.memoryDeletionConfirmed === true }),
  );
  const googleSignInAvailable = options.googleSignInAvailable === true;
  const notice = String(options.authNotice || "").trim();
  const emergencyBoundary = /not emergency care/i.test(page.chat.supportNote)
    ? "Not emergency care."
    : page.chat.supportNote;
  const continuitySignal =
    continuity.mode === "account"
      ? "Signed-in context can be remembered by Stabilize for up to 30 days."
      : "Guest messages aren't saved as server memory; this tab keeps the latest reply for up to 24 hours.";
  const canonicalUrl = "https://stabilize.info/";
  const seoTitle = "Stabilize — Get One Clear Next Step";
  const seoDescription =
    "Free, floor-first AI support for overloaded moments. Describe what is happening and get one clear next step.";
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
    ? `<div class="auth-session">
          <span class="auth-state">${escapeHtml(page.auth.signedIn)}</span>
          <form action="/account/memory/delete" method="post">
            <input type="hidden" name="continuity" value="${escapeHtml(continuity.token || "")}" />
            <button class="auth-link memory-delete-link" type="submit">${escapeHtml(page.auth.forgetMemory)}</button>
          </form>
          <form action="/auth/logout" method="post">
            <button class="auth-link" type="submit">${escapeHtml(page.auth.signOut)}</button>
          </form>
        </div>`
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
    <link rel="stylesheet" href="/photo-tuning.css?v=20260802-8" />
    <link rel="stylesheet" href="/mobile-woodland-loop.css?v=20260803-14" />
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
                <a href="/about.html">About</a>
                <a href="/sustainability.html">Sustainability</a>
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

      <p
        id="client-notice"
        class="auth-notice"
        role="status"
        data-kind="server"
        ${notice ? "" : "hidden"}
      >${escapeHtml(notice)}</p>

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
            <p class="product-promise">Tell Stabilize what is happening. Get one clear next step.</p>

            <div
              class="landing-meta"
              data-support-note="${escapeHtml(page.chat.supportNote)}"
            >
              <p class="privacy-signal">${escapeHtml(continuitySignal)} ${escapeHtml(emergencyBoundary)}</p>
              <details class="info-disclosure">
                <summary>${escapeHtml(page.chat.infoLabel)}</summary>
                <div class="info-popover">
                  <p>${escapeHtml(page.chat.infoDetails)}</p>
                </div>
              </details>
            </div>
          </section>

          <div class="composer-dock">
            <form id="chat-form" class="chat-form" method="post" action="/api/chat">
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
    <template id="continuity-state">${continuityData}</template>
    <template id="memory-deletion-state">${memoryDeletionData}</template>
    <script src="/mobile-quality.js?v=20260802-8"></script>
    <script type="module" src="/app.js?v=20260803-continuity-4"></script>
  </body>
</html>`;
}
