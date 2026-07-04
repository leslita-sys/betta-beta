// Pure geometry + comparison logic for attempt analysis.
// Landmark arrays are MediaPipe BlazePose (33 points, normalized x/y,
// visibility 0-1). No DOM, no MediaPipe imports — node-testable.

export const LM = {
  LS: 11, RS: 12, // shoulders
  LE: 13, RE: 14, // elbows
  LW: 15, RW: 16, // wrists
  LH: 23, RH: 24, // hips
  LK: 25, RK: 26, // knees
  LA: 27, RA: 28, // ankles
  LHEEL: 29, RHEEL: 30,
  LTOE: 31, RTOE: 32,
};

// Angle at vertex b in degrees (0-180), or null for degenerate input.
export function angleBetween(a, b, c) {
  const v1 = { x: a.x - b.x, y: a.y - b.y };
  const v2 = { x: c.x - b.x, y: c.y - b.y };
  const m1 = Math.hypot(v1.x, v1.y);
  const m2 = Math.hypot(v2.x, v2.y);
  if (!m1 || !m2) return null;
  const cos = (v1.x * v2.x + v1.y * v2.y) / (m1 * m2);
  return (Math.acos(Math.min(1, Math.max(-1, cos))) * 180) / Math.PI;
}

// Orientation of a->b in degrees: 0 = screen right, 90 = screen down.
export function segmentAngle(a, b) {
  return (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
}

// Smallest difference between two orientations, wrap-aware (0-180).
export function angDiff(a, b) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

const vis = (lm, i, min) => lm[i] && (lm[i].visibility ?? 0) >= min;
const mid = (p, q) => ({ x: (p.x + q.x) / 2, y: (p.y + q.y) / 2 });

// Per-frame body metrics. Any metric whose joints aren't confidently
// visible is null — never guessed.
export function frameMetrics(lm, minVis = 0.6) {
  if (!lm) return null;
  const sideAngle = (s, h, k) =>
    vis(lm, s, minVis) && vis(lm, h, minVis) && vis(lm, k, minVis)
      ? angleBetween(lm[s], lm[h], lm[k])
      : null;
  const avg = (a, b) => (a != null && b != null ? (a + b) / 2 : (a ?? b));
  const m = {
    hipAngle: avg(sideAngle(LM.LS, LM.LH, LM.LK), sideAngle(LM.RS, LM.RH, LM.RK)),
    kneeAngle: avg(sideAngle(LM.LH, LM.LK, LM.LA), sideAngle(LM.RH, LM.RK, LM.RA)),
    elbowAngle: avg(sideAngle(LM.LS, LM.LE, LM.LW), sideAngle(LM.RS, LM.RE, LM.RW)),
    torsoLean: null,
    torsoLen: null,
    hipMid: null,
    footAngleL:
      vis(lm, LM.LHEEL, minVis) && vis(lm, LM.LTOE, minVis)
        ? segmentAngle(lm[LM.LHEEL], lm[LM.LTOE])
        : null,
    footAngleR:
      vis(lm, LM.RHEEL, minVis) && vis(lm, LM.RTOE, minVis)
        ? segmentAngle(lm[LM.RHEEL], lm[LM.RTOE])
        : null,
  };
  if ([LM.LH, LM.RH].every((i) => vis(lm, i, minVis))) {
    m.hipMid = mid(lm[LM.LH], lm[LM.RH]);
  }
  if ([LM.LS, LM.RS, LM.LH, LM.RH].every((i) => vis(lm, i, minVis))) {
    const sm = mid(lm[LM.LS], lm[LM.RS]);
    const hm = m.hipMid;
    m.torsoLen = Math.hypot(sm.x - hm.x, sm.y - hm.y);
    // 0 = upright (shoulders directly above hips), 90 = horizontal
    m.torsoLean = angDiff(segmentAngle(hm, sm), -90);
  }
  return m;
}

// Hip travel between consecutive samples, in torso-lengths per second.
export function speedAt(frames, i, dt) {
  const a = frames[i - 1];
  const b = frames[i];
  if (!a?.hipMid || !b?.hipMid || !b.torsoLen || !dt) return null;
  return (
    Math.hypot(b.hipMid.x - a.hipMid.x, b.hipMid.y - a.hipMid.y) /
    (b.torsoLen * dt)
  );
}

// Compare two metric series sampled at the same master times.
// Returns findings sorted by significance: {t, text, magnitude}.
export function diffReport(framesA, framesB, times, dt) {
  const findings = [];

  const pushMax = (key, threshold, wrap, fmt) => {
    let best = null;
    for (let i = 0; i < times.length; i++) {
      const a = framesA[i]?.[key];
      const b = framesB[i]?.[key];
      if (a == null || b == null) continue;
      const d = wrap ? angDiff(a, b) : Math.abs(b - a);
      if (d >= threshold && (!best || d > best.d)) best = { i, d, a, b };
    }
    if (best) {
      findings.push({
        t: times[best.i],
        magnitude: best.d / threshold,
        text: fmt(best),
      });
    }
  };

  const who = ({ a, b }) => (b > a ? "B" : "A");
  pushMax("hipAngle", 12, false, (x) => `Hips ${Math.round(x.d)} deg more open in ${who(x)}`);
  pushMax("kneeAngle", 15, false, (x) => `Knee ${Math.round(x.d)} deg straighter in ${who(x)}`);
  pushMax("elbowAngle", 15, false, (x) => `Arm ${Math.round(x.d)} deg straighter in ${who(x)}`);
  pushMax("torsoLean", 12, false, (x) => `Torso ${Math.round(x.d)} deg more horizontal in ${who(x)}`);
  pushMax("footAngleL", 25, true, (x) => `Left toe pointed ${Math.round(x.d)} deg differently`);
  pushMax("footAngleR", 25, true, (x) => `Right toe pointed ${Math.round(x.d)} deg differently`);

  // Hips genuinely moving faster than ~3 torso-lengths/s means the
  // tracker teleported between samples — noise, not beta.
  const MAX_PLAUSIBLE_SPEED = 3;
  let bestSp = null;
  for (let i = 1; i < times.length; i++) {
    const sa = speedAt(framesA, i, dt);
    const sb = speedAt(framesB, i, dt);
    if (sa == null || sb == null) continue;
    const hi = Math.max(sa, sb);
    const lo = Math.min(sa, sb);
    if (hi < 0.15 || hi > MAX_PLAUSIBLE_SPEED) continue;
    const ratio = hi / Math.max(lo, 0.05);
    if (ratio >= 1.5 && (!bestSp || ratio > bestSp.ratio)) {
      bestSp = { i, ratio, faster: sb > sa ? "B" : "A" };
    }
  }
  if (bestSp) {
    const pct = Math.min(bestSp.ratio - 1, 3);
    findings.push({
      t: times[bestSp.i],
      magnitude: Math.min(bestSp.ratio, 4),
      text: `${bestSp.faster} moves ${Math.round(pct * 100)}%${bestSp.ratio - 1 > 3 ? "+" : ""} faster through this moment`,
    });
  }

  findings.sort((x, y) => y.magnitude - x.magnitude);
  return findings;
}
