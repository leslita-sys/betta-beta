// Pure timeline math for syncing two videos around a shared sync point.
// Master time 0 = the moment marked as the sync point in every video.

export function toVideoTime(masterTime, syncTime) {
  return syncTime + masterTime;
}

export function toMasterTime(videoTime, syncTime) {
  return videoTime - syncTime;
}

export function clamp(t, min, max) {
  return Math.min(Math.max(t, min), max);
}

// Union of all clips on the master timeline: the earliest footage before
// the sync point through the latest footage after it.
export function masterRange(clips) {
  const start = Math.min(...clips.map((c) => -c.syncTime));
  const end = Math.max(...clips.map((c) => c.duration - c.syncTime));
  return { start, end };
}

// Whether a master time falls inside a clip's own footage.
export function inClipRange(masterTime, clip) {
  const t = toVideoTime(masterTime, clip.syncTime);
  return t >= 0 && t <= clip.duration;
}
