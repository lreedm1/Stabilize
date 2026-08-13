import { readdir, readFile, writeFile } from "node:fs/promises";

const VERSION = "20260813-mobile-video-handoff-v31-1";
const BACKGROUND_VERSION = "20260813-mobile-background-v31-1";
const VIDEO_ASSET = "/media/mobile-forest-stream-video-v24-native-1080.mp4";
const MOBILE_BACKGROUND_CONTROLLER = "/mobile-background/runtime";
const MOBILE_BACKGROUND_STYLES = "/mobile-background/styles";
const BACKGROUND_CLIENT_PATH = "public/mobile-background-v30.js";
const BACKGROUND_STYLE_PATH = "public/mobile-background-v30.css";
const BACKGROUND_RESPONSE_PATH = "src/mobile-background-response.js";
const CLIENT_ASSET = "/mobile-video-handoff-v31.js";
const FINALIZER = "node scripts/finalize-mobile-video-handoff-v31.mjs";
const TEST_PATH = "test/mobile-video-handoff-v31.test.mjs";
const PARSER_SOURCE_GUARD = "mobile-v31-parser-source-guard";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function preserveParserLoadedSource(source) {
  if (source.includes(PARSER_SOURCE_GUARD)) return source;

  const previous = `    if (!video.getAttribute("src")) {
      video.src = VIDEO_ASSET;
      video.load();
    }`;
  if (!source.includes(previous)) {
    throw new Error(
      "Could not find the v30 direct-source fallback before applying the v31 parser-source guard.",
    );
  }

  const replacement = `    // ${PARSER_SOURCE_GUARD}
    // Keep the parser-owned <source> stable. Assigning video.src here would
    // cancel the v31 request and make the two controllers fight over playback.
    const parserSource = video.querySelector("source[src]");
    if (
      !video.getAttribute("src") &&
      !(parserSource instanceof HTMLSourceElement)
    ) {
      video.src = VIDEO_ASSET;
      video.load();
    }`;
  return source.replace(previous, replacement);
}

async function writeMobileBackgroundRouteModule() {
  const client = await readFile(BACKGROUND_CLIENT_PATH, "utf8");
  const styles = await readFile(BACKGROUND_STYLE_PATH, "utf8");
  const moduleSource = [
    `export const MOBILE_BACKGROUND_VERSION = "${BACKGROUND_VERSION}";`,
    `export const MOBILE_BACKGROUND_CLIENT_ROUTE = "${MOBILE_BACKGROUND_CONTROLLER}";`,
    `export const MOBILE_BACKGROUND_STYLE_ROUTE = "${MOBILE_BACKGROUND_STYLES}";`,
    "",
    "const CLIENT_SOURCE = " + JSON.stringify(client) + ";",
    "const STYLE_SOURCE = " + JSON.stringify(styles) + ";",
    "",
    "export function isMobileBackgroundAssetRoute(pathname) {",
    "  return (",
    "    pathname === MOBILE_BACKGROUND_CLIENT_ROUTE ||",
    "    pathname === MOBILE_BACKGROUND_STYLE_ROUTE",
    "  );",
    "}",
    "",
    "export function serveMobileBackgroundAsset(request) {",
    "  const url = new URL(request.url);",
    "  const isClient = url.pathname === MOBILE_BACKGROUND_CLIENT_ROUTE;",
    "  const isStyle = url.pathname === MOBILE_BACKGROUND_STYLE_ROUTE;",
    "  if (!isClient && !isStyle) {",
    "    return new Response(\"Not found.\", { status: 404 });",
    "  }",
    "  if (request.method !== \"GET\" && request.method !== \"HEAD\") {",
    "    return new Response(\"Method not allowed.\", {",
    "      status: 405,",
    "      headers: { Allow: \"GET, HEAD\" },",
    "    });",
    "  }",
    "  const body = isClient ? CLIENT_SOURCE : STYLE_SOURCE;",
    "  const headers = new Headers({",
    "    \"Cache-Control\": \"no-store, max-age=0\",",
    "    \"Content-Type\": isClient",
    "      ? \"text/javascript; charset=utf-8\"",
    "      : \"text/css; charset=utf-8\",",
    "    \"Cross-Origin-Resource-Policy\": \"same-origin\",",
    "    \"Referrer-Policy\": \"no-referrer\",",
    "    \"X-Content-Type-Options\": \"nosniff\",",
    "  });",
    "  return new Response(request.method === \"HEAD\" ? null : body, {",
    "    status: 200,",
    "    headers,",
    "  });",
    "}",
    "",
  ].join("\n");
  await writeFile(BACKGROUND_RESPONSE_PATH, moduleSource, "utf8");

  if (!client.includes(PARSER_SOURCE_GUARD)) {
    throw new Error("The v31 parser-source guard was not materialized.");
  }
  if (!moduleSource.includes(PARSER_SOURCE_GUARD)) {
    throw new Error("The Worker-served runtime is missing the parser-source guard.");
  }
}

await update(BACKGROUND_CLIENT_PATH, preserveParserLoadedSource);
await writeMobileBackgroundRouteModule();

await update("src/page.js", (source) => {
  let next = source;

  next = next.replace(
    /^[ \t]*<script[^>]*mobile-video-handoff-v31\.js[^>]*><\/script>[ \t]*\n?/gm,
    "",
  );

  const videoPattern = /<video\n\s+id="mobile-background-video"[\s\S]*?<\/video>/;
  const match = next.match(videoPattern);
  if (!match) throw new Error("Could not find the v30 mobile video element.");

  const current = match[0];
  const posterMatch = current.match(/poster="([^"]+)"/);
  if (!posterMatch) throw new Error("The mobile video is missing its poster.");

  const replacement = `<video
      id="mobile-background-video"
      class="mobile-background-video"
      autoplay
      muted
      loop
      playsinline
      preload="auto"
      poster="${posterMatch[1]}"
      aria-hidden="true"
      tabindex="-1"
      disablepictureinpicture
      disableremoteplayback
      x-webkit-airplay="deny"
    >
      <source
        src="${VIDEO_ASSET}?v=${VERSION}"
        type="video/mp4"
      />
    </video>`;
  next = next.replace(videoPattern, replacement);

  const controllerPattern =
    /<script\b[^>]*\bsrc="\/mobile-background\/runtime\?v=[^"]+"[^>]*><\/script>/;
  const controllerMatch = next.match(controllerPattern);
  if (!controllerMatch || controllerMatch.index === undefined) {
    throw new Error("Could not find the Worker-served v30 controller before the handoff patch.");
  }
  const insertion = controllerMatch.index + controllerMatch[0].length;
  next =
    next.slice(0, insertion) +
    `\n    <script src="${CLIENT_ASSET}?v=${VERSION}"></script>` +
    next.slice(insertion);

  if (next.split(CLIENT_ASSET).length - 1 !== 1) {
    throw new Error("Expected one v31 handoff controller.");
  }
  if (next.split('id="mobile-background-video"').length - 1 !== 1) {
    throw new Error("Expected one mobile video element.");
  }
  if (!next.includes("autoplay\n      muted") || !next.includes('preload="auto"')) {
    throw new Error("The mobile video is not parser-configured for autoplay.");
  }
  if (!next.includes(`${VIDEO_ASSET}?v=${VERSION}`)) {
    throw new Error("The mobile video source is not parser-visible.");
  }

  const controllerIndex = next.indexOf(`${MOBILE_BACKGROUND_CONTROLLER}?v=`);
  const handoffIndex = next.indexOf(`${CLIENT_ASSET}?v=${VERSION}`);
  if (controllerIndex < 0 || handoffIndex <= controllerIndex) {
    throw new Error("The v31 handoff must load immediately after the Worker-served v30 controller.");
  }

  return next;
});

let canonicalPolicy = "";
await update("package.json", (source) => {
  const data = JSON.parse(source);
  const policy = String(data.scripts?.["apply:prompt-policy"] || "");
  if (!policy) throw new Error("package.json is missing apply:prompt-policy.");
  const commands = policy
    .split(" && ")
    .filter((command) => command !== FINALIZER);
  commands.push(FINALIZER);
  canonicalPolicy = commands.join(" && ");
  data.scripts["apply:prompt-policy"] = canonicalPolicy;

  const nodeTests = String(data.scripts?.["test:node"] || "");
  const tokens = nodeTests.split(/\s+/).filter(Boolean);
  if (!tokens.includes(TEST_PATH)) tokens.push(TEST_PATH);
  data.scripts["test:node"] = tokens.join(" ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

const commandLiteralPattern =
  /"node scripts\/prepare-signed-in-latency-v2\.mjs[^"\n]*node scripts\/finalize-(?:native-selected-mobile-v24-regressions|mobile-video-handoff-v31)\.mjs"/g;
const previousTail =
  "finalize-native-selected-mobile-v24-regressions\\.mjs$/";
const canonicalTail =
  "finalize-native-selected-mobile-v24-regressions\\.mjs && node scripts\\/finalize-mobile-video-handoff-v31\\.mjs$/";
const testNames = (await readdir("test"))
  .filter((name) => name.endsWith(".mjs"))
  .sort();

for (const name of testNames) {
  await update(`test/${name}`, (source) =>
    source
      .replace(commandLiteralPattern, JSON.stringify(canonicalPolicy))
      .replaceAll(previousTail, canonicalTail),
  );
}

await update("test/mobile-background-v30.test.mjs", (source) => {
  const backgroundDeclaration = `const VERSION = "${BACKGROUND_VERSION}";`;
  const handoffDeclaration = `const HANDOFF_VERSION = "${VERSION}";`;
  let next = source;
  if (!next.includes(handoffDeclaration)) {
    if (!next.includes(backgroundDeclaration)) {
      throw new Error("Could not find the v30 test version declaration.");
    }
    next = next.replace(
      backgroundDeclaration,
      `${backgroundDeclaration}\n${handoffDeclaration}`,
    );
  }
  next = next
    .replaceAll(
      'new RegExp("/media/" + VIDEO + "\\\\?v=" + VERSION)',
      'new RegExp("/media/" + VIDEO + "\\\\?v=" + HANDOFF_VERSION)',
    )
    .replaceAll(
      `new RegExp('src="/media/' + VIDEO + "\\\\?v=" + VERSION + '"')`,
      `new RegExp('src="/media/' + VIDEO + "\\\\?v=" + HANDOFF_VERSION + '"')`,
    );
  if (!next.includes("+ HANDOFF_VERSION")) {
    throw new Error("Could not align the v30 page assertions with the v31 media version.");
  }
  return next;
});

await update("public/_headers", (source) => {
  const start = "# mobile-video-handoff-v31-start";
  const end = "# mobile-video-handoff-v31-end";
  const block = `${start}
/mobile-video-handoff-v31.js
  Content-Type: text/javascript; charset=utf-8
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${end}`;
  if (source.includes(start) && source.includes(end)) {
    return source.replace(
      new RegExp(`${start}[\\s\\S]*?${end}`, "g"),
      block,
    );
  }
  return `${source.trimEnd()}\n\n${block}\n`;
});

console.log(
  `Finalized ${VERSION}: parser-loaded native video, source ownership, and synchronous iOS gesture recovery.`,
);
