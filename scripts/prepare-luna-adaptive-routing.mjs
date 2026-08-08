import { readFileSync } from "node:fs";
import { applyLunaAdaptiveTransforms } from "./luna-adaptive-routing-transforms.mjs";

const source = readFileSync("src/index.js", "utf8");
if (source.includes('from "./adaptive-model-routing.js"')) {
  applyLunaAdaptiveTransforms("reverse");
  console.log("Prepared the canonical pre-adaptive runtime for legacy generators.");
}
