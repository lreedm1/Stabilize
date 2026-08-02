const mobileViewport = globalThis.matchMedia?.("(max-width: 980px)");

if (mobileViewport?.matches) {
  // The animated photo canvas is intentionally lower resolution to protect
  // desktop GPU performance. On phones it can cover the sharper responsive
  // image, so remove it before terrain.js initializes.
  document.querySelector("#photo-background")?.remove();
}
