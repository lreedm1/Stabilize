const CANONICAL_ORIGIN = "https://stabilize.info";
const HSTS_VALUE = "max-age=31536000; includeSubDomains";

function redirectTarget(request) {
  const incoming = new URL(request.url);
  const target = new URL(CANONICAL_ORIGIN);
  target.pathname = incoming.pathname;
  target.search = incoming.search;
  return target;
}

export default {
  fetch(request) {
    return new Response(null, {
      status: 308,
      headers: {
        "Cache-Control": "public, max-age=3600",
        Location: redirectTarget(request).toString(),
        "Referrer-Policy": "no-referrer",
        "Strict-Transport-Security": HSTS_VALUE,
        "X-Content-Type-Options": "nosniff",
      },
    });
  },
};
