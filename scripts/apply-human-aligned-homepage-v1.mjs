import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const MARKER = "human-aligned-homepage-v1";
const SCRIPT_PATH = "scripts/apply-human-aligned-homepage-v1.mjs";
const OLD_PROMISE = [
  "Stabilize helps you turn an overloaded moment into",
  " one safe, practical next step.",
].join("");
const NEW_PROMISE =
  "Stabilize adapts to your capacity, keeps memory bounded and deletable, and helps you move from conversation to real-world action.";
const NEW_HEADLINE =
  "A personal AI that helps you steady what matters and take the next useful step.";
const NEW_PLACEHOLDER = "Start with what needs attention";
const FINALIZER_COMMAND = `node ${SCRIPT_PATH}`;

function requireText(source, expected, label) {
  if (!source.includes(expected)) {
    throw new Error(`Homepage positioning update could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

async function writeIfChanged(path, content) {
  let before = "";
  try {
    before = await readFile(path, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  if (before !== content) await writeFile(path, content);
}

function trackedFilesContaining(value) {
  try {
    const output = execFileSync(
      "git",
      ["grep", "-l", "-F", "--", value],
      { encoding: "utf8" },
    ).trim();
    return output ? output.split("\n") : [];
  } catch (error) {
    if (error?.status === 1) return [];
    throw error;
  }
}

for (const path of trackedFilesContaining(OLD_PROMISE)) {
  if (path === SCRIPT_PATH) continue;
  await update(path, (source) => source.replaceAll(OLD_PROMISE, NEW_PROMISE));
}

await update("src/copy.js", (source) => {
  let text = source;
  text = text.replace(
    '      inputPlaceholder: "What is happening?",',
    `      inputPlaceholder: ${JSON.stringify(NEW_PLACEHOLDER)},`,
  );
  requireText(text, NEW_PROMISE, "the canonical product promise");
  requireText(text, `inputPlaceholder: ${JSON.stringify(NEW_PLACEHOLDER)}`, "the new composer prompt");
  return text;
});

await update("scripts/compact-header-and-menu-info.mjs", (source) =>
  source.replaceAll('"What is happening?"', JSON.stringify(NEW_PLACEHOLDER)),
);

const OLD_INTRO = `          <section id="seo-intro" class="seo-intro product-intro" aria-labelledby="seo-heading">
            <h1 id="seo-heading">Get unstuck.</h1>
            <p class="product-promise">\${escapeHtml(page.promise)}</p>

            <div
              class="landing-meta"
              data-support-note="\${escapeHtml(page.chat.supportNote)}"
            >
              <p class="privacy-signal">\${escapeHtml(landingPrivacySignal)} \${escapeHtml(emergencyBoundary)}</p>
            </div>
          </section>`;

const NEW_INTRO = `          <section id="seo-intro" class="seo-intro product-intro landing-content" aria-labelledby="seo-heading">
            <!-- ${MARKER} -->
            <div class="landing-hero">
              <p class="landing-kicker">A personal AI for real life</p>
              <h1 id="seo-heading">${NEW_HEADLINE}</h1>
              <p class="product-promise">\${escapeHtml(page.promise)}</p>

              <div class="landing-trust-strip" aria-label="Stabilize principles">
                <span>Bounded memory</span>
                <span class="landing-trust-separator" aria-hidden="true">·</span>
                <span>User-chosen direction</span>
                <span class="landing-trust-separator" aria-hidden="true">·</span>
                <span>Human support stays central</span>
              </div>

              <div
                class="landing-meta"
                data-support-note="\${escapeHtml(page.chat.supportNote)}"
              >
                <p class="privacy-signal">\${escapeHtml(landingPrivacySignal)} \${escapeHtml(emergencyBoundary)}</p>
              </div>

              <a class="landing-learn-more" href="#why-stabilize">
                See why Stabilize is different <span aria-hidden="true">↓</span>
              </a>
            </div>

            <section id="why-stabilize" class="landing-section landing-why" aria-labelledby="why-stabilize-heading">
              <p class="landing-section-label">Why Stabilize?</p>
              <h2 id="why-stabilize-heading">Built for the moment between knowing and doing.</h2>
              <div class="landing-card-grid">
                <article class="landing-card">
                  <h3>Built around your capacity</h3>
                  <p>Stabilize changes how it responds based on what you can reasonably handle right now. When you have capacity, it can think deeply with you. When you are overloaded, it reduces the problem to one manageable action.</p>
                </article>
                <article class="landing-card">
                  <h3>Memory with boundaries</h3>
                  <p>Signed-in chats use condensed context for up to 30 days. You can delete it at any time, and Private chat turns Stabilize memory off.</p>
                </article>
                <article class="landing-card">
                  <h3>Designed for life outside the chat</h3>
                  <p>Success is not a longer conversation. It is a completed task, a protected need, a better decision, or a connection to the right person.</p>
                </article>
              </div>
            </section>

            <section class="landing-section landing-how" aria-labelledby="landing-how-heading">
              <p class="landing-section-label">How it works</p>
              <h2 id="landing-how-heading">From overload to one useful action.</h2>
              <ol class="landing-step-grid">
                <li>
                  <span class="landing-step-number" aria-hidden="true">1</span>
                  <div>
                    <h3>Understand the situation</h3>
                    <p>Stabilize separates the immediate request from assumptions, constraints, and urgency.</p>
                  </div>
                </li>
                <li>
                  <span class="landing-step-number" aria-hidden="true">2</span>
                  <div>
                    <h3>Match the response to capacity</h3>
                    <p>The response becomes lighter or more detailed depending on what you can handle.</p>
                  </div>
                </li>
                <li>
                  <span class="landing-step-number" aria-hidden="true">3</span>
                  <div>
                    <h3>Choose one useful action</h3>
                    <p>Stabilize favors specific, reversible steps over sprawling plans.</p>
                  </div>
                </li>
                <li>
                  <span class="landing-step-number" aria-hidden="true">4</span>
                  <div>
                    <h3>Check what actually happened</h3>
                    <p>You can say what worked, what got in the way, or whether the next step needs to be smaller.</p>
                  </div>
                </li>
              </ol>
            </section>
          </section>`;

await update("src/page.js", (source) => {
  let text = source;

  if (!text.includes(MARKER)) {
    requireText(text, OLD_INTRO, "the existing homepage introduction");
    text = text.replace(OLD_INTRO, NEW_INTRO);
  }

  const stylesheetAnchor =
    '    <link rel="stylesheet" href="/photo-tuning.css?v=20260802-8" />';
  const stylesheetLink =
    '    <link rel="stylesheet" href="/landing.css?v=20260813-human-aligned-1" />';
  if (!text.includes(stylesheetLink)) {
    requireText(text, stylesheetAnchor, "the homepage stylesheet insertion point");
    text = text.replace(stylesheetAnchor, `${stylesheetAnchor}\n${stylesheetLink}`);
  }

  requireText(text, MARKER, "the homepage marker");
  requireText(text, NEW_HEADLINE, "the new homepage headline");
  requireText(text, "Built around your capacity", "the Why Stabilize section");
  requireText(text, "Understand the situation", "the How it works section");
  return text;
});

await update(".github/workflows/verify-search-indexing.yml", (source) =>
  source.replace(
    `grep -Fq '<h1 id="seo-heading">Get unstuck.</h1>' "$workdir/home.html" || ready=false`,
    `grep -Fq '<h1 id="seo-heading">${NEW_HEADLINE}</h1>' "$workdir/home.html" || ready=false`,
  ),
);

await update("test/header-menu-copy.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    '/placeholder="What is happening\\?"/',
    `/placeholder="${NEW_PLACEHOLDER}"/`,
  );
  requireText(text, NEW_PLACEHOLDER, "the homepage placeholder regression");
  return text;
});

await update("test/product.test.mjs", (source) => {
  let text = source;
  text = text.replace(
    'test("the homepage gives a short product promise", async () => {',
    'test("the homepage explains its differentiated product promise", async () => {',
  );
  text = text.replace(
    "  assert.match(pageSource, /Get unstuck\\./);",
    `  assert.match(pageSource, /A personal AI that helps you steady what matters and take the next useful step\\./);`,
  );

  const assertionAnchor = "  assert.match(pageSource, /page\\.promise/);\n";
  const addedAssertions = `  assert.match(pageSource, /page\\.promise/);
  assert.match(pageSource, /Bounded memory/);
  assert.match(pageSource, /User-chosen direction/);
  assert.match(pageSource, /Human support stays central/);
  assert.match(pageSource, /Built around your capacity/);
  assert.match(pageSource, /Memory with boundaries/);
  assert.match(pageSource, /Designed for life outside the chat/);
  assert.match(pageSource, /Understand the situation/);
  assert.match(pageSource, /Match the response to capacity/);
  assert.match(pageSource, /Choose one useful action/);
  assert.match(pageSource, /Check what actually happened/);
  assert.match(
    pageSource,
    /href="\\/landing\\.css\\?v=20260813-human-aligned-1"/,
  );
`;
  if (!text.includes("Human support stays central")) {
    requireText(text, assertionAnchor, "the product test assertion insertion point");
    text = text.replace(assertionAnchor, addedAssertions);
  }

  requireText(text, "A personal AI that helps you steady what matters", "the headline product regression");
  requireText(text, "Human support stays central", "the trust-strip regression");
  return text;
});

await update("package.json", (source) => {
  const config = JSON.parse(source);
  const current = String(config.scripts?.["apply:prompt-policy"] || "");
  const steps = current.split(" && ").filter(Boolean);
  if (!steps.includes(FINALIZER_COMMAND)) steps.push(FINALIZER_COMMAND);
  config.scripts["apply:prompt-policy"] = steps.join(" && ");
  return `${JSON.stringify(config, null, 2)}\n`;
});

await update("test/composer-placeholder-alignment.test.mjs", (source) => {
  let text = source;
  const oldEnding = 'node scripts/embed-favicon-fallback.mjs",';
  const newEnding = `node scripts/embed-favicon-fallback.mjs && ${FINALIZER_COMMAND}",`;
  if (!text.includes(FINALIZER_COMMAND)) {
    requireText(text, oldEnding, "the prompt-policy regression ending");
    text = text.replace(oldEnding, newEnding);
  }
  return text;
});

const LANDING_CSS = `/* ${MARKER}: differentiated homepage positioning */
.seo-intro.landing-content {
  width: min(980px, 100%);
  max-width: 980px;
  max-height: 100%;
  margin: 0 auto;
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 1px 3px 22px;
  text-align: left;
  text-shadow: none;
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
  overscroll-behavior: contain;
  scrollbar-color: rgba(255, 255, 255, 0.42) transparent;
  scrollbar-width: thin;
  scroll-behavior: smooth;
  scroll-padding-top: 12px;
  -webkit-overflow-scrolling: touch;
}

.conversation-surface[data-view="compose"] .seo-intro.landing-content {
  align-self: stretch;
  justify-self: stretch;
  margin: 0 auto;
}

.seo-intro.landing-content::-webkit-scrollbar {
  width: 8px;
}

.seo-intro.landing-content::-webkit-scrollbar-track {
  background: transparent;
}

.seo-intro.landing-content::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.42);
  background-clip: padding-box;
}

.landing-hero,
.landing-section {
  border: 1px solid rgba(255, 255, 255, 0.46);
  border-radius: 22px;
  background: rgba(35, 43, 40, 0.7);
  box-shadow: 0 12px 34px rgba(4, 13, 10, 0.26);
  color: #fffef8;
  -webkit-backdrop-filter: blur(12px) saturate(0.82);
  backdrop-filter: blur(12px) saturate(0.82);
}

.landing-hero {
  display: flex;
  min-height: clamp(340px, 56vh, 500px);
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: clamp(24px, 5vw, 54px);
  text-align: center;
}

.seo-intro.landing-content .landing-kicker,
.seo-intro.landing-content .landing-section-label {
  max-width: none;
  margin: 0;
  color: rgba(236, 248, 239, 0.9);
  font-size: 0.72rem;
  font-weight: 780;
  letter-spacing: 0.12em;
  line-height: 1.3;
  text-transform: uppercase;
  text-shadow: 0 2px 8px rgba(3, 20, 14, 0.78);
}

.seo-intro.landing-content h1 {
  max-width: 23ch;
  margin: 10px auto 14px;
  color: #fffef8;
  font-size: clamp(2rem, 4.8vw, 3.55rem);
  font-weight: 720;
  letter-spacing: -0.04em;
  line-height: 1.04;
  text-wrap: balance;
  text-shadow: 0 3px 14px rgba(3, 20, 14, 0.84);
}

.seo-intro.landing-content .product-promise {
  max-width: 62ch;
  margin: 0 auto;
  color: rgba(255, 254, 248, 0.94);
  font-size: clamp(0.96rem, 1.8vw, 1.12rem);
  line-height: 1.55;
  text-wrap: pretty;
  text-shadow: 0 2px 8px rgba(3, 20, 14, 0.78);
}

.landing-trust-strip {
  display: flex;
  max-width: 760px;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 7px 11px;
  margin: 20px auto 0;
  color: rgba(255, 254, 248, 0.94);
  font-size: clamp(0.74rem, 1.4vw, 0.86rem);
  font-weight: 700;
  line-height: 1.35;
  text-shadow: 0 2px 8px rgba(3, 20, 14, 0.78);
}

.landing-trust-separator {
  color: rgba(198, 231, 211, 0.82);
}

.seo-intro.landing-content .landing-meta {
  max-width: 62ch;
  margin: 16px auto 0;
  border-top-color: rgba(255, 255, 255, 0.18);
  padding-top: 11px;
}

.seo-intro.landing-content .privacy-signal {
  max-width: none;
  color: rgba(241, 247, 242, 0.82);
  font-size: 0.7rem;
  font-weight: 630;
  line-height: 1.45;
  text-shadow: 0 2px 7px rgba(3, 20, 14, 0.78);
}

.landing-learn-more {
  display: inline-flex;
  min-height: 38px;
  align-items: center;
  justify-content: center;
  gap: 7px;
  margin-top: 19px;
  border: 1px solid rgba(255, 255, 255, 0.42);
  border-radius: 999px;
  background: rgba(255, 255, 252, 0.1);
  color: #fffef8;
  padding: 8px 14px;
  font-size: 0.75rem;
  font-weight: 720;
  line-height: 1.2;
  text-decoration: none;
  text-shadow: 0 2px 7px rgba(3, 20, 14, 0.8);
}

.landing-learn-more:hover,
.landing-learn-more:focus-visible {
  background: rgba(255, 255, 252, 0.2);
}

.landing-section {
  margin-top: 14px;
  padding: clamp(22px, 4vw, 38px);
}

.seo-intro.landing-content h2 {
  max-width: 30ch;
  margin: 8px 0 0;
  color: #fffef8;
  font-size: clamp(1.45rem, 3vw, 2.25rem);
  font-weight: 710;
  letter-spacing: -0.035em;
  line-height: 1.12;
  text-wrap: balance;
  text-shadow: 0 2px 10px rgba(3, 20, 14, 0.8);
}

.landing-card-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 22px;
}

.landing-card {
  min-width: 0;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  background: rgba(255, 255, 252, 0.08);
  padding: 18px;
}

.seo-intro.landing-content .landing-card h3,
.seo-intro.landing-content .landing-step-grid h3 {
  margin: 0;
  color: #fffef8;
  font-size: 0.96rem;
  font-weight: 730;
  letter-spacing: -0.012em;
  line-height: 1.3;
  text-shadow: 0 2px 8px rgba(3, 20, 14, 0.74);
}

.seo-intro.landing-content .landing-card p,
.seo-intro.landing-content .landing-step-grid p {
  max-width: none;
  margin: 9px 0 0;
  color: rgba(247, 250, 247, 0.84);
  font-size: 0.78rem;
  line-height: 1.55;
  text-align: left;
  text-shadow: 0 2px 7px rgba(3, 20, 14, 0.72);
}

.landing-step-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 12px;
  margin: 22px 0 0;
  padding: 0;
  list-style: none;
}

.landing-step-grid li {
  display: grid;
  min-width: 0;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: start;
  gap: 12px;
  border: 1px solid rgba(255, 255, 255, 0.2);
  border-radius: 16px;
  background: rgba(255, 255, 252, 0.08);
  padding: 17px;
}

.landing-step-number {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border: 1px solid rgba(214, 241, 224, 0.48);
  border-radius: 50%;
  background: rgba(229, 240, 233, 0.14);
  color: #effaf2;
  font-size: 0.76rem;
  font-weight: 780;
  line-height: 1;
  text-shadow: 0 1px 5px rgba(3, 20, 14, 0.7);
}

@media (max-width: 760px) {
  .seo-intro.landing-content {
    width: min(620px, 100%);
    padding-inline: 1px;
  }

  .landing-hero {
    min-height: clamp(330px, 54vh, 460px);
    border-radius: 18px;
    padding: 24px 18px;
  }

  .seo-intro.landing-content h1 {
    max-width: 21ch;
    font-size: clamp(1.78rem, 8vw, 2.75rem);
  }

  .landing-section {
    border-radius: 18px;
    padding: 22px 17px;
  }

  .landing-card-grid,
  .landing-step-grid {
    grid-template-columns: 1fr;
  }

  .landing-card-grid,
  .landing-step-grid {
    margin-top: 18px;
  }

  .landing-trust-strip {
    gap: 6px 8px;
  }
}

@media (max-width: 430px) {
  .landing-trust-separator {
    display: none;
  }

  .landing-trust-strip {
    display: grid;
    gap: 6px;
  }

  .landing-trust-strip span:not(.landing-trust-separator) {
    display: block;
  }

  .landing-step-grid li {
    padding: 15px;
  }
}

@media (max-height: 650px) {
  .landing-hero {
    min-height: auto;
    padding-block: 18px;
  }

  .landing-trust-strip {
    margin-top: 12px;
  }

  .landing-learn-more {
    display: none;
  }
}

@media (prefers-reduced-motion: reduce) {
  .seo-intro.landing-content {
    scroll-behavior: auto;
  }
}
`;

await writeIfChanged("public/landing.css", LANDING_CSS);

console.log("Applied the human-aligned homepage positioning, differentiation cards, and four-step flow.");
