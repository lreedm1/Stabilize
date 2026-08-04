function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderMemoryPage(options = {}) {
  const signedIn = options.signedIn === true;
  const googleSignInAvailable = options.googleSignInAvailable === true;
  const accountPanel = signedIn
    ? `<section id="memory-app" class="memory-app" data-signed-in="true">
        <div class="memory-status-card">
          <div>
            <p class="eyebrow">Account memory</p>
            <h2 id="memory-status-heading">Loading memory…</h2>
            <p id="memory-status-detail" class="memory-status-detail">
              Checking the context associated with this signed-in account.
            </p>
          </div>
          <label class="memory-toggle" for="memory-enabled">
            <input id="memory-enabled" type="checkbox" disabled />
            <span>Use memory</span>
          </label>
        </div>

        <p id="memory-notice" class="memory-notice" role="status" aria-live="polite"></p>

        <section class="memory-section" aria-labelledby="summary-heading">
          <div class="section-heading-row">
            <div>
              <p class="eyebrow">Rolling summary</p>
              <h2 id="summary-heading">What Stabilize currently remembers</h2>
            </div>
            <span id="memory-updated" class="memory-updated"></span>
          </div>
          <p class="section-explainer">
            This is the condensed account context used for continuity. Correct it directly when it is incomplete or wrong.
          </p>
          <label class="sr-only" for="memory-summary">Remembered summary</label>
          <textarea
            id="memory-summary"
            rows="9"
            maxlength="1000"
            placeholder="Nothing has been condensed yet."
            disabled
          ></textarea>
          <div class="memory-actions">
            <button id="save-memory-summary" class="primary-action" type="button" disabled>
              Save correction
            </button>
          </div>
        </section>

        <section class="memory-section" aria-labelledby="recent-heading">
          <div class="section-heading-row">
            <div>
              <p class="eyebrow">Recent buffer</p>
              <h2 id="recent-heading">Recent uncondensed context</h2>
            </div>
            <button id="clear-recent-memory" class="quiet-action" type="button" disabled>
              Clear recent context
            </button>
          </div>
          <p class="section-explainer">
            Up to eight recent user and assistant messages may wait here before condensation. Delete any entry that should not remain.
          </p>
          <div id="recent-memory-list" class="recent-memory-list" aria-live="polite"></div>
        </section>

        <section class="memory-section danger-zone" aria-labelledby="delete-heading">
          <p class="eyebrow">Delete</p>
          <h2 id="delete-heading">Delete all remembered context</h2>
          <p>
            This removes the rolling summary and recent-message buffer controlled by Stabilize. It cannot recall data already processed by infrastructure or AI providers.
          </p>
          <button id="delete-all-memory" class="danger-action" type="button" disabled>
            Delete all Stabilize memory
          </button>
        </section>
      </section>`
    : `<section class="signed-out-memory" data-signed-in="false">
        <h2>Sign in to manage account memory</h2>
        <p>
          Guest chats do not enter Stabilize account memory. Memory controls are available after signing in.
        </p>
        ${
          googleSignInAvailable
            ? '<a class="primary-link" href="/auth/google">Sign in with Google</a>'
            : '<p class="memory-notice">Google sign-in is not configured on this deployment.</p>'
        }
      </section>`;

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="View, correct, disable, or delete the account memory controlled by Stabilize." />
    <meta name="robots" content="noindex,nofollow" />
    <meta name="theme-color" content="#173f31" />
    <title>Memory controls — Stabilize</title>
    <link
      rel="preload"
      href="/fonts/lexend-latin-wght-normal.woff2"
      as="font"
      type="font/woff2"
      crossorigin
    />
    <link rel="stylesheet" href="/memory.css?v=20260804-memory-controls-1" />
  </head>
  <body>
    <header class="memory-header">
      <a class="memory-brand" href="/">Stabilize</a>
      <nav aria-label="Memory page navigation">
        <a href="/">Back to chat</a>
        <a href="/privacy.html">Privacy</a>
      </nav>
    </header>
    <main class="memory-shell">
      <p class="eyebrow">Signed-in controls</p>
      <h1>Memory controls</h1>
      <p class="lede">
        Review exactly what Stabilize can use for account continuity. Memory can be corrected, cleared, or switched off without ending the current browser session.
      </p>
      ${accountPanel}
    </main>
    <footer>
      <p>
        Private chat is separate: it bypasses Stabilize account memory for that browser-tab conversation. Provider processing still applies.
      </p>
    </footer>
    ${
      signedIn
        ? '<script type="module" src="/memory.js?v=20260804-memory-controls-1"></script>'
        : ""
    }
  </body>
</html>`;
}
