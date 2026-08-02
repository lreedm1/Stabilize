const mobileViewport = globalThis.matchMedia?.("(max-width: 980px)");

if (mobileViewport?.matches) {
  // Mobile shows the GIF itself as the only photographic background.
  // Desktop never imports the GIF payload.
  document.querySelector("#photo-background")?.remove();

  const backdrop = document.querySelector("#photo-backdrop");
  const backdropImage = document.querySelector("#photo-backdrop-image");

  if (backdrop instanceof HTMLElement && backdropImage instanceof HTMLImageElement) {
    // Remove every responsive static-photo source before loading the animation.
    backdrop.querySelectorAll("source").forEach((source) => source.remove());
    backdropImage.removeAttribute("srcset");
    backdropImage.removeAttribute("sizes");
    backdropImage.removeAttribute("src");
    backdropImage.style.opacity = "0";
    backdropImage.style.transition = "opacity 350ms ease";
    backdropImage.style.filter = "none";

    void import("/mobile-creek-gif.js?v=20260802-2")
      .then(({ default: gifDataUrl }) => {
        backdropImage.addEventListener(
          "load",
          () => {
            backdropImage.style.opacity = "1";
            document
              .querySelector("#terrain-background")
              ?.classList.add("is-photo-ready");
          },
          { once: true },
        );

        backdropImage.src = gifDataUrl;
        backdropImage.decoding = "async";
        backdropImage.loading = "eager";
        backdropImage.fetchPriority = "high";
      })
      .catch(() => {
        // Leave the non-photographic terrain fallback visible if loading fails.
      });
  }
}
