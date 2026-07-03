import { test } from "node:test";
import assert from "node:assert/strict";
import { toVideoTime, toMasterTime, clamp, masterRange, inClipRange } from "../js/sync-engine.js";

test("toVideoTime maps master 0 to the sync point", () => {
  assert.equal(toVideoTime(0, 12.5), 12.5);
});

test("toVideoTime offsets around the sync point", () => {
  assert.equal(toVideoTime(-2, 12.5), 10.5);
  assert.equal(toVideoTime(3, 12.5), 15.5);
});

test("toMasterTime is the inverse of toVideoTime", () => {
  assert.equal(toMasterTime(15.5, 12.5), 3);
  assert.equal(toMasterTime(toVideoTime(7, 4), 4), 7);
});

test("clamp bounds a value", () => {
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(-1, 0, 10), 0);
  assert.equal(clamp(11, 0, 10), 10);
});

test("masterRange spans the union of both clips", () => {
  // Clip A: 30s long, sync at 10s -> covers master [-10, 20]
  // Clip B: 20s long, sync at 15s -> covers master [-15, 5]
  const range = masterRange([
    { syncTime: 10, duration: 30 },
    { syncTime: 15, duration: 20 },
  ]);
  assert.equal(range.start, -15);
  assert.equal(range.end, 20);
});

test("inClipRange is true only inside the clip's own footage", () => {
  const clip = { syncTime: 10, duration: 30 }; // master [-10, 20]
  assert.equal(inClipRange(0, clip), true);
  assert.equal(inClipRange(-10, clip), true);
  assert.equal(inClipRange(20, clip), true);
  assert.equal(inClipRange(-10.1, clip), false);
  assert.equal(inClipRange(20.1, clip), false);
});
