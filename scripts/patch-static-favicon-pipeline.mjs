import { readFile, writeFile } from "node:fs/promises";

const path = "scripts/finalize-full-guest-conversation.mjs";
let source = await readFile(path, "utf8");

if (!source.includes("staticFaviconExpectation")) {
  const smoothDeclaration = `  const smoothExpectation =\n    "/finalize-decision-grade-impact\\\\.mjs && node scripts\\\\/finalize-native-selected-mobile-v24\\\\.mjs && node scripts\\\\/finalize-native-selected-mobile-v24-regressions\\\\.mjs && node scripts\\\\/finalize-mobile-video-handoff-v31\\\\.mjs && node scripts\\\\/finalize-mobile-smooth-v32\\\\.mjs$/";`;
  const staticDeclaration = `  const staticFaviconExpectation =\n    "/finalize-decision-grade-impact\\\\.mjs && node scripts\\\\/finalize-native-selected-mobile-v24\\\\.mjs && node scripts\\\\/finalize-native-selected-mobile-v24-regressions\\\\.mjs && node scripts\\\\/finalize-mobile-video-handoff-v31\\\\.mjs && node scripts\\\\/finalize-mobile-smooth-v32\\\\.mjs && node scripts\\\\/embed-favicon-fallback\\\\.mjs$/";\n${smoothDeclaration}`;
  if (!source.includes(smoothDeclaration)) {
    throw new Error("Could not find the smooth pipeline expectation.");
  }
  source = source.replace(smoothDeclaration, staticDeclaration);

  const smoothReplacement = `  const changedFromSmooth = replaceAll(\n    path,\n    smoothExpectation,\n    fullGuestExpectation,\n  );`;
  const staticReplacement = `  const changedFromStaticFavicon = replaceAll(\n    path,\n    staticFaviconExpectation,\n    fullGuestExpectation,\n  );\n${smoothReplacement}`;
  if (!source.includes(smoothReplacement)) {
    throw new Error("Could not find the smooth replacement.");
  }
  source = source.replace(smoothReplacement, staticReplacement);

  const guard = `    !changedFromSmooth &&`;
  if (!source.includes(guard)) {
    throw new Error("Could not find the pipeline guard.");
  }
  source = source.replace(
    guard,
    `    !changedFromStaticFavicon &&\n${guard}`,
  );

  await writeFile(path, source, "utf8");
}

console.log("Static favicon pipeline compatibility is installed.");
