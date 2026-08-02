const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);

if (mobilePortrait?.matches && !reducedMotion?.matches) {
  // Only portrait phones import the animation payload. Desktop, landscape
  // mobile, and reduced-motion users keep the existing responsive still.
  const backdrop = document.querySelector("#photo-backdrop");
  const backdropImage = document.querySelector("#photo-backdrop-image");

  if (backdrop instanceof HTMLElement && backdropImage instanceof HTMLImageElement) {
    void import("/mobile-creek-gif.js?v=20260802-4")
      .then(({ default: animationDataUrl }) => {
        // The lower-resolution canvas would cover and soften the selected image.
        document.querySelector("#photo-background")?.remove();
        backdrop.querySelectorAll("source").forEach((source) => source.remove());
        backdropImage.removeAttribute("srcset");
        backdropImage.removeAttribute("sizes");
        backdropImage.style.opacity = "0";
        backdropImage.style.transition = "opacity 350ms ease";
        backdropImage.style.filter = "none";

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

        backdropImage.src = animationDataUrl;
        backdropImage.decoding = "async";
        backdropImage.loading = "eager";
        backdropImage.fetchPriority = "high";
      })
      .catch(() => {
        // The responsive high-resolution still remains visible on failure.
      });
  }
}
