const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);

if (mobilePortrait?.matches) {
  // Portrait phones always request the animated woodland background. Desktop
  // and landscape mobile keep the existing responsive high-resolution still.
  const backdrop = document.querySelector("#photo-backdrop");
  const backdropImage = document.querySelector("#photo-backdrop-image");

  if (backdrop instanceof HTMLElement && backdropImage instanceof HTMLImageElement) {
    document.documentElement.dataset.mobileBackground = "loading";

    void import("/mobile-creek-gif.js?v=20260802-6")
      .then(({ default: animationDataUrl }) => {
        // The lower-resolution canvas would cover and soften the selected image.
        document.querySelector("#photo-background")?.remove();
        backdrop.querySelectorAll("source").forEach((source) => source.remove());
        backdropImage.removeAttribute("srcset");
        backdropImage.removeAttribute("sizes");
        backdropImage.style.opacity = "0";
        backdropImage.style.transition = "opacity 350ms ease";
        backdropImage.style.filter = "none";

        const revealAnimation = () => {
          backdropImage.style.opacity = "1";
          document.documentElement.dataset.mobileBackground = "animated";
          document
            .querySelector("#terrain-background")
            ?.classList.add("is-photo-ready");
        };

        backdropImage.addEventListener("load", revealAnimation, { once: true });
        backdropImage.addEventListener(
          "error",
          () => {
            document.documentElement.dataset.mobileBackground = "failed";
            backdropImage.style.opacity = "1";
          },
          { once: true },
        );

        backdropImage.src = animationDataUrl;
        backdropImage.decoding = "async";
        backdropImage.loading = "eager";
        backdropImage.fetchPriority = "high";

        if (backdropImage.complete && backdropImage.naturalWidth > 0) {
          revealAnimation();
        }
      })
      .catch((error) => {
        document.documentElement.dataset.mobileBackground = "failed";
        console.error("Mobile woodland animation failed to load", error);
      });
  }
}
