import { readFile, writeFile } from "node:fs/promises";

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Home and model-menu finalization could not find ${label}`);
  }
}

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after);
}

await update("src/page.js", (source) => {
  let text = source;
  const menuLinksAnchor =
    '              <nav class="menu-links" aria-label="Site pages">\n';
  const homeLink = '                <a href="/">Home</a>\n';

  if (!text.includes(homeLink.trim())) {
    requireText(text, menuLinksAnchor, "the site-page menu");
    text = text.replace(menuLinksAnchor, menuLinksAnchor + homeLink);
  }

  const standaloneHomePattern =
    /\n\s*<a class="home-button" href="\/" aria-label="Home">[\s\S]*?<\/a>/;
  if (standaloneHomePattern.test(text)) {
    text = text.replace(standaloneHomePattern, "");
  } else if (text.includes('class="home-button"')) {
    throw new Error(
      "Home and model-menu finalization could not remove the standalone Home button",
    );
  }

  const proxyMarker = 'class="chat-action-proxies"';
  const newConversationButtonPattern =
    /\n\s*<button\s+id="new-conversation-button"\s+class="new-conversation-button"\s+type="button"\s*>\$\{escapeHtml\(page\.chat\.newConversationButton\)\}<\/button>/;
  const privateChatMenuPattern = /\n\s*\$\{privateChatControl\}/;

  if (!text.includes(proxyMarker)) {
    if (!newConversationButtonPattern.test(text)) {
      throw new Error("The New conversation menu button could not be relocated");
    }
    if (!privateChatMenuPattern.test(text)) {
      throw new Error("The Private chat menu control could not be relocated");
    }

    text = text.replace(newConversationButtonPattern, "");
    text = text.replace(privateChatMenuPattern, "");

    const headerAnchor = "      </header>\n\n";
    requireText(text, headerAnchor, "the header closing anchor");
    const proxyMarkup = `      </header>

      <div class="chat-action-proxies" hidden aria-hidden="true">
        <button
          id="new-conversation-button"
          class="new-conversation-button"
          type="button"
        >\${escapeHtml(page.chat.newConversationButton)}</button>
        \${privateChatControl}
      </div>

`;
    text = text.replace(headerAnchor, proxyMarkup);
  }

  const menuPanelStart = text.indexOf('<div class="menu-panel">');
  const menuPanelEnd = text.indexOf(
    "\n            </div>\n          </details>",
    menuPanelStart,
  );
  if (menuPanelStart < 0 || menuPanelEnd <= menuPanelStart) {
    throw new Error("The hamburger-menu panel could not be inspected");
  }
  const menuPanel = text.slice(menuPanelStart, menuPanelEnd);
  if (
    menuPanel.includes('id="new-conversation-button"') ||
    menuPanel.includes("${privateChatControl}")
  ) {
    throw new Error("Chat actions remain inside the hamburger menu");
  }

  const proxyStart = text.indexOf('<div class="chat-action-proxies"');
  const proxyEnd = text.indexOf("\n      </div>", proxyStart);
  if (proxyStart < 0 || proxyEnd <= proxyStart) {
    throw new Error("The hidden chat-action proxy container is missing");
  }
  const proxy = text.slice(proxyStart, proxyEnd);
  requireText(proxy, 'id="new-conversation-button"', "the hidden new-chat proxy");
  requireText(proxy, "${privateChatControl}", "the hidden private-chat proxy");

  const homeIndex = text.indexOf('<a href="/">Home</a>');
  const aboutIndex = text.indexOf('<a href="/about.html">About</a>');
  if (homeIndex < 0 || aboutIndex < 0 || homeIndex > aboutIndex) {
    throw new Error("Home must be the first site-page menu link");
  }

  return text;
});

await update("public/seo.css", (source) => {
  let text = source;

  const desktopHomeStyles =
    /\n\.home-button \{[\s\S]*?\n\.home-icon \{[\s\S]*?\n\}\n/;
  if (desktopHomeStyles.test(text)) {
    text = text.replace(desktopHomeStyles, "\n");
  }

  const mobileHomeStyles =
    /  \.menu-toggle,\n  \.home-button \{[\s\S]*?\n  \.home-icon \{[\s\S]*?\n  \}\n/;
  if (mobileHomeStyles.test(text)) {
    text = text.replace(
      mobileHomeStyles,
      "  .menu-toggle {\n    width: 38px;\n    height: 38px;\n  }\n",
    );
  }

  if (text.includes(".home-button") || text.includes(".home-icon")) {
    throw new Error("Standalone Home-button styles remain");
  }

  return text;
});

await update("src/paid-worker.js", (source) => {
  let text = source;
  const menuMarkupCall =
    /  const markup = billingMenuMarkup\(\{[\s\S]*?\n  \}\);\n(?=  const composerModelPicker = composerModelPickerMarkup\()/;

  if (menuMarkupCall.test(text)) {
    text = text.replace(menuMarkupCall, '  const markup = "";\n');
  } else {
    requireText(
      text,
      '  const markup = "";\n',
      "the disabled hamburger-menu model markup",
    );
  }

  const blockSavedNoticePattern =
    /\n\s*if \(url\.searchParams\.get\("model"\) === "saved"\) \{\s*return "Your AI model choice was saved\.";\s*\}/;
  const inlineSavedNoticePattern =
    /\n\s*if \(url\.searchParams\.get\("model"\) === "saved"\) return "Your AI model choice was saved\.";/;
  text = text
    .replace(blockSavedNoticePattern, "")
    .replace(inlineSavedNoticePattern, "");

  if (
    text.includes("Your AI model choice was saved.") ||
    /url\.searchParams\.get\("model"\) === "saved"/.test(text)
  ) {
    throw new Error("The model-saved confirmation notice is still present");
  }

  requireText(
    text,
    "const composerModelPicker = composerModelPickerMarkup(",
    "the composer model picker",
  );
  requireText(
    text,
    "if ((markup || composerModelPicker)",
    "the billing-client injection guard",
  );

  return text;
});

console.log(
  "Kept Home in the hamburger menu, moved chat-action proxies outside it, removed duplicate model selection, and suppressed the model-saved notice.",
);
