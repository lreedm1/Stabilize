const STATIC_ONLY_BACKGROUND_QUERY =
  "(max-width: 980px) and (orientation: portrait), (hover: none) and (pointer: coarse), (prefers-reduced-motion: reduce)";
const IDLE_TIMEOUT_MS = 2_000;

let terrainModule = null;
let terrainModulePromise = null;
let latestTerrainValue = "";
let loadScheduled = false;

export function shouldLoadInteractiveBackground(target = globalThis.window) {
  if (!target || typeof target.matchMedia !== "function") return false;
  if (target.navigator?.connection?.saveData === true) return false;
  return !target.matchMedia(STATIC_ONLY_BACKGROUND_QUERY).matches;
}

async function loadInteractiveBackground() {
  if (!shouldLoadInteractiveBackground()) return null;

  if (!terrainModulePromise) {
    terrainModulePromise = import("./terrain.js")
      .then((module) => {
        terrainModule = module;
        if (latestTerrainValue) module.modulateTerrain(latestTerrainValue);
        return module;
      })
      .catch(() => {
        terrainModulePromise = null;
        console.warn("Interactive background unavailable.");
        return null;
      });
  }

  return terrainModulePromise;
}

function scheduleInteractiveBackgroundLoad() {
  if (
    loadScheduled ||
    terrainModulePromise ||
    !shouldLoadInteractiveBackground()
  ) {
    return;
  }

  loadScheduled = true;

  const beginLoad = () => {
    loadScheduled = false;
    void loadInteractiveBackground();
  };

  const queueAfterPageLoad = () => {
    if (typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(beginLoad, { timeout: IDLE_TIMEOUT_MS });
    } else {
      window.setTimeout(beginLoad, 0);
    }
  };

  if (document.readyState === "complete") {
    queueAfterPageLoad();
  } else {
    window.addEventListener("load", queueAfterPageLoad, { once: true });
  }
}

export function modulateTerrain(value) {
  latestTerrainValue = String(value || "");
  if (!shouldLoadInteractiveBackground()) return null;

  if (terrainModule) {
    return terrainModule.modulateTerrain(latestTerrainValue);
  }

  void loadInteractiveBackground();
  return null;
}

if (typeof window !== "undefined") {
  const staticOnlyMedia = window.matchMedia(STATIC_ONLY_BACKGROUND_QUERY);
  const handleMediaChange = (event) => {
    if (!event.matches) scheduleInteractiveBackgroundLoad();
  };

  if (typeof staticOnlyMedia.addEventListener === "function") {
    staticOnlyMedia.addEventListener("change", handleMediaChange);
  } else if (typeof staticOnlyMedia.addListener === "function") {
    staticOnlyMedia.addListener(handleMediaChange);
  }

  scheduleInteractiveBackgroundLoad();
}
