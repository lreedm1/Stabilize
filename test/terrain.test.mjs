import test from "node:test";
import assert from "node:assert/strict";
import {
  lakeValleyOpening,
  minecraftTerrainHeight,
  modulateTerrain,
  terrainTokenSignal,
} from "../public/terrain.js";

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
