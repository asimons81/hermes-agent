# P4-R2 — QA re-verification of F1/F2 after renderer repair (t_10f976cb)

Run 55 · frontend profile · 2026-08-22 ~18:48–19:33 CDT · Verdict: **PASS (F1 PASS, F2 PASS)**

Candidate: /home/tony/.hermes/plugins/spotify-desktop
- desktop/plugin.js md5 beb4cfc0a6e80468d675fcc52832ab41 (62665 bytes, mtime 17:29 — unchanged from P4-R1's repaired write)
- Live surfaces: Hermes Desktop v0.20.5 (build 953ec66) on KDE Wayland; backend child
  `hermes serve` pid 415537 @ 127.0.0.1:46375; Spotify Premium (device `archlinux`),
  auth connected, transferable/adjustable device.

## Method

Live Music UI driven through the real renderer with native input (xdotool pointer
motion + ydotool clicks; both verified landing via KWin `workspace.cursorPos`).
Every click was a real UI button on the running Electron renderer, followed by a
`GET /playback` and/or `/devices` state probe on the exact backend the renderer
talks to (`/api/plugins/spotify-desktop/*`, session token from `/proc/<pid>/environ`).
Journald scanned for ` 422 ` throughout. Transport bar (Previous/Pause/Next/Shuffle/
Repeat + seek/volume sliders) lives in the fixed page footer, reached by scrolling
the content area (footer y≈838 with album grid open; ≈578 with Home list).

## F1 — every UI playback control takes effect, no 422

All exercised by clicking the rendered transport/controls and confirming state:

| Control | Before → After (live GET /playback) | Result |
|---|---|---|
| Play (Home) | is_playing false→true, progress 0→2602ms (Only In Dreams) | PASS |
| Pause | is_playing true→false, progress froze 9740ms | PASS |
| Play again | false→true, progress resumed 12570ms | PASS |
| Next | The Pretender → Even Flow (queue advance) | PASS |
| Previous | Even Flow → The Pretender | PASS |
| Seek (slider click) | progress 231466ms → 2472ms | PASS |
| Volume (slider) | 43 → 0 → 28 (device volume_percent reflected) | PASS |
| Shuffle | shuffle_state true → false | PASS |
| Add-to-queue (track row) | backend queue gained `Everlong`; UI "Added to queue" | PASS |
| Repeat | button present, state round-trips (off/context/track) | PASS (control) |

- **422 count since re-verification start: 0** (`journalctl --user --since 19:18 | grep -c ' 422 '`).
- One transient `403 premium_required` at 19:20:22 did not reproduce (subsequent
  next/previous/seek/volume all 200); matches the non-reproducing race noted in the
  prior QA verdict. Non-blocking.

## F2 — play from album and playlist through the UI; queue shows added track

- **Playlist**: Library → Playlists → `Play playlist` on "90's Rock & Metal Gym"
  → now-playing changed to "The Pretender" (a track inside that playlist),
  is_playing true. PASS.
- **Album**: Library → Albums → `Play album` on a card → context playback started,
  is_playing true (album context plays its track 1; both album cards exercised). PASS.
- **Queue from track row**: Home → `Add to queue` on "Everlong" row → backend
  `GET /queue` shows `Everlong` appended; UI shows "Added to queue" and the queue
  panel lists it. PASS.

## Final state

Playback PAUSED (is_playing false, idle false, "The Pretender" / Foo Fighters,
shuffle off, volume 28). Screenshot: `final_paused.png`.

## Prior PASS-side criteria (not re-tested)

Renderer repair (P4-R1) touched only desktop/plugin.js (un-stringify REST bodies +
context play / view navigation). It does not affect backend surface, no-device
honesty, v1 regression, or compliance. Confirmed unchanged source (same md5 as
P4-R1's repaired write). No re-test required.

## Environment notes / input caveat

ydotool absolute mousemove wedged this session (cursor pinned 1,1); xdotool motion
(which drives the KWin Wayland pointer) + ydotool button clicks worked reliably,
verified against `workspace.cursorPos` before each action. Hermes window raised via
KWin scripting (keepAbove) and Chrome/Spotify minimized so clicks land on Hermes.

## Evidence (this dir)

- final_paused.png — transport bar + now-playing, paused end state
- transport.png — transport footer with seek/volume sliders, Shuffle/Repeat
- home.png / library.png / albums.png — F1/F2 source views (track rows, playlist
  and album cards with Play playlist / Play album / Add to queue)
- queue_check.png — "Added to queue" feedback on the Everlong row
- r2_drive.py (workspace) — OCR/click/scroll/state driver used for the run
- qcheck.py (workspace) — backend /queue probe (Everlong appended)

## Verdict

F1: PASS — every UI control performs and reflects in now-playing state, 0×422.
F2: PASS — album and playlist play through the UI; queue shows the added track.
