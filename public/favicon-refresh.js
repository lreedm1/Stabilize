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
