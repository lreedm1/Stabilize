const mobileViewport = globalThis.matchMedia?.("(max-width: 980px)");

if (mobileViewport?.matches) {
  // Keep the sharper mobile-only animated image visible. The animated photo
  // canvas is intentionally removed on phones so it cannot cover the GIF.
  document.querySelector("#photo-background")?.remove();

  const mobileSource = document.querySelector(
    '#photo-backdrop source[data-mobile-animation]'
  );
  if (mobileSource instanceof HTMLSourceElement) {
    mobileSource.srcset = mobileSource.dataset.mobileAnimation || "";
  }

  const backdropImage = document.querySelector("#photo-backdrop-image");
  if (backdropImage instanceof HTMLImageElement) {
    backdropImage.addEventListener(
      "load",
      () => {
        backdropImage.classList.add("is-ready");
        document
          .querySelector("#terrain-background")
          ?.classList.add("is-photo-ready");
      },
      { once: true },
    );
  }
}
