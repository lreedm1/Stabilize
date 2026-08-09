export const MOBILE_VIDEO_ROUTE =
  "/media/mobile-forest-stream-video-v4-1080.mp4";
export const MOBILE_VIDEO_ASSET_PATH =
  "/scenes/mobile-forest-stream-video-v4-1080.mp4";
export const MOBILE_VIDEO_BYTES = 113_613;
export const MOBILE_VIDEO_ETAG =
  '"d3ee88fd124469a18ee0d1677835810caabe47d1bec33e8d48dba745c426b02d"';

function videoHeaders() {
  return new Headers({
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, no-store, max-age=0, must-revalidate",
    "CDN-Cache-Control": "no-store",
    "Cloudflare-CDN-Cache-Control": "no-store",
    "Content-Disposition": "inline",
    "Content-Type": "video/mp4",
    "Cross-Origin-Resource-Policy": "same-origin",
    ETag: MOBILE_VIDEO_ETAG,
    Pragma: "no-cache",
    "X-Content-Type-Options": "nosniff",
  });
}

function errorResponse(status, message, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store, max-age=0",
    "Content-Type": "text/plain; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    ...extraHeaders,
  });
  return new Response(message, { status, headers });
}

export function parseSingleByteRange(value, size) {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0) {
    return { invalid: true };
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(String(value).trim());
  if (!match || (!match[1] && !match[2])) {
    return { invalid: true };
  }

  let start;
  let end;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      return { invalid: true };
    }
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(match[1]);
    if (!Number.isSafeInteger(start) || start < 0 || start >= size) {
      return { invalid: true };
    }

    if (!match[2]) {
      end = size - 1;
    } else {
      end = Number(match[2]);
      if (!Number.isSafeInteger(end) || end < start) {
        return { invalid: true };
      }
      end = Math.min(end, size - 1);
    }
  }

  return { start, end };
}

async function loadVideoBytes(request, env) {
  if (!env?.ASSETS || typeof env.ASSETS.fetch !== "function") {
    throw new Error("Static asset binding is unavailable");
  }

  const assetUrl = new URL(request.url);
  assetUrl.pathname = MOBILE_VIDEO_ASSET_PATH;
  assetUrl.search = "";
  assetUrl.hash = "";

  const asset = await env.ASSETS.fetch(
    new Request(assetUrl.toString(), {
      method: "GET",
      headers: { Accept: "video/mp4" },
    }),
  );

  if (!asset.ok) {
    throw new Error(`Static mobile video returned ${asset.status}`);
  }

  const bytes = new Uint8Array(await asset.arrayBuffer());
  if (bytes.byteLength !== MOBILE_VIDEO_BYTES) {
    throw new Error(
      `Static mobile video has ${bytes.byteLength} bytes; expected ${MOBILE_VIDEO_BYTES}`,
    );
  }
  return bytes;
}

export async function serveMobileVideo(request, env) {
  if (!request || !["GET", "HEAD"].includes(request.method)) {
    return errorResponse(405, "Method not allowed.", {
      Allow: "GET, HEAD",
    });
  }

  let bytes;
  try {
    bytes = await loadVideoBytes(request, env);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "mobile_video_asset_failed",
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
    rangeValue && (!ifRange || ifRange.trim() === MOBILE_VIDEO_ETAG),
  );
  const range = useRange ? parseSingleByteRange(rangeValue, size) : null;

  if (range?.invalid) {
    const headers = videoHeaders();
    headers.set("Content-Length", "0");
    headers.set("Content-Range", `bytes */${size}`);
    return new Response(null, { status: 416, headers });
  }

  if (!range) {
    const ifNoneMatch = request.headers.get("if-none-match");
    if (
      !rangeValue &&
      (ifNoneMatch === "*" || ifNoneMatch === MOBILE_VIDEO_ETAG)
    ) {
      const headers = videoHeaders();
      headers.delete("Content-Type");
      headers.delete("Content-Disposition");
      return new Response(null, { status: 304, headers });
    }

    const headers = videoHeaders();
    headers.set("Content-Length", String(size));
    return new Response(request.method === "HEAD" ? null : bytes, {
      status: 200,
      headers,
    });
  }

  const { start, end } = range;
  const body = bytes.slice(start, end + 1);
  const headers = videoHeaders();
  headers.set("Content-Length", String(body.byteLength));
  headers.set("Content-Range", `bytes ${start}-${end}/${size}`);

  return new Response(request.method === "HEAD" ? null : body, {
    status: 206,
    headers,
  });
}
