import { readFile, writeFile } from "node:fs/promises";

const VERSION = "20260810-ai-enhanced-mobile-4k-v23-1";
const OLD_VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v14-retina-2160.mp4";
const VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v23-ai-2160.mp4";
const OLD_VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v14-retina-2160.mp4";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-video-v23-ai-2160.mp4";
const OLD_POSTER_ASSET =
  "/scenes/mobile-forest-stream-v14-retina-2160.webp";
const POSTER_ASSET =
  "/scenes/mobile-forest-stream-v23-ai-2160.webp";
const OLD_VERSION = "20260809-selected-mobile-4k-video-v22-1";
const VIDEO_BYTES = 20_957_716;
const VIDEO_ETAG =
  '"be5995746c6137f9f63121eead3883ce1469279563738e1ccbd813abf9d7becf"';
const QUALITY_LABEL = "ai-enhanced-2160x3840";

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function replaceEvery(source, before, after, label) {
  if (!source.includes(before)) {
    if (source.includes(after)) return source;
    throw new Error(`Could not locate ${label}.`);
  }
  return source.split(before).join(after);
}

function replaceMarked(source, start, end, replacement, append = false) {
  const normalized = `${replacement.trimEnd()}\n`;
  if (!source.includes(start) || !source.includes(end)) {
    if (source.includes(start) || source.includes(end)) {
      throw new Error(`Incomplete marked block: ${start}`);
    }
    if (append) return `${source.trimEnd()}\n\n${normalized}`;
    throw new Error(`Missing marked block: ${start}`);
  }
  const pattern = new RegExp(
    `[ \\t]*${escapeRegExp(start)}[\\s\\S]*?${escapeRegExp(end)}[ \\t]*(?:\\n|$)`,
    "g",
  );
  return source.replace(pattern, normalized);
}

await update("src/mobile-video-response.js", (source) => {
  let next = source
    .replace(
      /export const MOBILE_VIDEO_ROUTE =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ROUTE =\n  "${VIDEO_ROUTE}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_ASSET_PATH =\n  "[^"]+";/,
      `export const MOBILE_VIDEO_ASSET_PATH =\n  "${VIDEO_ASSET}";`,
    )
    .replace(
      /export const MOBILE_VIDEO_BYTES = [\d_]+;/,
      "export const MOBILE_VIDEO_BYTES = 20_957_716;",
    )
    .replace(
      /export const MOBILE_VIDEO_ETAG =\n  '[^']+';/,
      `export const MOBILE_VIDEO_ETAG =\n  '${VIDEO_ETAG}';`,
    );

  if (!next.includes("const assetByteCache = new WeakMap();")) {
    const anchor = `export const MOBILE_VIDEO_ETAG =\n  '${VIDEO_ETAG}';\n`;
    if (!next.includes(anchor)) {
      throw new Error("Could not locate the enhanced-video ETag declaration.");
    }
    next = next.replace(
      anchor,
      `${anchor}\nconst assetByteCache = new WeakMap();\n`,
    );
  }

  const cachedLoader = `async function loadVideoBytes(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw new Error("Static asset binding is unavailable");
  }

  let promise = assetByteCache.get(env.ASSETS);
  if (!promise) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = MOBILE_VIDEO_ASSET_PATH;
    assetUrl.search = "";
    assetUrl.hash = "";

    promise = env.ASSETS
      .fetch(
        new Request(assetUrl.toString(), {
          method: "GET",
          headers: { Accept: "video/mp4" },
        }),
      )
      .then(async (asset) => {
        if (!asset.ok) {
          throw new Error(\`Static mobile video returned \${asset.status}\`);
        }
        const bytes = new Uint8Array(await asset.arrayBuffer());
        if (bytes.byteLength !== MOBILE_VIDEO_BYTES) {
          throw new Error(
            \`Static mobile video has \${bytes.byteLength} bytes; expected \${MOBILE_VIDEO_BYTES}\`,
          );
        }
        return bytes;
      })
      .catch((error) => {
        assetByteCache.delete(env.ASSETS);
        throw error;
      });
    assetByteCache.set(env.ASSETS, promise);
  }
  return promise;
}
`;
  const loaderPattern =
    /async function loadVideoBytes\(request, env\) \{[\s\S]*?\n\}\n\n(?=export async function serveMobileVideo)/;
  if (!loaderPattern.test(next)) {
    throw new Error("Could not locate the mobile-video asset loader.");
  }
  next = next.replace(loaderPattern, `${cachedLoader}\n`);
  next = next.replace(
    'return new Response(request.method === "HEAD" ? null : bytes, {',
    'return new Response(request.method === "HEAD" ? null : bytes.slice(), {',
  );

  for (const expected of [
    VIDEO_ROUTE,
    VIDEO_ASSET,
    "20_957_716",
    VIDEO_ETAG,
    "const assetByteCache = new WeakMap();",
  ]) {
    if (!next.includes(expected)) {
      throw new Error(`The enhanced video responder is missing ${expected}.`);
    }
  }
  return next;
});

await update("public/mobile-quality.js", (source) => {
  let next = replaceEvery(
    source,
    OLD_VIDEO_ROUTE,
    VIDEO_ROUTE,
    "the prior mobile video route",
  );
  next = replaceEvery(
    next,
    OLD_POSTER_ASSET,
    POSTER_ASSET,
    "the prior mobile poster",
  );
  next = next
    .replaceAll("selected-forest-stream", "selected-forest-stream-ai-enhanced")
    .replaceAll("4k-2160x3840", QUALITY_LABEL)
    .replaceAll("video-loading-4k", "video-loading-ai-enhanced");

  for (const expected of [VIDEO_ROUTE, POSTER_ASSET, QUALITY_LABEL]) {
    if (!next.includes(expected)) {
      throw new Error(`The enhanced mobile client is missing ${expected}.`);
    }
  }
  return next;
});

await update("src/page.js", (source) => {
  let next = replaceEvery(
    source,
    OLD_VIDEO_ROUTE,
    VIDEO_ROUTE,
    "the prior page video route",
  );
  next = replaceEvery(
    next,
    OLD_POSTER_ASSET,
    POSTER_ASSET,
    "the prior page poster",
  );
  next = replaceEvery(
    next,
    OLD_VERSION,
    VERSION,
    "the prior mobile media version",
  );

  if (next.split(`href="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected exactly one enhanced video preload.");
  }
  if (next.split(`src="${VIDEO_ROUTE}"`).length - 1 !== 1) {
    throw new Error("Expected exactly one enhanced video source.");
  }
  if (next.split(`${POSTER_ASSET} 2160w`).length - 1 !== 2) {
    throw new Error("Expected two enhanced poster srcset references.");
  }
  if (next.split(`poster="${POSTER_ASSET}"`).length - 1 !== 1) {
    throw new Error("Expected one enhanced video poster.");
  }
  return next;
});

await update("public/guides.css", (source) =>
  source.split(OLD_POSTER_ASSET).join(POSTER_ASSET),
);

const headersStart = "# ai-enhanced-mobile-4k-v23-start";
const headersEnd = "# ai-enhanced-mobile-4k-v23-end";
const headersBlock = `${headersStart}
${VIDEO_ASSET}
  Content-Type: video/mp4
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff

${POSTER_ASSET}
  Content-Type: image/webp
  Cache-Control: public, max-age=31536000, immutable
  Cross-Origin-Resource-Policy: same-origin
  X-Content-Type-Options: nosniff
${headersEnd}`;
await update("public/_headers", (source) =>
  replaceMarked(source, headersStart, headersEnd, headersBlock, true),
);

await update("test/mobile-background-loading.test.mjs", (source) => {
  const materializerPattern =
    /assert\.match\(\s*materializerSource,\s*\/public\\\/scenes\\\/mobile-forest-stream-video-v14-retina-2160\\\.mp4\/,\s*\);/;
  const materializerMatch = source.match(materializerPattern)?.[0] || null;

  let next = source
    .split(OLD_VIDEO_ROUTE)
    .join(VIDEO_ROUTE)
    .split("mobile-forest-stream-video-v14-retina-2160\\.mp4")
    .join("mobile-forest-stream-video-v23-ai-2160\\.mp4")
    .split(`../public${OLD_VIDEO_ASSET}`)
    .join(`../public${VIDEO_ASSET}`)
    .split(OLD_VERSION)
    .join(VERSION)
    .split("4k-2160x3840")
    .join(QUALITY_LABEL)
    .replaceAll("5006520", "20957716");

  if (materializerMatch) {
    next = next.replace(
      /assert\.match\(\s*materializerSource,\s*\/public\\\/scenes\\\/mobile-forest-stream-video-v23-ai-2160\\\.mp4\/,\s*\);/,
      materializerMatch,
    );
  }

  return next;
});

const qualityStart = "// ai-enhanced-mobile-4k-v23-test-start";
const qualityEnd = "// ai-enhanced-mobile-4k-v23-test-end";
const qualityBlock = `${qualityStart}
test("portrait mobile serves the AI-enhanced selected forest scene", async () => {
  const [pageSource, clientSource, responderSource, video, poster] =
    await Promise.all([
      readFile(new URL("../src/page.js", import.meta.url), "utf8"),
      readFile(new URL("../public/mobile-quality.js", import.meta.url), "utf8"),
      readFile(new URL("../src/mobile-video-response.js", import.meta.url), "utf8"),
      readFile(new URL("../public${VIDEO_ASSET}", import.meta.url)),
      readFile(new URL("../public${POSTER_ASSET}", import.meta.url)),
    ]);

  assert.equal(video.byteLength, ${VIDEO_BYTES});
  assert.equal(video.subarray(4, 8).toString("ascii"), "ftyp");
  for (const marker of ["moov", "mdat", "avc1"]) {
    assert.ok(video.includes(Buffer.from(marker, "ascii")));
  }
  const posterInfo = webpInfo(poster);
  assert.deepEqual(
    { width: posterInfo.width, height: posterInfo.height },
    { width: 2160, height: 3840 },
  );
  assert.match(pageSource, /mobile-forest-stream-video-v23-ai-2160\\.mp4/);
  assert.match(pageSource, /mobile-forest-stream-v23-ai-2160\\.webp/);
  assert.match(pageSource, /mobile-quality\\.js\\?v=${VERSION}/);
  assert.match(clientSource, /${QUALITY_LABEL}/);
  assert.match(responderSource, /const assetByteCache = new WeakMap\\(\\)/);
  assert.match(responderSource, /MOBILE_VIDEO_BYTES = 20_957_716/);
  assert.match(responderSource, /${VIDEO_ETAG.slice(1, -1)}/);
});
${qualityEnd}`;

await update("test/mobile-quality.test.mjs", (source) => {
  let next = source
    .split(OLD_VIDEO_ROUTE)
    .join(VIDEO_ROUTE)
    .split("mobile-forest-stream-video-v14-retina-2160\\.mp4")
    .join("mobile-forest-stream-video-v23-ai-2160\\.mp4")
    .split(OLD_POSTER_ASSET)
    .join(POSTER_ASSET)
    .split("mobile-forest-stream-v14-retina-2160\\.webp")
    .join("mobile-forest-stream-v23-ai-2160\\.webp")
    .split(OLD_VERSION)
    .join(VERSION)
    .split("4k-2160x3840")
    .join(QUALITY_LABEL);

  if (next.includes(qualityStart)) {
    next = replaceMarked(next, qualityStart, qualityEnd, qualityBlock);
  } else {
    next = `${next.trimEnd()}\n\n${qualityBlock}\n`;
  }
  return next;
});

console.log(
  `Selected the ${VIDEO_BYTES}-byte AI-enhanced 2160x3840 forest-stream release (${VERSION}).`,
);
