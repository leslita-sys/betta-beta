# I'm Titi — Climbing Attempt Comparison App
**Date:** 2026-07-02 **Status:** Design approved in conversation; pending spec review
## Problem
Leslie's bouldering group climbs at their limit in Squamish, where every attempt matters. They film attempts and review footage to find beta differences ("her hips are more out here", "your toe is pointed in a different direction"), but comparing videos means flipping between clips in the camera roll, losing the moment, and sometimes not realizing they already had send footage until days later. They need a fast way to compare two attempts side by side, at the crag, mid-session.
## Solution
A single-page, phone-first web app: pick two attempt videos from the camera roll, sync them to a common moment, and watch them play side by side in locked sync with optional pose-skeleton overlays. The human eye finds the differences; the app makes them visible.
## Core decisions (made during brainstorming)
- **Crag-first**: must work on phones with weak/no cell signal. Everything runs on-device.
  
- **Output = synced side-by-side + skeletons**: no auto-computed diff callouts, no AI analysis. Eyes do the judging. (Chosen over auto-diff callouts for reliability.)
  
- **Bring-your-own-video**: videos stay on the phone (the group already shares footage via a shared iCloud album). No uploads, no storage, no auth, no Supabase. Maximum privacy, zero upload wait.
  
- **Approach A — synced dual player**: single sync point per video, locked playback. (Ghost overlay and multi-point time-warping deferred to v2.)
  
## User flow
1. **Load** — two drop zones, Attempt A and Attempt B; tap to pick a video from the camera roll (`<input accept="video/*">`).
  
2. **Sync** — for each video, scrub to the same reference moment (e.g., "both hands on the start holds") and tap "Set sync point".
  
3. **Compare** — locked-sync playback. Shared transport controls:
  
  - Play/pause (both videos together)
    
  - Speed: 1×, 0.5×, 0.25×
    
  - Frame-step forward/back
    
  - Shared scrub bar aligned on the sync point
    
4. **Skeletons** — per-video toggle for MediaPipe pose overlay (joints + limbs drawn on canvas over the video).
  
5. **Swap** — replace either video with one tap, keeping the other loaded, to cycle multiple fails against one send.
  
## Architecture
Same proven pattern as SWANGSHOT / SwingLab:

- **One** `index.html` — vanilla JS, no build step, no framework. CSS/JS inline.
  
- `start.sh` — serves locally at `http://localhost:4325`.
  
- **Deploy** — the same folder ships to Render as a static site, unchanged.
  
- **PWA** — `manifest.json` + a small service worker caching the app shell and the MediaPipe model/wasm, so the app loads at the crag with zero signal after first open on wifi.
  
### Component 1: Video engine
- Two `<video>` elements fed by object URLs from the file picker. Videos never leave the device.
  
- Each video stores a `syncTime`. A master clock drives both: `video.currentTime = masterTime + (video.syncTime - referenceSyncTime)`.
  
- Frame-stepping via `requestVideoFrameCallback` where available; fallback to fixed small time increments (~1/30 s).
  
- Sync is time-based, not frame-based, so mismatched frame rates between phones just work.
  
### Component 2: Pose overlay
- MediaPipe Tasks Vision `PoseLandmarker` in video mode (same library as SWANGSHOT).
  
- One `<canvas>` overlay per video; landmarks computed for the displayed frame and drawn as a skeleton.
  
- Pose runs **only while the overlay toggle is on** (battery at the crag).
  
- Landmark confidence threshold: occluded limbs (hand behind a hold, body against the wall) drop out instead of drawing garbage.
  
- Pose runs at display resolution, not source resolution (4K videos on older phones).
  
- Overlay failure never blocks playback — if no person is detected, nothing is drawn.
  
### Component 3: Layout & controls
- Portrait phone: videos stacked vertically with the shared control bar between them.
  
- Landscape / desktop: side by side.
  
- Per-video controls: replace, skeleton toggle, set-sync-point.
  
- Videos letterboxed to fit their pane regardless of resolution/orientation.
  
## Error handling
| Case | Behavior |
| --- | --- |
| Different resolutions / orientations / fps | Letterbox per pane; time-based sync unaffected |
| One video shorter after alignment | Freeze on first/last frame, keep playing the other |
| Pose finds no person | Draw nothing that frame; playback unaffected |
| Non-video or unsupported codec picked | Friendly inline error on that pane, other pane untouched |
| MediaPipe model fails to load (offline before first cache) | Skeleton toggle disabled with explanation; player fully functional |
## Testing plan
1. Build locally, load Leslie's two real attempts of The Fuzz (fail + send).
  
2. Verify: sync-point workflow, locked playback at all speeds, frame-stepping through the crux, skeleton quality on real climbing footage (forest background, pads, climber partially occluded by roof).
  
3. Tune: landmark confidence threshold, skeleton colors/line weight against granite, control sizes for chalky thumbs.
  
4. Screenshot results for Leslie's review; iterate on feedback.
  
5. Later: deploy to Render, verify PWA offline behavior by airplane-mode reload.
  
## Out of scope for v1
- Auto-computed angle/speed difference callouts
  
- 3+ video comparison
  
- Ghost overlay (skeleton of attempt A over video of attempt B)
  
- Multi-sync-point time warping
  
- Cloud storage / problem organization / accounts
  
- AI narrative analysis
  
## Success criteria
- At the crag, going from "I just fell" to watching the fail synced against the send takes under a minute.
  
- Frame-stepping through a crux move is smooth and truly synced.
  
- Skeleton overlay is genuinely legible on real Squamish footage — visible micro-differences in hip position, toe direction, and timing.
  
- Friends can use it from a link (Render) without instructions.
