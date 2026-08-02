# Mobile woodland background

The animated woodland creek background is loaded only when all of these are true:

- viewport width is 980 CSS pixels or less
- orientation is portrait
- the user has not enabled reduced motion

The four data modules are dynamically imported only after those media queries match, so desktop clients do not download the animation. Desktop, landscape mobile, reduced-motion, and animation-failure cases retain the existing 7680-pixel WebP landscape.

The mobile animation is a compact animated WebP embedded as split base64 modules to keep the repository change text-safe while avoiding the much larger GIF transfer.
