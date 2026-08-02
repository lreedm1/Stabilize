const desktopPhoto = "/scenes/lake-valley-landscape-7680.webp";
const mobileViewport = globalThis.matchMedia?.("(max-width: 980px)");
const mobilePortrait = globalThis.matchMedia?.(
  "(max-width: 980px) and (orientation: portrait)",
);
const reducedMotion = globalThis.matchMedia?.(
  "(prefers-reduced-motion: reduce)",
);
const photo = document.querySelector("#photo-backdrop-image");
const photoBackdrop = document.querySelector("#photo-backdrop");
const responsiveSources = document.querySelectorAll("#photo-backdrop source");

// The lower-resolution animated canvas softened both photo sources. The
// responsive image itself now owns the background at every viewport size.
document.querySelector("#photo-background")?.remove();

let mobileDataPromise;

function loadMobileWoodlandData() {
  mobileDataPromise ??= Promise.all([
    import("/mobile-woodland-0.js"),
    import("/mobile-woodland-1.js"),
    import("/mobile-woodland-2.js"),
    import("/mobile-woodland-3.js"),
  ]).then((parts) => parts.map((part) => part.default).join(""));
  return mobileDataPromise;
}

function showDesktopPhoto() {
  for (const source of responsiveSources) {
    source.setAttribute("type", "image/webp");
    source.setAttribute("srcset", `${desktopPhoto} 7680w`);
    source.setAttribute("sizes", "100vw");
  }

  if (!photo) return;
  photo.src = desktopPhoto;
  photo.srcset = `${desktopPhoto} 7680w`;
  photo.sizes = "100vw";
  photo.decoding = "async";
  photo.loading = "eager";
  photo.fetchPriority = "high";
  photoBackdrop?.classList.remove("is-mobile-woodland");
}

async function showMobileWoodland() {
  if (!photo) return;

  const encoded = await loadMobileWoodlandData();
  if (!mobileViewport?.matches || !mobilePortrait?.matches || reducedMotion?.matches) {
    return;
  }

  // Remove picture sources before setting the image so a responsive source
  // cannot override the mobile-only animated WebP data URL.
  for (const source of responsiveSources) source.remove();
  photo.removeAttribute("srcset");
  photo.removeAttribute("sizes");
  photo.src = `data:image/webp;base64,${encoded}`;
  photo.decoding = "async";
  photo.loading = "eager";
  photo.fetchPriority = "high";
  photoBackdrop?.classList.add("is-mobile-woodland");
}

function applyBackground() {
  if (
    mobileViewport?.matches &&
    mobilePortrait?.matches &&
    !reducedMotion?.matches
  ) {
    showMobileWoodland().catch((error) => {
      console.error("Mobile woodland background failed to load", error);
      showDesktopPhoto();
    });
    return;
  }
  showDesktopPhoto();
}

applyBackground();
mobileViewport?.addEventListener?.("change", applyBackground);
mobilePortrait?.addEventListener?.("change", applyBackground);
reducedMotion?.addEventListener?.("change", applyBackground);
