import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { clampNatureVolume } from "../public/nature-sounds.js";

test("nature sound volume is bounded", () => {
  assert.equal(clampNatureVolume(-2), 0);
  assert.equal(clampNatureVolume(0.45), 0.45);
  assert.equal(clampNatureVolume(4), 1);
  assert.equal(clampNatureVolume("not a number"), 0.36);
});

test("nature audio is synthesized locally and starts only after interaction", async () => {
  const source = await readFile(
    new URL("../public/nature-sounds.js", import.meta.url),
    "utf8",
  );

  assert.match(source, /createBufferSource/);
  assert.match(source, /createBiquadFilter/);
  assert.match(source, /createOscillator/);
  assert.match(source, /visibilitychange/);
  assert.doesNotMatch(source, /fetch\(|new Audio\(|autoplay|Math\.random/);

  const topLevel = source.slice(0, source.indexOf("export function createNatureSoundscape"));
  assert.doesNotMatch(topLevel, /new AudioContextClass/);
});
