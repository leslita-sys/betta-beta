import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LM,
  angleBetween,
  segmentAngle,
  angDiff,
  frameMetrics,
  speedAt,
  diffReport,
} from "../js/analysis.js";

test("angleBetween: right angle and straight line", () => {
  assert.equal(
    Math.round(angleBetween({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })),
    90,
  );
  assert.equal(
    Math.round(angleBetween({ x: -1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 })),
    180,
  );
});

test("angleBetween: degenerate input returns null", () => {
  assert.equal(angleBetween({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }), null);
});

test("segmentAngle: screen-coordinate orientations", () => {
  assert.equal(segmentAngle({ x: 0, y: 0 }, { x: 1, y: 0 }), 0);
  assert.equal(segmentAngle({ x: 0, y: 0 }, { x: 0, y: 1 }), 90);
  assert.equal(segmentAngle({ x: 0, y: 0 }, { x: 0, y: -1 }), -90);
});

test("angDiff wraps around 360", () => {
  assert.equal(angDiff(350, 10), 20);
  assert.equal(angDiff(-90, 90), 180);
  assert.equal(angDiff(0, 0), 0);
});

// Build a 33-landmark array with every point invisible, then place the
// joints a test needs. Screen coords: y grows downward.
function makeBody(points) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0, y: 0, visibility: 0 }));
  for (const [i, x, y] of points) lm[i] = { x, y, visibility: 0.9 };
  return lm;
}

// Upright straight body: shoulders above hips above knees above ankles.
function uprightBody() {
  return makeBody([
    [LM.LS, 0.45, 0.2], [LM.RS, 0.55, 0.2],
    [LM.LH, 0.45, 0.5], [LM.RH, 0.55, 0.5],
    [LM.LK, 0.45, 0.7], [LM.RK, 0.55, 0.7],
    [LM.LA, 0.45, 0.9], [LM.RA, 0.55, 0.9],
  ]);
}

test("frameMetrics: straight upright body", () => {
  const m = frameMetrics(uprightBody());
  assert.equal(Math.round(m.hipAngle), 180);
  assert.equal(Math.round(m.kneeAngle), 180);
  assert.equal(Math.round(m.torsoLean), 0);
  assert.equal(m.elbowAngle, null); // elbows/wrists not visible
  assert.equal(m.footAngleL, null);
  assert.ok(Math.abs(m.hipMid.x - 0.5) < 1e-9);
});

test("frameMetrics: bent hips measured, invisible joints null", () => {
  // Sitting-ish: knees forward of hips -> hip angle ~90
  const lm = makeBody([
    [LM.LS, 0.5, 0.2], [LM.RS, 0.5, 0.2],
    [LM.LH, 0.5, 0.5], [LM.RH, 0.5, 0.5],
    [LM.LK, 0.7, 0.5], [LM.RK, 0.7, 0.5],
  ]);
  const m = frameMetrics(lm);
  assert.equal(Math.round(m.hipAngle), 90);
  assert.equal(m.kneeAngle, null); // ankles invisible
});

test("frameMetrics: null landmarks give null frame", () => {
  assert.equal(frameMetrics(null), null);
});

test("speedAt: hip travel in torso-lengths per second", () => {
  const a = { hipMid: { x: 0.5, y: 0.5 }, torsoLen: 0.2 };
  const b = { hipMid: { x: 0.5, y: 0.4 }, torsoLen: 0.2 };
  // moved 0.1 = half a torso length over 0.5s -> 1 torso-length/s
  assert.ok(Math.abs(speedAt([a, b], 1, 0.5) - 1) < 1e-9);
  assert.equal(speedAt([null, b], 1, 0.5), null);
});

test("diffReport: flags a 30 deg hip difference at the right moment", () => {
  const base = frameMetrics(uprightBody());
  const bent = { ...base, hipAngle: base.hipAngle - 30 };
  const framesA = [base, base, bent];
  const framesB = [base, base, base];
  const findings = diffReport(framesA, framesB, [0, 0.5, 1.0], 0.5);
  const hip = findings.find((f) => f.text.includes("Hips"));
  assert.ok(hip, "expected a hip finding");
  assert.equal(hip.t, 1.0);
  assert.match(hip.text, /30 deg more open in B/);
});

test("diffReport: identical attempts produce no findings", () => {
  const f = frameMetrics(uprightBody());
  const frames = [f, f, f];
  assert.deepEqual(diffReport(frames, frames, [0, 0.5, 1], 0.5), []);
});

test("diffReport: teleporting hip (tracker noise) yields no speed finding", () => {
  const still = { hipMid: { x: 0.5, y: 0.5 }, torsoLen: 0.2 };
  const teleported = { hipMid: { x: 0.5, y: 0.1 }, torsoLen: 0.2 };
  // A's hip jumps 2 torso-lengths in 0.5s (4 tl/s > plausible cap)
  const framesA = [still, teleported];
  const framesB = [still, still];
  const findings = diffReport(framesA, framesB, [0, 0.5], 0.5);
  assert.equal(findings.find((f) => f.text.includes("faster")), undefined);
});
