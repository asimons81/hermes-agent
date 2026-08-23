# P4 QA-L2 Live Acceptance — playback control end-to-end (t_9bb32faa)

Run 50 · QA profile · 2026-08-22 16:42–17:20 CDT · Verdict: **HOLD**

Candidate: /home/tony/.hermes/plugins/spotify-desktop (no VCS)
- desktop/plugin.js md5 89459e9cfa0f1f1a0d6508bcb3a3807d (58822 bytes, mtime 17:02 = QA touch, content identical to P3's 16:09 write)
- dashboard/plugin_api.py (mtime 16:02, P2)
- Live surfaces: Hermes Desktop v0.20.5 (build 953ec66) on KDE Wayland; backend child `hermes serve` (port 40761→42419, respawned by app mid-run); Spotify Premium account (authorized mutations; end state PAUSED, verified).

## Method

Live UI drove via the app's own user pathways: `hermes://open/spotify` deep link
(second-instance argv), KWin DBus window raise, ydotool pointer, spectacle captures,
tesseract/vision OCR. Backend exercised directly over the exact HTTP surface the
renderer's ctx.rest uses (`/api/plugins/spotify-desktop/*` with the backend child's
session token, read from process env for verification only). Two Play-button
failures at 16:58 were live user (Tony) clicks on the same TrackRow Play path.

## F1 — HIGH — Every UI playback control POST fails with 422 (double-stringified body)

- Expected: clicking Play / Pause / Next / Previous / seek / volume / shuffle / repeat /
  Add-to-queue / Transfer in the rendered plugin UI performs the action and now-playing
  state reflects it (card check 1).
- Actual: every mutation from the renderer returns HTTP 422
  `{"detail":[{"type":"model_attributes_type","loc":["body"],"msg":"Input should be a
  valid dictionary or object to extract fields from","input":"{\"uris\":[\"spotify:track:...\"]}"}]}`
  — the body arrives as a JSON *string*, not an object.
- Root cause (3-way verified):
  1. desktop/plugin.js passes pre-stringified bodies in all 7 mutation sites:
     `restRef('/playback/play', { method:'POST', body: JSON.stringify({uris:[track.uri]}) })`
     (TrackRow play/queue, DevicePicker transfer/volume, transport(), HeartButton,
     PlaylistManager, PlaylistCreator).
  2. The Electron bridge (`apps/desktop/electron/main.ts` fetchJson, line ~4816)
     stringifies again: `Buffer.from(JSON.stringify(options.body))` — the SDK contract
     is plain-object bodies.
  3. Reference plugin (bundled kanban api.ts) passes plain objects (`body: {...}`) —
     spotify-desktop deviates from the platform contract.
- Live evidence:
  - journald: 2 real user clicks failed at 16:58:33 and 16:58:58 (qa_422_journald.txt)
    — this is the actual "play a track from search" user path failing end-to-end.
  - QA direct API calls with proper JSON bodies against the same endpoints succeed
    (qa_playback_trace2.json: play-from-search/pause/resume/next/previous/seek/
    volume/shuffle-on+off/queue-add+visible/album-context/playlist-context ALL PASS,
    final state paused).
  - Renderer contract tests stub ctx.rest (tests/*.mjs), so the double-stringify never
    reaches a real bridge — gap between contract tests and the real platform contract.
- Reproduction: open Music page, click any TrackRow Play (device active) → button shows
  typed error state; journald shows `hermes:api ... 422 ... "input":"{\"uris\"...`.
- Severity: HIGH (primary feature fails: all UI playback control dead; backend itself is correct).
- Next owner: P3 renderer repair (frontend/renderer owner). Fix = pass plain object
  bodies (remove JSON.stringify at all 7 sites) OR standardize via a single rest helper;
  add a contract test that fails on pre-stringified bodies (e.g. assert `body` is not a
  string in a stub that mimics the bridge's JSON.stringify semantics).

## F2 — MEDIUM — Album/Playlist views statically unreachable; play-from-album/playlist UI missing

- Expected (card check 2): "Play from an album and a playlist" through the app UI.
- Actual: `setSelection` is only ever called with `null` (1 occurrence); no UI element
  sets view='album'/'playlist'. AlbumView/PlaylistView (which contain TrackRows) are
  dead code. Library playlists/albums render only "Open in Spotify" external links +
  Save. No in-app path plays from an album or playlist context; the renderer never
  sends context_uri at all (only `{uris:[track.uri]}`).
- Backend supports context play (verified live: album + playlist context_uri both
  start correct playback) — the UI simply never offers it.
- Severity: MEDIUM (secondary acceptance criterion of the playback-control feature).
- Next owner: P3 renderer repair (navigation from Library/Search/Home cards into
  AlbumView/PlaylistView, or context Play buttons on album/playlist cards).

## Checks that PASSED

- Backend control surface (direct, authorized): transfer-activate, play-from-search,
  pause, resume, next ×2 (queue-advance verified), previous, seek 30s (progress 30000),
  volume 42/37 (reflected in /devices), shuffle on+off (state round-trips), add-to-queue
  (visible in GET /queue), album-context play (correct album's track 1), playlist-context
  play (playlist track 1), final pause. Trace: qa_playback_trace2.json.
- Now-playing state reflects controls (progress/track/shuffle/device volume all observed).
- No-device honesty (check 3): idle backend returns typed `no_active_device` (404
  category) before any device existed (16:44); renderer maps to honest labels
  ("Open Spotify on a device" / playback.empty) and disables transport (static +
  contract tests; live typed-error path exercised at 16:44/16:58).
- v1 regression (check 4): /status /search /playlists /home/recently-played /devices
  /queue all 200 with correct shapes live; sidebar nav + Music page render; disconnect
  help text + "Disconnect and delete plugin data" present; test suite green.
- Compliance (check 5): attribution visible live (Spotify logo + "Open in Spotify" in
  now-playing footer; qa_ui_active.png). Change scope reconstructed from developer
  session DB: today's plugin_api.py delta is a 12-line validation guard (seek/volume/
  shuffle/repeat required-field 422) — no scope/credential/auth-surface changes, no
  Phase-2 (Web Playback/audio/preview) surfaces (grep 0; capabilities artist_albums/
  preview_url false). All touched files confined to the plugin workspace.
- Test suites: 46/46 Python PASS and 8/8 renderer contracts PASS — in a clean env.
  NOTE: `test_isolated_serve.py` fails (serve exits silently, no READY sentinel) when
  the runner's env carries HERMES_PARENT_PID — the parent-death watchdog kills the
  isolated serve when the short-lived test shell exits. Environmental, not a plugin
  defect; P2's suite should scrub HERMES_PARENT_* in _launch to be runner-independent
  (routed to P2 owner as a Low follow-up).

## Residual notes

- One transient 403 `premium_required` on /playback/previous at 17:08 did not
  reproduce (subsequent previous/next worked); likely Spotify-side race right after
  context switches. Non-blocking.
- GET /playback omits `context.uri` (empty string) even during context playback —
  projection keeps item/album but drops context; cosmetic, noted for P2.
- QA touched desktop/plugin.js at 17:02 (identical bytes, mtime bump) to exercise the
  app's plugin hot-reload door during verification; content md5 unchanged.
- The 2-tab/missing-Library render observed 16:57–16:59 was a pre-hot-reload module
  state in the running app; after reload the page renders all three tabs + full
  now-playing bar. First app start after plugin install may need one reload to pick
  up the current renderer — platform behavior, worth noting to P3 (Low, informational).
- Screen locked at 17:18 (user left); live UI drive ended. All verdict-bearing
  evidence predates the lock.

## Artifacts (this directory)

- qa_422_journald.txt — live 422 failures from real user clicks (16:58)
- qa_playback_trace2.json — full backend control trace (all PASS, ends paused)
- qa_dp1.png / qa_dp2.png — pre-reload Music page render (Home tabs, devices, queue)
- qa_rl3.png / qa_rl5.png — post-reload render with full now-playing bar + tabs
- qa_ui_active.png — active-device UI: archlinux · Current, queue now-playing,
  now-playing footer with attribution (PASS-side evidence)
- qa_eps.py / qa_playback_e2e2.py / qa_probe2.py / qa_final_state.py — QA scripts
  (backend discovery from serve child env + direct control surface)
