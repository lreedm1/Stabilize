import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

const generatorPath = "scripts/apply-human-aligned-homepage-v1.mjs";

function ensureReplacement(source, oldValue, newValue, label) {
  if (source.includes(newValue)) return source;
  if (!source.includes(oldValue)) {
    throw new Error(`Could not find ${label}`);
  }
  return source.replaceAll(oldValue, newValue);
}

let generator = await readFile(generatorPath, "utf8");
const groundedCopy = [
  [
    "Stabilize adapts to your capacity, remembers only what you approve, and helps you move from conversation to real-world action.",
    "Stabilize adapts to your capacity, keeps memory bounded and deletable, and helps you move from conversation to real-world action.",
    "the product promise",
  ],
  ["Visible memory", "Bounded memory", "the memory trust signal"],
  ["User-chosen goals", "User-chosen direction", "the direction trust signal"],
  ["Memory you control", "Memory with boundaries", "the memory card title"],
  [
    "Important context is stored visibly, with your approval. You can review, correct, disable, export, or delete what Stabilize remembers.",
    "Signed-in chats use condensed context for up to 30 days. You can delete it at any time, and Private chat turns Stabilize memory off.",
    "the memory card description",
  ],
  [
    "The interface and answer become lighter or more detailed depending on what you can handle.",
    "The response becomes lighter or more detailed depending on what you can handle.",
    "the capacity step description",
  ],
  [
    "The system records whether the action worked and adjusts future support.",
    "You can say what worked, what got in the way, or whether the next step needs to be smaller.",
    "the outcome step description",
  ],
];

for (const [oldValue, newValue, label] of groundedCopy) {
  generator = ensureReplacement(generator, oldValue, newValue, label);
}

generator = ensureReplacement(
  generator,
  '  requireText(text, NEW_HEADLINE.replaceAll("?", "\\\\?"), "the headline product regression");',
  '  requireText(text, "A personal AI that helps you steady what matters", "the headline product regression");',
  "the headline regression check",
);
await writeFile(generatorPath, generator);

execFileSync(process.execPath, [generatorPath], { stdio: "inherit" });

const campusPath = "src/uw-madison-chat.js";
let campus = await readFile(campusPath, "utf8");
campus = ensureReplacement(
  campus,
  '<h1 id="seo-heading">Get unstuck.</h1>',
  '<h1 id="seo-heading">A personal AI that helps you steady what matters and take the next useful step.</h1>',
  "the UW headline replacement target",
);
campus = ensureReplacement(
  campus,
  'placeholder="What is happening?"',
  'placeholder="Start with what needs attention"',
  "the UW placeholder replacement target",
);

if (!campus.includes('landing-trust-strip"[\\s\\S]')) {
  const placeholderBlock = `    .replace(
      'placeholder="Start with what needs attention"',
      'placeholder="What is happening at UW–Madison?"',
    );`;
  const compactCampusBlock = `    .replace(
      /<div class="landing-trust-strip"[\\s\\S]*?<\\/div>\\s*/,
      "",
    )
    .replace(
      /<a class="landing-learn-more"[\\s\\S]*?<\\/a>\\s*/,
      "",
    )
    .replace(
      /<section id="why-stabilize"[\\s\\S]*?<\\/section>\\s*<section class="landing-section landing-how"[\\s\\S]*?<\\/section>\\s*/,
      "",
    )
    .replace(
      'placeholder="Start with what needs attention"',
      'placeholder="What is happening at UW–Madison?"',
    );`;
  if (!campus.includes(placeholderBlock)) {
    throw new Error("Could not find the UW compact landing insertion point");
  }
  campus = campus.replace(placeholderBlock, compactCampusBlock);
}
await writeFile(campusPath, campus);

const campusCssPath = "public/uwmadison-chat.css";
let campusCss = await readFile(campusCssPath, "utf8");
const cssMarker = "/* UW compact differentiated landing */";
if (!campusCss.includes(cssMarker)) {
  campusCss += `

${cssMarker}
html[data-campus-chat="uwmadison"] .seo-intro.landing-content {
  width: min(760px, 100%);
  padding: 1px 1px 8px;
}

html[data-campus-chat="uwmadison"] .landing-hero {
  min-height: 0;
  border-radius: 1rem;
  padding: clamp(0.9rem, 3.5vh, 1.6rem) clamp(1rem, 4vw, 2rem);
}

html[data-campus-chat="uwmadison"] .landing-kicker {
  display: none;
}
`;
}
await writeFile(campusCssPath, campusCss);

console.log("Prepared grounded homepage copy and preserved the compact UW–Madison chat.");
