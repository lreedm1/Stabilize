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
  "Moved Home into the hamburger menu and removed duplicate model selection from that menu.",
);
