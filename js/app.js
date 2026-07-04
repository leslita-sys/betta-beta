import {
  toVideoTime,
  toMasterTime,
  clamp,
  masterRange,
  inClipRange,
} from "./sync-engine.js";
import { frameMetrics, diffReport, LM, angleBetween } from "./analysis.js";

const $ = (sel, el = document) => el.querySelector(sel);

// ---------- panes ----------

function makePane(key) {
  const el = document.querySelector(`.pane[data-pane="${key}"]`);
  const pane = {
    key,
    el,
    video: $("video", el),
    canvas: $(".overlay", el),
    layer: $(".zoom-layer", el),
    zoomReset: $(".zoom-reset", el),
    zoom: { s: 1, tx: 0, ty: 0 },
    empty: $(".empty", el),
    errorBox: $(".pane-error", el),
    setup: $(".setup", el),
    soloScrub: $(".solo-scrub", el),
    bar: $(".pane-bar", el),
    fileInput: $(".file", el),
    url: null,
    duration: 0,
    syncTime: null,
    skeletonOn: false,
    ghostOn: false,
    landmarker: null,
    lastLandmarks: null,
    lastDetectedTime: -1,
    needsDetect: false,
    dirty: false,
  };

  const pick = () => pane.fileInput.click();
  $(".pick", el).addEventListener("click", pick);
  $(".replace", el).addEventListener("click", pick);
  pane.fileInput.addEventListener("change", () => {
    const file = pane.fileInput.files[0];
    if (file) loadFile(pane, file);
    pane.fileInput.value = "";
  });

  pane.video.addEventListener("loadedmetadata", () => {
    pane.duration = pane.video.duration;
    pane.empty.classList.add("hidden");
    fitCanvas(pane);
    enterSetup(pane);
  });
  pane.video.addEventListener("error", () => {
    if (!pane.url) return;
    showError(
      pane,
      "Couldn't play this video — the format may be unsupported. Try another clip.",
    );
  });
  pane.video.addEventListener("seeked", () => {
    pane.needsDetect = true;
  });

  pane.soloScrub.addEventListener("input", () => {
    if (!pane.duration) return;
    pane.video.currentTime = (pane.soloScrub.value / 1000) * pane.duration;
  });
  $(".set-sync", el).addEventListener("click", () => {
    pane.syncTime = pane.video.currentTime;
    exitSetup(pane);
    syncModeChanged();
  });
  $(".adjust-sync", el).addEventListener("click", () => {
    pane.syncTime = null;
    enterSetup(pane);
    syncModeChanged();
  });

  setupZoom(pane);
  return pane;
}

function loadFile(pane, file) {
  if (pane.url) URL.revokeObjectURL(pane.url);
  hideError(pane);
  pane.syncTime = null;
  pane.duration = 0;
  resetZoom(pane);
  pane.url = URL.createObjectURL(file);
  pane.video.src = pane.url;
  syncModeChanged();
}

// ---------- zoom & pan (per pane) ----------
// The whole zoom-layer (video + skeleton canvas) transforms together so
// overlays stay registered. Pinch on touch, wheel on desktop, drag to
// pan while zoomed, double-tap or the corner chip to reset.

const ZOOM_MAX = 5;

function applyZoom(pane) {
  const z = pane.zoom;
  const limit = ((z.s - 1) * pane.layer.offsetWidth) / 2;
  const limitY = ((z.s - 1) * pane.layer.offsetHeight) / 2;
  z.tx = clamp(z.tx, -limit, limit);
  z.ty = clamp(z.ty, -limitY, limitY);
  pane.layer.style.transform = `translate(${z.tx}px, ${z.ty}px) scale(${z.s})`;
  pane.zoomReset.textContent = z.s.toFixed(1) + "x";
  pane.zoomReset.classList.toggle("hidden", z.s === 1);
}

function resetZoom(pane) {
  pane.zoom = { s: 1, tx: 0, ty: 0 };
  applyZoom(pane);
}

function zoomBy(pane, factor) {
  const z = pane.zoom;
  const next = clamp(z.s * factor, 1, ZOOM_MAX);
  const ratio = next / z.s;
  z.s = next;
  z.tx *= ratio;
  z.ty *= ratio;
  if (z.s === 1) {
    z.tx = 0;
    z.ty = 0;
  }
  applyZoom(pane);
}

function setupZoom(pane) {
  const vp = pane.el.querySelector(".viewport");
  const pointers = new Map();
  let pinchDist = 0;
  let lastTap = 0;

  pane.zoomReset.addEventListener("click", () => resetZoom(pane));

  vp.addEventListener("wheel", (e) => {
    e.preventDefault();
    zoomBy(pane, Math.pow(1.1, -e.deltaY / 100));
  }, { passive: false });

  vp.addEventListener("dblclick", () => resetZoom(pane));

  vp.addEventListener("pointerdown", (e) => {
    // Double-tap to reset (touch)
    if (e.pointerType === "touch" && pointers.size === 0) {
      const now = performance.now();
      if (now - lastTap < 300) resetZoom(pane);
      lastTap = now;
    }
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
    vp.setPointerCapture(e.pointerId);
  });

  vp.addEventListener("pointermove", (e) => {
    const prev = pointers.get(e.pointerId);
    if (!prev) return;
    const cur = { x: e.clientX, y: e.clientY };
    if (pointers.size === 2) {
      pointers.set(e.pointerId, cur);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) zoomBy(pane, d / pinchDist);
      pinchDist = d;
    } else if (pointers.size === 1 && pane.zoom.s > 1) {
      pane.zoom.tx += cur.x - prev.x;
      pane.zoom.ty += cur.y - prev.y;
      pointers.set(e.pointerId, cur);
      applyZoom(pane);
    }
  });

  const endPointer = (e) => {
    pointers.delete(e.pointerId);
    pinchDist = 0;
  };
  vp.addEventListener("pointerup", endPointer);
  vp.addEventListener("pointercancel", endPointer);
}

function showError(pane, msg) {
  pane.errorBox.textContent = msg;
  pane.errorBox.classList.remove("hidden");
}

function hideError(pane) {
  pane.errorBox.classList.add("hidden");
}

function enterSetup(pane) {
  pane.setup.classList.remove("hidden");
  pane.bar.classList.add("hidden");
  const t = pane.duration ? pane.video.currentTime / pane.duration : 0;
  pane.soloScrub.value = Math.round(t * 1000);
}

function exitSetup(pane) {
  pane.setup.classList.add("hidden");
  pane.bar.classList.remove("hidden");
}

// Canvas sized to the letterboxed video content box (used by the pose overlay).
function fitCanvas(pane) {
  const v = pane.video;
  if (!v.videoWidth) return;
  // offsetWidth/Height ignore CSS transforms, so zoom never skews the fit.
  const box = { width: pane.layer.offsetWidth, height: pane.layer.offsetHeight };
  if (!box.width || !box.height) return;
  const scale = Math.min(box.width / v.videoWidth, box.height / v.videoHeight);
  const w = Math.round(v.videoWidth * scale);
  const h = Math.round(v.videoHeight * scale);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  pane.canvas.width = w * dpr;
  pane.canvas.height = h * dpr;
  pane.canvas.style.width = w + "px";
  pane.canvas.style.height = h + "px";
  pane.canvas.getContext("2d").setTransform(dpr, 0, 0, dpr, 0, 0);
}

const panes = [makePane("A"), makePane("B")];
window.addEventListener("resize", () =>
  panes.forEach((p) => {
    fitCanvas(p);
    p.needsDetect = true; // refit clears the canvas; force a redraw
  }),
);

// ---------- transport ----------

const controls = $("#controls");
const transportHint = $("#transportHint");
const playPauseBtn = $("#playPause");
const masterScrub = $("#masterScrub");
const FRAME_STEP = 1 / 30;

const master = {
  time: 0,
  playing: false,
  speed: 1,
  range: { start: 0, end: 0 },
  raf: 0,
};

const clipOf = (p) => ({ syncTime: p.syncTime, duration: p.duration });
const bothSynced = () =>
  panes.every((p) => p.syncTime != null && p.duration > 0);

function syncModeChanged() {
  pause();
  resetAnalysis();
  if (bothSynced()) {
    master.range = masterRange(panes.map(clipOf));
    controls.classList.remove("hidden");
    transportHint.classList.add("hidden");
    seekAll(0);
  } else {
    controls.classList.add("hidden");
    transportHint.classList.remove("hidden");
  }
}

function seekAll(masterTime) {
  master.time = clamp(masterTime, master.range.start, master.range.end);
  for (const p of panes) {
    p.video.currentTime = clamp(
      toVideoTime(master.time, p.syncTime),
      0,
      p.duration,
    );
  }
  updateScrubUI();
}

function play() {
  if (!bothSynced()) return;
  if (master.time >= master.range.end - 0.01) seekAll(master.range.start);
  master.playing = true;
  playPauseBtn.textContent = "Pause";
  for (const p of panes) {
    p.video.playbackRate = master.speed;
    if (inClipRange(master.time, clipOf(p))) p.video.play().catch(() => {});
  }
  master.raf = requestAnimationFrame(tick);
}

function pause() {
  master.playing = false;
  cancelAnimationFrame(master.raf);
  playPauseBtn.textContent = "Play";
  for (const p of panes) {
    p.video.pause();
    p.needsDetect = true; // redraw overlays: badges show only while paused
  }
}

function tick() {
  if (!master.playing) return;
  const ref = panes.find((p) => !p.video.paused && !p.video.ended);
  if (!ref) {
    pause();
    return;
  }
  master.time = toMasterTime(ref.video.currentTime, ref.syncTime);

  for (const p of panes) {
    if (p === ref) continue;
    if (inClipRange(master.time, clipOf(p))) {
      const expected = toVideoTime(master.time, p.syncTime);
      if (p.video.paused) {
        p.video.currentTime = expected;
        p.video.playbackRate = master.speed;
        p.video.play().catch(() => {});
      } else if (Math.abs(p.video.currentTime - expected) > 0.06) {
        p.video.currentTime = expected;
      }
    } else {
      // This clip has no footage here: freeze it at its nearest edge.
      // Only seek when actually off the edge — re-seeking every frame
      // fires 'seeked' and burns battery re-running pose detection.
      if (!p.video.paused) p.video.pause();
      const pinned = clamp(
        toVideoTime(master.time, p.syncTime),
        0,
        p.duration,
      );
      if (Math.abs(p.video.currentTime - pinned) > 0.001) {
        p.video.currentTime = pinned;
      }
    }
  }

  if (master.time >= master.range.end - 0.01) {
    pause();
  }
  updateScrubUI();
  master.raf = requestAnimationFrame(tick);
}

function step(dir) {
  pause();
  seekAll(master.time + dir * FRAME_STEP);
}

function updateScrubUI() {
  const span = master.range.end - master.range.start;
  if (span <= 0) return;
  masterScrub.value = Math.round(
    ((master.time - master.range.start) / span) * 1000,
  );
}

playPauseBtn.addEventListener("click", () => {
  master.playing ? pause() : play();
});
$("#stepBack").addEventListener("click", () => step(-1));
$("#stepFwd").addEventListener("click", () => step(1));
masterScrub.addEventListener("input", () => {
  pause();
  const span = master.range.end - master.range.start;
  seekAll(master.range.start + (masterScrub.value / 1000) * span);
});
document.querySelectorAll(".speeds button").forEach((btn) => {
  btn.addEventListener("click", () => {
    master.speed = Number(btn.dataset.speed);
    document
      .querySelectorAll(".speeds button")
      .forEach((b) => b.classList.toggle("on", b === btn));
    for (const p of panes) p.video.playbackRate = master.speed;
  });
});
document.addEventListener("keydown", (e) => {
  if (!bothSynced()) return;
  if (e.code === "Space") {
    e.preventDefault();
    master.playing ? pause() : play();
  } else if (e.code === "ArrowLeft") {
    step(-1);
  } else if (e.code === "ArrowRight") {
    step(1);
  }
});

// ---------- pose skeleton overlay ----------

const MEDIAPIPE_WASM =
  "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm";
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/1/pose_landmarker_full.task";
const VISIBILITY_MIN = 0.5;
const SKELETON_COLORS = { A: "#b7ff3f", B: "#3fd6ff" };

let visionModule = null;
let filesetPromise = null;

async function getVision() {
  visionModule ??= await import(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs"
  );
  if (!filesetPromise) {
    filesetPromise = visionModule.FilesetResolver.forVisionTasks(
      MEDIAPIPE_WASM,
    ).catch((err) => {
      filesetPromise = null; // transient failure — allow retry on next toggle
      throw err;
    });
  }
  return { PoseLandmarker: visionModule.PoseLandmarker, fileset: await filesetPromise };
}

async function createLandmarker() {
  const { PoseLandmarker, fileset } = await getVision();
  return PoseLandmarker.createFromOptions(fileset, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: "GPU" },
    runningMode: "VIDEO",
    numPoses: 1,
  });
}

const otherPane = (p) => panes[p === panes[0] ? 1 : 0];

async function togglePose(pane, btn, flag, label, needBoth) {
  if (pane[flag]) {
    pane[flag] = false;
    btn.setAttribute("aria-pressed", "false");
    pane.dirty = true;
    return;
  }
  btn.disabled = true;
  btn.textContent = "Loading";
  try {
    if (needBoth) {
      for (const p of panes) p.landmarker ??= await createLandmarker();
    } else {
      pane.landmarker ??= await createLandmarker();
    }
    pane[flag] = true;
    btn.setAttribute("aria-pressed", "true");
    panes.forEach((p) => {
      p.needsDetect = true;
    });
  } catch (err) {
    showError(
      pane,
      `${label} unavailable — the pose model couldn't load (needs internet on first use). Playback still works.`,
    );
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

panes.forEach((pane) => {
  $(".skel", pane.el).addEventListener("click", (e) =>
    togglePose(pane, e.currentTarget, "skeletonOn", "Skeleton", false),
  );
  $(".ghost", pane.el).addEventListener("click", (e) =>
    togglePose(pane, e.currentTarget, "ghostOn", "Ghost", true),
  );
});

const midVisible = (lm, i, j) =>
  lm[i]?.visibility >= VISIBILITY_MIN && lm[j]?.visibility >= VISIBILITY_MIN
    ? { x: (lm[i].x + lm[j].x) / 2, y: (lm[i].y + lm[j].y) / 2 }
    : null;

// Re-anchor the other attempt's landmarks onto this pane's climber:
// hips aligned, scaled by torso length. Camera position and lens
// (0.5x vs 1x) cancel out, so what remains is body-position difference.
function ghostTransform(src, anchor) {
  const sHip = midVisible(src, LM.LH, LM.RH);
  const aHip = midVisible(anchor, LM.LH, LM.RH);
  const sSh = midVisible(src, LM.LS, LM.RS);
  const aSh = midVisible(anchor, LM.LS, LM.RS);
  if (!sHip || !aHip || !sSh || !aSh) return null;
  const sLen = Math.hypot(sSh.x - sHip.x, sSh.y - sHip.y);
  const aLen = Math.hypot(aSh.x - aHip.x, aSh.y - aHip.y);
  if (sLen < 1e-4) return null;
  const k = aLen / sLen;
  return src.map((q) => ({
    x: aHip.x + (q.x - sHip.x) * k,
    y: aHip.y + (q.y - sHip.y) * k,
    visibility: q.visibility,
  }));
}

function drawBody(ctx, lm, color, w, h, { alpha = 1, dashed = false } = {}) {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([7, 5]);
  for (const c of visionModule.PoseLandmarker.POSE_CONNECTIONS) {
    const p1 = lm[c.start];
    const p2 = lm[c.end];
    if (p1.visibility < VISIBILITY_MIN || p2.visibility < VISIBILITY_MIN)
      continue;
    // Dark underlay first so lines stay legible on granite and pads.
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 6.5;
    ctx.beginPath();
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 3.5;
    ctx.beginPath();
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.fillStyle = color;
  for (const q of lm) {
    if (q.visibility < VISIBILITY_MIN) continue;
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

// Numeric hip/knee angles next to the joints — shown while paused.
function drawBadges(ctx, lm, w, h) {
  const joints = [
    [LM.LH, LM.LS, LM.LK],
    [LM.RH, LM.RS, LM.RK],
    [LM.LK, LM.LH, LM.LA],
    [LM.RK, LM.RH, LM.RA],
  ];
  ctx.save();
  ctx.font = "600 12px -apple-system, 'Segoe UI', sans-serif";
  ctx.textBaseline = "middle";
  for (const [v, a, b] of joints) {
    if ([v, a, b].some((i) => (lm[i]?.visibility ?? 0) < VISIBILITY_MIN))
      continue;
    const ang = angleBetween(lm[a], lm[v], lm[b]);
    if (ang == null) continue;
    const label = Math.round(ang) + "°";
    const x = lm[v].x * w + 9;
    const y = lm[v].y * h - 9;
    const tw = ctx.measureText(label).width;
    ctx.fillStyle = "rgba(0,0,0,.72)";
    ctx.fillRect(x - 3, y - 8, tw + 6, 16);
    ctx.fillStyle = "#ffffff";
    ctx.fillText(label, x, y);
  }
  ctx.restore();
}

function drawPaneOverlay(p) {
  fitCanvas(p);
  const ctx = p.canvas.getContext("2d");
  const w = parseFloat(p.canvas.style.width) || 0;
  const h = parseFloat(p.canvas.style.height) || 0;
  ctx.clearRect(0, 0, w, h);
  const o = otherPane(p);
  if (p.ghostOn && o.lastLandmarks && p.lastLandmarks) {
    const ghost = ghostTransform(o.lastLandmarks, p.lastLandmarks);
    if (ghost)
      drawBody(ctx, ghost, SKELETON_COLORS[o.key], w, h, {
        alpha: 0.65,
        dashed: true,
      });
  }
  if (p.skeletonOn && p.lastLandmarks) {
    drawBody(ctx, p.lastLandmarks, SKELETON_COLORS[p.key], w, h);
    if (!master.playing) drawBadges(ctx, p.lastLandmarks, w, h);
  }
}

function overlayLoop() {
  for (const p of panes) {
    const needed = p.skeletonOn || p.ghostOn || otherPane(p).ghostOn;
    if (!needed || !p.landmarker || p.video.readyState < 2) continue;
    const t = p.video.currentTime;
    if (t === p.lastDetectedTime && !p.needsDetect) continue;
    p.lastDetectedTime = t;
    p.needsDetect = false;
    const res = detectPane(p);
    p.lastLandmarks = (res.landmarks && res.landmarks[0]) || null;
    p.dirty = true;
    otherPane(p).dirty = true;
  }
  for (const p of panes) {
    if (!p.dirty) continue;
    p.dirty = false;
    drawPaneOverlay(p);
  }
  requestAnimationFrame(overlayLoop);
}
overlayLoop();

// Warm the pose stack in the background so skeletons work offline at the
// crag even if nobody toggled them while still on wifi. The service worker
// caches the bundle, wasm, and model as these fetches complete.
async function prefetchPose() {
  // Wait until the service worker controls this page, otherwise the
  // first-visit prefetch bypasses it and nothing lands in the cache.
  if ("serviceWorker" in navigator) {
    try {
      await navigator.serviceWorker.ready;
      if (!navigator.serviceWorker.controller) {
        await new Promise((resolve) => {
          navigator.serviceWorker.addEventListener(
            "controllerchange",
            resolve,
            { once: true },
          );
          setTimeout(resolve, 5000); // fail open — prefetch is best-effort
        });
      }
    } catch {
      // no SW — prefetch still warms the browser HTTP cache
    }
  }
  getVision().catch(() => {});
  fetch(MODEL_URL, { mode: "cors" }).catch(() => {});
}
if ("requestIdleCallback" in window) {
  requestIdleCallback(prefetchPose, { timeout: 10000 });
} else {
  setTimeout(prefetchPose, 3000);
}

// MediaPipe video-mode landmarkers require strictly increasing timestamps;
// route every detect through here.
function detectPane(p) {
  const ts = Math.max(performance.now(), (p._lastTs ?? 0) + 1);
  p._lastTs = ts;
  return p.landmarker.detectForVideo(p.video, ts);
}

// ---------- analyze: measured differences between attempts ----------

const analyzeBtn = $("#analyze");
const analysisBox = $("#analysis");
const analysisStatus = $("#analysisStatus");
const analysisList = $("#analysisList");
const ANALYZE_STEP = 0.5; // seconds of master time between samples
const ANALYZE_MAX_SAMPLES = 24;
let analysisToken = 0;

function resetAnalysis() {
  analysisToken++;
  analysisBox.classList.add("hidden");
  analysisList.innerHTML = "";
  analyzeBtn.disabled = false;
  analyzeBtn.textContent = "Analyze";
}

function seekAndWait(video, t) {
  return new Promise((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      video.removeEventListener("seeked", done);
      resolve();
    };
    video.addEventListener("seeked", done);
    video.currentTime = t;
    setTimeout(done, 1500); // watchdog: never hang the scan on one seek
  });
}

async function runAnalysis() {
  if (!bothSynced()) return;
  const token = ++analysisToken;
  pause();
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = "Analyzing";
  analysisBox.classList.remove("hidden");
  analysisList.innerHTML = "";
  analysisStatus.textContent = "Warming up the pose model";
  try {
    for (const p of panes) p.landmarker ??= await createLandmarker();
    const start = Math.max(...panes.map((p) => -p.syncTime));
    const end = Math.min(...panes.map((p) => p.duration - p.syncTime));
    if (end - start < 1) {
      analysisStatus.textContent =
        "Not enough overlapping footage to analyze — the attempts barely share a time window around the sync point.";
      return;
    }
    const step = Math.max(ANALYZE_STEP, (end - start) / ANALYZE_MAX_SAMPLES);
    const times = [];
    for (let t = start; t <= end; t += step) times.push(t);
    const frames = [[], []];
    for (let i = 0; i < times.length; i++) {
      if (token !== analysisToken) return; // superseded by reset/re-run
      analysisStatus.textContent = `Scanning both attempts: ${i + 1} of ${times.length}`;
      for (let k = 0; k < panes.length; k++) {
        const p = panes[k];
        await seekAndWait(
          p.video,
          clamp(toVideoTime(times[i], p.syncTime), 0, p.duration),
        );
        const res = detectPane(p);
        frames[k].push(frameMetrics(res.landmarks && res.landmarks[0]));
      }
    }
    if (token !== analysisToken) return;
    renderFindings(diffReport(frames[0], frames[1], times, step));
    seekAll(0);
  } catch (err) {
    analysisStatus.textContent =
      "Analysis failed — the pose model couldn't run. Playback still works.";
  } finally {
    if (token === analysisToken) {
      analyzeBtn.disabled = false;
      analyzeBtn.textContent = "Analyze";
    }
  }
}

function renderFindings(findings) {
  analysisList.innerHTML = "";
  if (!findings.length) {
    analysisStatus.textContent =
      "No clear measurable differences — the attempts look close. Try frame-stepping around the crux with skeletons on.";
    return;
  }
  analysisStatus.textContent = `${findings.length} difference${findings.length === 1 ? "" : "s"} found. Tap one to jump both videos there:`;
  for (const f of findings) {
    const li = document.createElement("li");
    const chip = document.createElement("span");
    chip.className = "t";
    chip.textContent =
      (f.t >= 0 ? "+" : "-") + Math.abs(f.t).toFixed(1) + "s";
    const text = document.createElement("span");
    text.textContent = f.text;
    li.append(chip, text);
    li.addEventListener("click", () => {
      pause();
      seekAll(f.t);
    });
    analysisList.append(li);
  }
}

analyzeBtn.addEventListener("click", runAnalysis);

// ---------- offline (PWA) ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Offline capability is best-effort; the app works without it.
  });
}
