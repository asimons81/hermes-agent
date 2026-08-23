# Renderer playback-control repair verification — 2026-08-22

## Scope

P3 changed only the renderer and its renderer contract test:

- `desktop/plugin.js`
- `tests/now-playing-state.mjs`

No Spotify credential/scope changes, no Web Playback SDK/in-app audio work, and no Desktop restart/kill were performed. The available desktop-control adapter reported no running window, so live desktop click-through verification is deliberately deferred to the independent P4 QA child rather than claimed here.

## P1 finding → renderer repair → verification

| P1 finding | Repair | Verification |
|---|---|---|
| A failed Play was surfaced only as a generic disabled offline bar, making Next/Previous appear dead. | `NowPlayingBar.transport()` now clears error state on start, refreshes `/playback` after every successful action, stores the typed error category on failure, and renders an alert with the category-specific Premium/no-device/restricted/rate-limit/offline guidance. Gating remains derived from `playbackUiState`: only the backend-confirmed ready state enables controls. | `tests/now-playing-state.mjs` asserts typed action paths, success refresh, visible alert state, and the existing no-device/restricted/Premium/rate-limit gate matrix. PASS. |
| The bar omitted exposed backend controls for volume, shuffle, and repeat. | Added range volume control plus shuffle and repeat cycle buttons; each invokes the existing typed `/playback/{action}` route. Seek retains clamped milliseconds. | Renderer contract asserts all three typed transport paths; Python API matrix already verifies the exact request bodies for volume/shuffle/repeat. PASS. |
| Search results were metadata links rather than playable tracks; album/playlist tracks needed a consistent user-initiated play control. | `TrackRow` now offers explicit Play and Add to queue actions. Track Play sends `/playback/play` with `uris: [track.uri]`, then requests `/playback`; Search track results now render `TrackRow`, while album/playlist/home already use it. | Renderer contract asserts the URI request and Search → `TrackRow` route. Existing content/library/queue contracts stay green. |
| `selected_device_id` was unused. | Kept Spotify's active-device fallback instead of pretending a stored selection is authoritative. Renderer transport remains gated by the backend playback projection and passes no device ID unless a distinct user action (the existing device picker) chooses one. | P2 live backend evidence confirms an active unrestricted Connect device executes play/pause/next/previous/seek/volume/shuffle/repeat and finishes paused; P4 will validate actual renderer interaction. |

## Test plan and results

| Layer | Command / check | Result |
|---|---|---|
| L1 source/runtime | `node --check desktop/plugin.js` | PASS |
| L2 renderer regression | `node tests/now-playing-state.mjs` | PASS |
| L3 renderer compatibility | `for test in tests/*.mjs; do node "$test"; done` | PASS: 8/8 contracts (attribution, compliance, connection, content, device/queue, ESM registration, library/playlist, now-playing) |
| L4 backend contract regression | `env -u PYTHONPATH python3 -m pytest -q` | PASS: 46 passed in 6.20s |
| L4 live adapter/UI | Computer-use window discovery | BLOCKED: no desktop window was available to the adapter; no live-click claim is made. P4 is the independent live acceptance gate. |

## Compliance check

The renderer continues to use Spotify attribution/linkback and original-form cover-art handling. The existing compliance contract remains green; its forbidden Web Playback/audio/speech checks passed.
