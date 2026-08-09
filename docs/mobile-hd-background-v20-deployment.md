# Deployment verification

After merge, the dedicated production workflow polls stabilize.info until the HTML, JavaScript, stylesheet, 1440 × 2560 MP4, and matching poster all match the merged commit. It then opens the site in mobile WebKit and verifies decoded dimensions, opacity, visibility, and advancing playback.
