# Favicon compatibility repair

Stabilize serves a real multi-size `favicon.ico`, a 32×32 PNG fallback, the existing SVG icon, and a 180×180 Apple touch icon. The generated page links all formats with a cache-busting version, while the Worker normalizes MIME types and prevents stale long-lived caching during rollout.

Production verification checks the HTML references, response status and MIME type, ICO header bytes, and PNG signatures after each successful main deployment.
