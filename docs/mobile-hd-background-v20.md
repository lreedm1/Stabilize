# True-HD portrait mobile background v20

The former portrait scene was stored in 2160 × 3840 containers but originated from a 512 × 908 preview, so larger files did not contain additional scene detail.

This release replaces the source itself with a native 3840 × 2160 Pexels video and creates a 1440 × 2560 H.264 portrait derivative for mobile. A matching 1440 × 2560 WebP poster remains visible before playback or when autoplay is unavailable. The existing poster-plus-canvas implementation stays underneath as a final fallback.

Production verification checks exact asset hashes, decoded dimensions, page wiring, visibility, and advancing playback in mobile WebKit.

## Mobile smooth v33

On August 13, 2026, Stabilize released a 720 × 1280 constrained-baseline H.264 mobile stream with motion-compensated 60 fps cadence. The versioned media route is publicly cacheable with byte-range support, and portrait-mobile reading surfaces no longer apply live backdrop blur over the moving video. The release gate verifies the exact production checksum and advancing playback in mobile WebKit before declaring the deployment complete.
