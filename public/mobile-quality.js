const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);

if (mobilePortrait?.matches) {
  const backdropImage = document.querySelector("#photo-backdrop-image");
  const terrain = document.querySelector("#terrain-background");

  if (backdropImage instanceof HTMLImageElement) {
    document.documentElement.dataset.mobileBackground = "css-motion";

    const markReady = () => {
      document.documentElement.dataset.mobileBackground = "css-motion-ready";
      terrain?.classList.add("is-photo-ready");
    };

    if (backdropImage.complete && backdropImage.naturalWidth > 0) {
      markReady();
    } else {
      backdropImage.addEventListener("load", markReady, { once: true });
      backdropImage.addEventListener(
        "error",
        () => {
          document.documentElement.dataset.mobileBackground = "failed";
        },
        { once: true },
      );
    }
  }
}
