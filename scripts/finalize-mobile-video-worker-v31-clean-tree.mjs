import { rm, writeFile } from "node:fs/promises";

const workflow = `name: Historical coherent mobile background verifier

on:
  workflow_dispatch:

permissions:
  contents: read

jobs:
  retired:
    runs-on: ubuntu-latest
    steps:
      - name: Explain the canonical verifier
        run: echo 'The active mobile release is verified by verify-mobile-video.yml.'
`;

await Promise.all([
  writeFile(
    ".github/workflows/verify-mobile-background.yml",
    workflow,
    "utf8",
  ),
  writeFile(
    "scripts/verify-coherent-mobile-background-v25.yml",
    workflow,
    "utf8",
  ),
]);

await rm("scripts/finalize-mobile-video-worker-v31-clean-tree.mjs", {
  force: true,
});

console.log("Retired the duplicate coherent-mobile production verifier canonically.");
