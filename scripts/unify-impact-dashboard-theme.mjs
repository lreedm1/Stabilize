import { readFile, writeFile } from "node:fs/promises";

const path = "src/impact-dashboard.js";
const before = await readFile(path, "utf8");
let text = before;

const THEME_VERSION = "20260806-unified-site-theme-1";
const THEME_LINK = `<link rel="stylesheet" href="/guides.css?v=${THEME_VERSION}" />`;

function requireText(value, expected, label) {
  if (!value.includes(expected)) {
    throw new Error(`Impact dashboard theme could not find ${label}`);
  }
}

function replaceBlock(value, startMarker, endMarker, replacement, label) {
  const start = value.indexOf(startMarker);
  const end = value.indexOf(endMarker, start + startMarker.length);
  if (start < 0 || end < 0 || end <= start) {
    throw new Error(`Impact dashboard theme could not replace ${label}`);
  }
  return value.slice(0, start) + replacement + value.slice(end + endMarker.length);
}

if ((text.match(new RegExp(THEME_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length < 2) {
  text = text.replaceAll(
    "<title>Stabilize impact dashboard</title><style>",
    `<title>Stabilize impact dashboard</title>${THEME_LINK}<style>`,
  );
}

const loginStart =
  "body{font-family:system-ui,sans-serif;background:#eef3ef;color:#173f31";
const loginEnd = ".error{color:#8a2d2d}";
const loginCss = `:root{color-scheme:dark}body{display:grid;min-height:100vh;min-height:100dvh;place-items:center}.card{width:min(420px,calc(100% - 32px));margin:0;border:var(--stabilize-reading-border);border-radius:18px;background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);padding:24px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}h1{font-size:1.35rem;margin-top:0}p{line-height:1.5}label{display:block;color:var(--stabilize-reading-text);font-weight:700;margin-bottom:7px;text-shadow:var(--stabilize-reading-text-shadow)}input{box-sizing:border-box;width:100%;border:var(--stabilize-reading-border);border-radius:10px;background:var(--stabilize-reading-surface);box-shadow:0 7px 22px rgba(4,13,10,.18);color:var(--stabilize-reading-text);font:inherit;padding:12px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}button{margin-top:12px;border:1px solid rgba(255,254,248,.78);border-radius:10px;background:#1f6f54;color:var(--stabilize-reading-text);cursor:pointer;font:inherit;font-weight:700;padding:11px 16px}.error{color:var(--stabilize-reading-text);font-weight:700}`;
if (text.includes(loginStart)) {
  text = replaceBlock(
    text,
    loginStart,
    loginEnd,
    loginCss,
    "the login-page visual theme",
  );
} else {
  requireText(text, loginCss, "the unified login-page visual theme");
}

const dashboardStart = ":root{color-scheme:light}";
const dashboardEnd =
  "@media(max-width:520px){.shell{width:min(100% - 20px,1040px);margin-top:18px}.top{display:block}.logout{margin-top:12px}.grid{grid-template-columns:1fr}.tile strong{font-size:1.3rem}}";
const dashboardCss = `:root{color-scheme:dark}*{box-sizing:border-box}.shell{width:min(1040px,calc(100% - 32px));margin:32px auto 56px;border:var(--stabilize-reading-border);background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.top{display:flex;gap:20px;align-items:flex-start;justify-content:space-between}.top h1{margin:0 0 6px;font-size:clamp(1.7rem,3vw,2.5rem)}.top p{margin:0;color:var(--stabilize-reading-text)}.logout button{border:var(--stabilize-reading-border);border-radius:9px;background:var(--stabilize-reading-surface);box-shadow:0 7px 22px rgba(4,13,10,.18);color:var(--stabilize-reading-text);cursor:pointer;font:inherit;padding:8px 11px;-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.tile,.panel,.note{border:var(--stabilize-reading-border);background:var(--stabilize-reading-surface);box-shadow:var(--stabilize-reading-shadow);color:var(--stabilize-reading-text);-webkit-backdrop-filter:var(--stabilize-reading-filter);backdrop-filter:var(--stabilize-reading-filter)}.tile,.panel{border-radius:16px}.tile{padding:18px}.tile span{display:block;margin-bottom:7px;color:var(--stabilize-reading-text);font-size:.82rem}.tile strong{display:block;color:var(--stabilize-reading-text);font-size:1.45rem;line-height:1.2}.decision{width:100%;min-width:0;max-width:none;margin:0;padding:19px;border-left:0;text-align:left;justify-self:stretch}.decision h2,.guardrails h2{font-size:1.05rem;margin:0 0 10px}.decision p{font-size:1.1rem;line-height:1.55;margin:0}.guardrails{margin-top:14px;padding:19px}.guardrails ul{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 22px;margin:0;padding-left:20px}.guardrails li{line-height:1.45}.note{margin-top:16px;border-radius:12px;padding:14px;line-height:1.5}.meta{margin-top:14px;color:var(--stabilize-reading-text);font-size:.85rem;text-shadow:var(--stabilize-reading-text-shadow)}@media(max-width:760px){.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.guardrails ul{grid-template-columns:1fr}}@media(max-width:520px){.shell{width:min(100% - 20px,1040px);margin-top:18px;padding:24px 20px}.top{display:block}.logout{margin-top:12px}.grid{grid-template-columns:1fr}.tile strong{font-size:1.3rem}}`;
if (text.includes(dashboardStart)) {
  text = replaceBlock(
    text,
    dashboardStart,
    dashboardEnd,
    dashboardCss,
    "the dashboard visual theme",
  );
} else {
  requireText(text, dashboardCss, "the unified dashboard visual theme");
}

const themeLinkCount = (text.match(
  new RegExp(THEME_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g"),
) || []).length;
if (themeLinkCount !== 2) {
  throw new Error(
    `Impact dashboard theme expected two shared stylesheet links, found ${themeLinkCount}`,
  );
}
for (const expected of [
  "var(--stabilize-reading-surface)",
  "var(--stabilize-reading-text)",
  "var(--stabilize-reading-border)",
  "var(--stabilize-reading-shadow)",
  "var(--stabilize-reading-filter)",
]) {
  requireText(text, expected, expected);
}
for (const obsolete of ["#eef3ef", "#edf3ef", "background:#fff", "color:#173f31"]) {
  if (text.includes(obsolete)) {
    throw new Error(`Impact dashboard theme still contains ${obsolete}`);
  }
}

if (text !== before) await writeFile(path, text);
console.log(
  "Unified the private impact dashboard and aligned the weekly decision panel with the other dashboard sections.",
);
