# Mobile HD v20 test plan

1. Regenerate canonical output and require a clean tree.
2. Run the complete Node and Worker suites.
3. Require the production MP4 to match the checked-out SHA and byte count.
4. Decode the live MP4 as 1440 × 2560.
5. Require the live page to reference the versioned video, poster, client, and stylesheet.
6. In mobile WebKit, require an opaque visible video, decoded 1440 × 2560 dimensions, and an advancing playback timeline.
