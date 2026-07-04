# I'm Titi

Side-by-side climbing attempt comparison. Load two videos of the same boulder problem, sync them to a shared moment, and watch them play in lockstep — with optional pose skeletons — to find the beta micro-differences between a fail and a send.

Born at The Fuzz in Squamish, where the send footage sat unwatched in a camera roll for two days because comparing clips by flipping between them is miserable.

## Mental model

- **Attempt** — one video of one try on a problem. Lives on your phone; it is never uploaded anywhere.
- **Sync point** — the same real-world moment marked in each video (e.g., both hands on the start holds). Master time 0.
- **Master timeline** — a shared clock spanning the union of both clips around the sync point. A clip with no footage at the current master time freezes at its edge while the other keeps playing.
- **Skeleton** — MediaPipe pose landmarks drawn over the climber, per pane (lime = Attempt A, cyan = Attempt B). Low-confidence (occluded) limbs are dropped rather than guessed.

Everything runs on-device in the browser. There is no backend, no account, and no video upload — the only network traffic is fetching the app itself and the MediaPipe model, both of which the service worker caches for offline use at the crag.

## Stack

Vanilla JS (ES modules, no build step) · MediaPipe Tasks Vision 0.10.14 (PoseLandmarker) · PWA (service worker + manifest) · `node --test` for the sync math · Render (static site) for hosting

## Getting started

- First time: `bash start.sh` and open http://localhost:4325 — that's the whole setup.
- Tests: `node --test tests/*.mjs` (pure timeline math; everything else is verified in the browser).
- On a phone: open the hosted URL once on wifi, add to home screen — it then works with zero signal.

## Using it at the crag

1. Load Attempt A and Attempt B from the camera roll.
2. In each video, scrub to the same moment and tap "Set sync point".
3. Play, slow-mo (1/2x, 1/4x), or frame-step (-1/+1) — both videos stay locked in sync.
4. Toggle "Skeleton" on either pane to overlay pose landmarks; while paused, hip and knee angle badges show measured degrees.
5. Toggle "Ghost" to draw the OTHER attempt's skeleton on this pane, hip-anchored and torso-scaled, so body-position differences jump out even when camera angles differ.
6. Tap "Analyze" (after syncing) to scan both attempts and get a written list of measured differences — hip angle, knee bend, arm extension, torso lean, toe direction, speed — each tappable to jump both videos to that moment. All computed on-device.
7. Pinch or scroll to zoom either pane (drag to pan, double-tap to reset) — useful for feet, or matching framing between 0.5x and 1x lens clips.
8. "Replace" swaps one video while keeping the other loaded, to cycle fails against a send.

## Repo layout

```
index.html            markup + styles (single page)
js/
  app.js              DOM glue: panes, transport, pose overlay, zoom, analyze, SW registration
  sync-engine.js      pure timeline math (master clock <-> per-video time)
  analysis.js         pure geometry: joint angles, ghost normalization, diff report
tests/
  sync-engine.test.mjs  node --test suite for the sync math
sw.js                 service worker: offline shell + MediaPipe caching
manifest.webmanifest  PWA manifest
icon.svg              app icon
start.sh              local server on http://localhost:4325
docs/superpowers/     design spec, implementation plan, verification screenshots
```

## Help

- App won't load offline? It needs one full visit online first (the service worker caches on first load; skeletons prefetch in the background).
- Skeleton looks wrong? Pose estimation struggles with heavy occlusion (body pressed against the wall). Toggle it off — the synced comparison works without it.
- Bug? Open an issue with the phone model, browser, and a screenshot.
