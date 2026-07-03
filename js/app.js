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
window.addEventListener("resize", () => panes.forEach(fitCanvas));

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
    if (inClipRange(master.time, clipOf(p))) p.video.play();
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
        p.video.play();
      } else if (Math.abs(p.video.currentTime - expected) > 0.06) {
        p.video.currentTime = expected;
      }
    } else {
      // This clip has no footage here: freeze it at its nearest edge.
      if (!p.video.paused) p.video.pause();
      p.video.currentTime = clamp(
        toVideoTime(master.time, p.syncTime),
        0,
        p.duration,
      );
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
