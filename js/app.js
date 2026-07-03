import {
  toVideoTime,
  toMasterTime,
  clamp,
  masterRange,
  inClipRange,
} from "./sync-engine.js";

const $ = (sel, el = document) => el.querySelector(sel);

// ---------- panes ----------

function makePane(key) {
  const el = document.querySelector(`.pane[data-pane="${key}"]`);
  const pane = {
    key,
    el,
    video: $("video", el),
    canvas: $(".overlay", el),
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
    landmarker: null,
    lastDetectedTime: -1,
    needsDetect: false,
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

  return pane;
}

function loadFile(pane, file) {
  if (pane.url) URL.revokeObjectURL(pane.url);
  hideError(pane);
  pane.syncTime = null;
  pane.duration = 0;
  pane.url = URL.createObjectURL(file);
  pane.video.src = pane.url;
  syncModeChanged();
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
  const box = v.getBoundingClientRect();
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
  for (const p of panes) p.video.pause();
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

function clearOverlay(pane) {
  const ctx = pane.canvas.getContext("2d");
  ctx.clearRect(0, 0, pane.canvas.width, pane.canvas.height);
}

async function toggleSkeleton(pane, btn) {
  if (pane.skeletonOn) {
    pane.skeletonOn = false;
    btn.setAttribute("aria-pressed", "false");
    clearOverlay(pane);
    return;
  }
  btn.disabled = true;
  btn.textContent = "Loading";
  try {
    pane.landmarker ??= await createLandmarker();
    pane.skeletonOn = true;
    pane.needsDetect = true;
    btn.setAttribute("aria-pressed", "true");
  } catch (err) {
    showError(
      pane,
      "Skeleton unavailable — the pose model couldn't load (needs internet on first use). Playback still works.",
    );
  } finally {
    btn.disabled = false;
    btn.textContent = "Skeleton";
  }
}

panes.forEach((pane) => {
  $(".skel", pane.el).addEventListener("click", (e) =>
    toggleSkeleton(pane, e.currentTarget),
  );
});

function drawSkeleton(pane, result) {
  const ctx = pane.canvas.getContext("2d");
  const w = parseFloat(pane.canvas.style.width) || 0;
  const h = parseFloat(pane.canvas.style.height) || 0;
  ctx.clearRect(0, 0, w, h);
  const lm = result.landmarks && result.landmarks[0];
  if (!lm) return;
  const color = SKELETON_COLORS[pane.key];
  ctx.lineCap = "round";
  for (const c of visionModule.PoseLandmarker.POSE_CONNECTIONS) {
    const p1 = lm[c.start];
    const p2 = lm[c.end];
    if (p1.visibility < VISIBILITY_MIN || p2.visibility < VISIBILITY_MIN)
      continue;
    // Dark underlay first so lines stay legible on granite and pads.
    ctx.strokeStyle = "rgba(0,0,0,.55)";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
    ctx.stroke();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(p1.x * w, p1.y * h);
    ctx.lineTo(p2.x * w, p2.y * h);
    ctx.stroke();
  }
  ctx.fillStyle = color;
  for (const q of lm) {
    if (q.visibility < VISIBILITY_MIN) continue;
    ctx.beginPath();
    ctx.arc(q.x * w, q.y * h, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}

function overlayLoop() {
  for (const p of panes) {
    if (!p.skeletonOn || !p.landmarker || p.video.readyState < 2) continue;
    const t = p.video.currentTime;
    if (t === p.lastDetectedTime && !p.needsDetect) continue;
    p.lastDetectedTime = t;
    p.needsDetect = false;
    fitCanvas(p);
    const result = p.landmarker.detectForVideo(p.video, performance.now());
    drawSkeleton(p, result);
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

// ---------- offline (PWA) ----------

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    // Offline capability is best-effort; the app works without it.
  });
}
