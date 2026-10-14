// A single chat surface across informational pages.
// The iframe shares same-origin sessionStorage with the full chat page,
// preserving a guest conversation while visitors move between pages.
(() => {
  const embedded = window.self !== window.top;
  if (embedded) {
    document.documentElement.classList.add("stabilize-embedded");
    const apply = () => document.body?.classList.add("stabilize-embedded");
    if (document.body) apply();
    else document.addEventListener("DOMContentLoaded", apply, { once: true });
    return;
  }

  const informationPaths = new Set([
    "/about.html",
    "/privacy.html",
    "/safety.html",
    "/how-it-works.html",
    "/floor-first.html",
    "/sustainability.html",
    "/support.html",
  ]);
  if (!informationPaths.has(window.location.pathname)) return;

  function attach() {
    if (!document.body || document.querySelector(".stabilize-chat-pane")) return;
    document.body.classList.add("stabilize-with-chat");

    const pane = document.createElement("aside");
    pane.className = "stabilize-chat-pane";
    pane.setAttribute("aria-label", "Persistent Stabilize chat");

    const header = document.createElement("div");
    header.className = "stabilize-chat-pane-header";
    const heading = document.createElement("strong");
    heading.textContent = "Stabilize chat";
    const full = document.createElement("a");
    full.href = "/";
    full.textContent = "Full chat";
    header.append(heading, full);

    const frame = document.createElement("iframe");
    frame.className = "stabilize-chat-frame";
    frame.src = "/?embed=1";
    frame.title = "Stabilize chat, continuous between information pages";
    frame.loading = "eager";
    frame.referrerPolicy = "same-origin";
    pane.append(header, frame);
    document.body.appendChild(pane);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", attach, { once: true });
  } else {
    attach();
  }
})();
