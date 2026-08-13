# Favicon compatibility repair

Stabilize now supplies Safari with a newly named SVG icon plus a PNG data URL embedded directly in every page. The inline PNG removes Cloudflare routing, response MIME, and external-asset caching from Safari's final fallback path.

A freshly versioned same-origin script removes older icon links and reinstalls the new SVG followed by the inline PNG whenever the page is shown or becomes visible. The existing PNG, Apple touch, Safari mask, and web-app manifest fallbacks remain available.
