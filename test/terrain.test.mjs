import test from "node:test";
import assert from "node:assert/strict";
import {
  lakeValleyOpening,
  minecraftTerrainHeight,
  modulateTerrain,
  terrainTokenSignal,
} from "../public/terrain.js";
import {
  SCENE_ASSETS,
  selectSceneAsset,
  shouldUsePhotoScene,
} from "../public/photo-scene.js";
import { readFile } from "node:fs/promises";

test("the lake valley opens widest in the center", () => {
  const width = 1_200;
  const center = lakeValleyOpening(width / 2, width);
  const quarter = lakeValleyOpening(width / 4, width);
  const edge = lakeValleyOpening(0, width);

  assert.equal(center, 1);
  assert.ok(center > quarter);
  assert.ok(quarter > edge);
  assert.ok(edge >= 0 && edge <= 1);
});

test("token signals are local, bounded, and deterministic", () => {
  const first = terrainTokenSignal("Take one small step, then stop.");
  const repeated = terrainTokenSignal("Take one small step, then stop.");
  const different = terrainTokenSignal("Rest beside a quiet river.");

  assert.deepEqual(first, repeated);
  assert.notEqual(first.signature, different.signature);
  assert.ok(first.count > 0);
  for (const key of ["elevation", "moisture", "temperature", "wind"]) {
    assert.ok(first[key] >= 0 && first[key] <= 1);
  }

  assert.deepEqual(modulateTerrain(""), terrainTokenSignal(""));
});

test("Minecraft-inspired terrain is deterministic and responds to controls", () => {
  const worldPositions = [-4_000, -250, 0, 725, 9_000];
  const lowControls = {
    seed: 12345,
    offset: 18,
    elevation: 0.15,
    moisture: 0.72,
  };
  const highControls = { ...lowControls, elevation: 0.85 };

  const low = worldPositions.map((worldX) =>
    minecraftTerrainHeight(worldX, 1, lowControls),
  );
  const repeated = worldPositions.map((worldX) =>
    minecraftTerrainHeight(worldX, 1, lowControls),
  );
  const high = worldPositions.map((worldX) =>
    minecraftTerrainHeight(worldX, 1, highControls),
  );

  assert.deepEqual(low, repeated);
  assert.ok(low.every((height) => height >= 0 && height <= 1));
  assert.ok(high.every((height, index) => height > low[index]));
  assert.notDeepEqual(
    low,
    worldPositions.map((worldX) =>
      minecraftTerrainHeight(worldX, 2, {
        ...lowControls,
        offset: 800,
      }),
    ),
  );
});

test("photographic scene assets are responsive and bounded", async () => {
  assert.equal(
    selectSceneAsset({ width: 390, height: 844, pixelRatio: 1.5 }).src,
    "/scenes/lake-valley-portrait-720.webp",
  );
  assert.equal(
    selectSceneAsset({ width: 1440, height: 900, pixelRatio: 1.5 }).src,
    "/scenes/lake-valley-landscape-2560.webp",
  );
  assert.equal(
    selectSceneAsset({ width: 2560, height: 1440, pixelRatio: 2 }).src,
    "/scenes/lake-valley-landscape-3840.webp",
  );

  for (const asset of [...SCENE_ASSETS.landscape, ...SCENE_ASSETS.portrait]) {
    const bytes = await readFile(
      new URL("../public" + asset.src, import.meta.url),
    );
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(bytes.subarray(8, 12).toString("ascii"), "WEBP");
    assert.ok(bytes.byteLength < 600_000);
  }
});

test("reduced-motion and low-power clients retain the procedural fallback", () => {
  const scope = (overrides = {}) => ({
    matchMedia: () => ({ matches: false }),
    navigator: { hardwareConcurrency: 8, deviceMemory: 8, ...overrides },
  });

  assert.equal(shouldUsePhotoScene(scope()), true);
  assert.equal(
    shouldUsePhotoScene({
      ...scope(),
      matchMedia: () => ({ matches: true }),
    }),
    false,
  );
  assert.equal(shouldUsePhotoScene(scope({ hardwareConcurrency: 2 })), false);
  assert.equal(shouldUsePhotoScene(scope({ deviceMemory: 2 })), false);
  assert.equal(
    shouldUsePhotoScene(scope({ connection: { saveData: true } })),
    false,
  );
});
