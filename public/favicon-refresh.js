const ICON_ID = "stabilize-live-tab-icon";
const ICON_HREF = "/stabilize-tab-20260805-32.png?refresh=20260805-8";

function installTabIcon() {
  document.getElementById(ICON_ID)?.remove();
  const icon = document.createElement("link");
  icon.id = ICON_ID;
  icon.rel = "icon";
  icon.type = "image/png";
  icon.sizes = "32x32";
  icon.href = ICON_HREF;
  document.head.append(icon);
}

installTabIcon();
window.addEventListener("pageshow", installTabIcon, { once: true });

// Load the single-scene native 4K mobile background outside the older
// responsive background generator so iOS pinch zoom cannot reveal or swap
// between the lake, masked-creek canvas, and composite video layers.
import("/mobile-single-scene-4k-20260811.js?v=20260811-2").catch(() => {});
