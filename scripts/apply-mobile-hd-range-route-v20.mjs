import { readFile, writeFile } from "node:fs/promises";

const VIDEO_ROUTE =
  "/media/mobile-forest-stream-v20-true-hd-1440.mp4";
const VIDEO_ASSET =
  "/scenes/mobile-forest-stream-v20-true-hd-1440.mp4";
const VIDEO_BYTES = 18_923_892;
const VIDEO_ETAG =
  '"18c256fcfef5d7c801ac03214c97b65c88f984b9113445524bcea2b2f71211b8"';

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

function replaceRequired(source, before, after, label) {
  if (source.includes(after)) return source;
  if (!source.includes(before)) {
    throw new Error(`Could not locate ${label}.`);
  }
  return source.replace(before, after);
}

const responder = `import { parseSingleByteRange } from "./mobile-video-response.js";

export const MOBILE_HD_VIDEO_ROUTE =
  "${VIDEO_ROUTE}";
export const MOBILE_HD_VIDEO_ASSET_PATH =
  "${VIDEO_ASSET}";
export const MOBILE_HD_VIDEO_BYTES = ${VIDEO_BYTES.toLocaleString("en-US").replaceAll(",", "_")};
export const MOBILE_HD_VIDEO_ETAG =
  '${VIDEO_ETAG}';

const assetByteCache = new WeakMap();

function videoHeaders() {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "Content-Disposition": "inline",
    "Content-Type": "video/mp4",
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: MOBILE_HD_VIDEO_ETAG,
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
}

function errorResponse(status, message, extraHeaders = {}) {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

async function fetchAssetBytes(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw new Error("Static asset binding is unavailable");
  }

  let cache = assetByteCache.get(env.ASSETS);
  if (!cache) {
    cache = new Map();
    assetByteCache.set(env.ASSETS, cache);
  }

  let promise = cache.get(MOBILE_HD_VIDEO_ASSET_PATH);
  if (!promise) {
    const assetUrl = new URL(request.url);
    assetUrl.pathname = MOBILE_HD_VIDEO_ASSET_PATH;
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
          throw new Error(\`Static HD mobile video returned \${asset.status}\`);
        }
        const bytes = new Uint8Array(await asset.arrayBuffer());
        if (bytes.byteLength !== MOBILE_HD_VIDEO_BYTES) {
          throw new Error(
            \`Static HD mobile video has \${bytes.byteLength} bytes; expected \${MOBILE_HD_VIDEO_BYTES}\`,
          );
        }
        return bytes;
      })
      .catch((error) => {
        cache.delete(MOBILE_HD_VIDEO_ASSET_PATH);
        throw error;
      });
    cache.set(MOBILE_HD_VIDEO_ASSET_PATH, promise);
  }
  return promise;
}

export async function serveMobileHdVideo(request, env) {
  if (!request || !["GET", "HEAD"].includes(request.method)) {
    return errorResponse(405, "Method not allowed.", { Allow: "GET, HEAD" });
  }

  let bytes;
  try {
    bytes = await fetchAssetBytes(request, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mobile_hd_video_asset_failed",
        error: error instanceof Error ? error.message : "UnknownError",
      }),
    );
    return errorResponse(503, "Video temporarily unavailable.", {
      "Retry-After": "30",
    });
  }

  const size = bytes.byteLength;
  const rangeValue = request.headers.get("range");
  const ifRange = request.headers.get("if-range");
  const useRange = Boolean(
    rangeValue && (!ifRange || ifRange.trim() === MOBILE_HD_VIDEO_ETAG),
  );
  const range = useRange ? parseSingleByteRange(rangeValue, size) : null;

  if (range?.invalid) {
    const headers = videoHeaders();
    headers.set("Content-Length", "0");
    headers.set("Content-Range", \`bytes */\${size}\`);
    return new Response(null, { status: 416, headers });
  }

  if (!range) {
    const ifNoneMatch = request.headers.get("if-none-match");
    if (
      !rangeValue &&
      (ifNoneMatch === "*" || ifNoneMatch === MOBILE_HD_VIDEO_ETAG)
    ) {
      const headers = videoHeaders();
      headers.delete("Content-Type");
      headers.delete("Content-Disposition");
      return new Response(null, { status: 304, headers });
    }

    const headers = videoHeaders();
    headers.set("Content-Length", String(size));
    return new Response(request.method === "HEAD" ? null : bytes.slice(), {
      status: 200,
      headers,
    });
  }

  const { start, end } = range;
  const body = bytes.slice(start, end + 1);
  const headers = videoHeaders();
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Range", \`bytes \${start}-\${end}/\${size}\`);
  return new Response(request.method === "HEAD" ? null : body, {
    status: 206,
    headers,
  });
}
`;
await writeFile("src/mobile-hd-video-response.js", responder, "utf8");

await update("src/domain-router.js", (source) => {
  let next = source;
  const importBlock = `import {
  MOBILE_HD_VIDEO_ROUTE,
  serveMobileHdVideo,
} from "./mobile-hd-video-response.js";
`;
  if (!next.includes(importBlock)) {
    const anchor = `import {
  MOBILE_VIDEO_ROUTE,
  serveMobileVideo,
} from "./mobile-video-response.js";
`;
    if (!next.includes(anchor)) throw new Error("Missing mobile video import");
    next = next.replace(anchor, `${anchor}${importBlock}`);
  }

  const routeBlock = `    if (url.pathname === MOBILE_HD_VIDEO_ROUTE) {
      return withStrictTransportSecurity(
        await serveMobileHdVideo(request, canonicalEnv),
      );
    }

`;
  if (!next.includes(routeBlock)) {
    const anchor = `    if (url.pathname === MOBILE_VIDEO_ROUTE) {
`;
    if (!next.includes(anchor)) throw new Error("Missing mobile video route");
    next = next.replace(anchor, `${routeBlock}${anchor}`);
  }
  return next;
});

await update("scripts/apply-mobile-hd-background-v20.mjs", (source) => {
  let next = source;
  next = replaceRequired(
    next,
    `const VIDEO_ASSET =
  "${VIDEO_ASSET}";`,
    `const VIDEO_ROUTE =
  "${VIDEO_ROUTE}";
const VIDEO_ASSET =
  "${VIDEO_ASSET}";`,
    "the HD video asset declaration",
  );
  next = replaceRequired(
    next,
    '      href="${VIDEO_ASSET}"',
    '      href="${VIDEO_ROUTE}"',
    "the HD video preload route",
  );
  next = replaceRequired(
    next,
    '      <source src="${VIDEO_ASSET}" type="video/mp4" />',
    '      <source src="${VIDEO_ROUTE}" type="video/mp4" />',
    "the HD video source route",
  );
  next = replaceRequired(
    next,
    '  if (next.split(`href="${VIDEO_ASSET}"`).length - 1 !== 1) {',
    '  if (next.split(`href="${VIDEO_ROUTE}"`).length - 1 !== 1) {',
    "the HD preload validation",
  );
  next = replaceRequired(
    next,
    '  if (next.split(`src="${VIDEO_ASSET}"`).length - 1 !== 1) {',
    '  if (next.split(`src="${VIDEO_ROUTE}"`).length - 1 !== 1) {',
    "the HD source validation",
  );
  return next;
});

await update("src/page.js", (source) =>
  source.replaceAll(VIDEO_ASSET, VIDEO_ROUTE),
);

const testStart = "// mobile-hd-range-route-v20-test-start";
const testEnd = "// mobile-hd-range-route-v20-test-end";
const testBlock = `${testStart}
test("the true-HD mobile MP4 receives exact Worker byte ranges", async () => {
  const {
    MOBILE_HD_VIDEO_ASSET_PATH,
    MOBILE_HD_VIDEO_BYTES,
    MOBILE_HD_VIDEO_ETAG,
    MOBILE_HD_VIDEO_ROUTE,
    serveMobileHdVideo,
  } = await import("../src/mobile-hd-video-response.js");
  const video = await readFile(
    new URL(
      "../public/scenes/mobile-forest-stream-v20-true-hd-1440.mp4",
      import.meta.url,
    ),
  );
  assert.equal(video.byteLength, MOBILE_HD_VIDEO_BYTES);

  let assetFetches = 0;
  const env = {
    ASSETS: {
      async fetch(request) {
        assetFetches += 1;
        const url = new URL(request.url);
        assert.equal(url.pathname, MOBILE_HD_VIDEO_ASSET_PATH);
        assert.equal(request.headers.get("range"), null);
        return new Response(video, {
          status: 200,
          headers: { "Content-Type": "video/mp4" },
        });
      },
    },
  };
  const url = `https://stabilize.info${VIDEO_ROUTE}`;
  const first = await serveMobileHdVideo(
    new Request(url, { headers: { Range: "bytes=0-1023" } }),
    env,
  );
  assert.equal(first.status, 206);
  assert.equal(
    first.headers.get("content-range"),
    `bytes 0-1023/${VIDEO_BYTES}`,
  );
  assert.equal(first.headers.get("content-length"), "1024");
  assert.equal(first.headers.get("accept-ranges"), "bytes");
  assert.equal(first.headers.get("etag"), MOBILE_HD_VIDEO_ETAG);
  assert.deepEqual(Buffer.from(await first.arrayBuffer()), video.subarray(0, 1024));

  const tail = await serveMobileHdVideo(
    new Request(url, { headers: { Range: "bytes=-2048" } }),
    env,
  );
  assert.equal(tail.status, 206);
  assert.equal(
    tail.headers.get("content-range"),
    `bytes ${VIDEO_BYTES - 2048}-${VIDEO_BYTES - 1}/${VIDEO_BYTES}`,
  );
  assert.equal(assetFetches, 1);

  const [pageSource, routerSource] = await Promise.all([
    read("src/page.js"),
    read("src/domain-router.js"),
  ]);
  assert.match(pageSource, /${escapeRegExp(VIDEO_ROUTE)}/);
  assert.doesNotMatch(pageSource, /src="${escapeRegExp(VIDEO_ASSET)}"/);
  assert.match(routerSource, /url\\.pathname === MOBILE_HD_VIDEO_ROUTE/);
  assert.match(routerSource, /serveMobileHdVideo\\(request, canonicalEnv\\)/);
});
${testEnd}`;
await update("test/mobile-background-loading.test.mjs", (source) => {
  const pattern = new RegExp(
    `${testStart.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\s\\S]*?${testEnd.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&")}`,
  );
  if (source.includes(testStart)) return source.replace(pattern, testBlock);
  return `${source.trimEnd()}\n\n${testBlock}\n`;
});

await update(".github/workflows/verify-mobile-hd-background-v20.yml", (source) => {
  let next = source;
  const routeLine = `          video_route='${VIDEO_ROUTE}'\n`;
  if (!next.includes(routeLine)) {
    const assetLine = `          video_asset='${VIDEO_ASSET}'\n`;
    if (!next.includes(assetLine)) throw new Error("Missing verifier video asset");
    next = next.replace(assetLine, `${routeLine}${assetLine}`);
  }
  next = next.replace(
    `              && grep -Fq "$video_asset" "$work/page.html" \\\n`,
    `              && grep -Fq "$video_route" "$work/page.html" \\\n`,
  );
  return next;
});

console.log(
  "Routed the true-HD mobile MP4 through exact Worker byte-range delivery.",
);
