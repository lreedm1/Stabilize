# Favicon compatibility repair

Stabilize uses a static favicon contract:

- `/favicon.ico` is the legacy fallback.
- `/stabilize-tab-20260813.svg` is the scalable icon.
- `/stabilize-tab-20260813-static-32.png` is the final raster tab-icon candidate.
- The initial HTML contains those links directly.
- No JavaScript removes, replaces, or reinstalls favicon links.

The uniquely named PNG and SVG use one-year immutable caching. The stable
`/favicon.ico` fallback uses a one-day cache so it can still be replaced
without changing its conventional URL.

`scripts/embed-favicon-fallback.mjs` regenerates the binary assets, page
metadata, manifest, and headers idempotently. It runs last in the normal
policy-preparation chain so older generators cannot restore the retired
runtime favicon approach.
