# Playback-control repair verification

Verified: 2026-08-22T16:05:40-05:00

## Root cause -> repair -> evidence

1. **Normal Play was rejected before Spotify.** `playback_action()` put optional
   `position_ms=None` in the `start_playback()` kwargs, then applied a blanket
   None guard shared with seek, volume, shuffle, and repeat. A valid renderer
   request (`POST /playback/play` with `{}`) therefore returned local 422
   `unavailable` without calling Spotify.

   **Repair:** validation is now action-specific: only seek requires
   `position_ms`, volume requires `volume_percent`, and shuffle/repeat require
   `state`. Play keeps all optional inputs, including a missing `device_id`, so
   the core client's existing `None` stripping preserves Spotify's active-device
   fallback.

   **Regression evidence:**
   `test_playback_actions_preserve_optional_play_fields_and_require_only_action_inputs`
   asserts both default Play fallback and all eight action-to-client calls, then
   asserts invalid required-input requests return 422 before the client is called.

2. **The live action probe did not activate a known eligible device when Spotify
   had no active session.** The initial live probe saw an eligible unrestricted
   Computer device but `GET /playback` returned `idle`; every player mutation
   returned `404 {category: no_active_device}`. This is the expected projected
   category, not an `unavailable` mask.

   **Repair to verification path:** the authorized probe now resolves an active
   playback device first and, when absent, transfers to the first unrestricted
   device with `play=false`; it then sends that `device_id` to every action.
   This exercises the explicit-device boundary while the unit regression covers
   the no-device-id active-device fallback.

   **Live trace:** `live-http-trace.json` records `POST /transfer` 200 followed
   by 200 for Play, Next, Previous, Seek, Volume, Shuffle, Repeat, and Pause.
   It restores shuffle and repeat to their initial values and finishes with
   `GET /playback` reporting `is_playing: false`.

3. **Player error categories must survive the projection boundary.**

   **Repair/guard:** the existing `_failure()` ordering remains intact and its
   regression matrix now explicitly covers player-path 404 -> `no_active_device`.
   The matrix also verifies player 403 Premium -> `premium_required`, restricted
   device -> `restricted_device`, and 429 -> `rate_limited`/`quota_exceeded`
   with retry metadata, while checking that upstream token text is not exposed.

   **Reachability note:** the live device list exposed one unrestricted Computer
   only; a live restricted-device or free-account path was not reachable without
   changing accounts/devices. Those two paths are covered by deterministic
   SpotifyAPIError projection tests. OAuth scopes, credentials, and account
   configuration were not changed.

## Verification table

| Layer | Command / artifact | Result |
|---|---|---|
| L1 | `ruff format --check ...`, `ruff check ...`, `python3 -m py_compile ...` | PASS |
| L2 | `env -u PYTHONPATH python3 -m pytest -q` | PASS: 46 passed |
| L3 | `tests/test_device_queue_api.py` exact API-to-client kwargs; `tests/test_projection_contract.py` failure category matrix | PASS |
| L4 | `env -u PYTHONPATH HOME=/home/tony HERMES_HOME=/home/tony/.hermes HERMES_PROFILE= python3 scripts/probe_playback_control_live.py` | PASS; every playback action 200 after transfer, final playback paused |

The raw trace is local/private because it contains Spotify device and content identifiers; do not publish it.
