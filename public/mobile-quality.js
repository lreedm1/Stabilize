const mobileViewport = globalThis.matchMedia?.("(max-width: 980px)");

if (mobileViewport?.matches) {
  // Mobile uses a dedicated GIF motion layer over the sharp static photo.
  // Desktop never imports the GIF payload, and the lower-resolution animated
  // canvas is removed so it cannot soften or cover the mobile background.
  document.querySelector("#photo-background")?.remove();

  void import("/mobile-creek-gif.js?v=20260802-1")
    .then(({ default: gifDataUrl }) => {
      const backdrop = document.querySelector("#photo-backdrop");
      if (!(backdrop instanceof HTMLElement)) return;

      const overlay = document.createElement("img");
      overlay.src = gifDataUrl;
      overlay.alt = "";
      overlay.setAttribute("aria-hidden", "true");
      overlay.decoding = "async";
      overlay.className = "mobile-creek-motion";
      overlay.style.position = "absolute";
      overlay.style.zIndex = "1";
      overlay.style.inset = "0";
      overlay.style.width = "100%";
      overlay.style.height = "100%";
      overlay.style.objectFit = "cover";
      overlay.style.objectPosition = "center";
      overlay.style.pointerEvents = "none";
      overlay.style.userSelect = "none";
      overlay.style.opacity = "0.24";
      overlay.style.mixBlendMode = "soft-light";
      overlay.style.filter = "saturate(1.08) contrast(1.03) blur(0.45px)";
      overlay.style.transform = "scale(1.025)";

      backdrop.append(overlay);
    })
    .catch(() => {
      // The existing high-resolution static photo remains the fallback.
    });
}
