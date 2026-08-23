# Playback-control diagnosis — 2026-08-22

## Scope and method

This is a reproduction/diagnosis pass only. I did not restart or kill Hermes Desktop, alter OAuth credentials/scopes, or enter the Phase-2 Web Playback SDK scope.

The live probe used `FastAPI` `TestClient` over the plugin's actual `dashboard/plugin_api.py`, while running with the Desktop server's global environment (`HOME=/home/tony`, `HERMES_HOME=/home/tony/.hermes`). That exercises the installed Spotify credential/client and the exact API handler without needing to restart the live desktop process. The complete private request/response trace is `live-http-trace.json`. The probe finished with `POST /playback/pause` 200 and final `GET /playback` reporting `is_playing: false`.

Exact command:

```sh
env -u PYTHONPATH HOME=/home/tony HERMES_HOME=/home/tony/.hermes HERMES_PROFILE= \
  python3 scripts/probe_playback_control_live.py
```

## Live state and HTTP trace

At probe time:

- `GET /status` → **200**, `auth.state=connected`; playback capability true.
- `GET /devices` → **200**; one active **Computer** device (`archlinux`, ID redacted here), `is_restricted=false`, `can_transfer=true`, `can_adjust_volume=true`, volume 100. Therefore this was neither a no-device, restricted-device, nor unauthenticated case.
- Initial `GET /playback` → **200**, `idle=false`, item present, `is_playing=true`, and the same active unrestricted device.
- `POST /playback/next` with the active device ID → **200** `{ "ok": true }`.
- `POST /playback/play` with the same valid active device ID → **422** `{ "detail": {"ok": false, "category": "unavailable"} }`.
- `POST /playback/seek` with the current position and valid device ID → **200**.
- `POST /playback/volume` with current volume and valid device ID → **200**.
- `POST /playback/pause` with valid device ID → **200**.
- Final `GET /playback` → **200**, `idle=false`, item/device still present, `is_playing=false`.

This directly falsifies OAuth scope, Premium entitlement, active-device discovery, device restriction, and the core `next`, `seek`, and `volume` call paths as explanations for the observed failure. It proves that the API rejects `play` before any Spotify request despite a usable Premium-capable active device.

## Ranked root causes

### 1. Confirmed: the generic required-argument guard rejects every ordinary `play` request

**Severity:** P1 / direct cause of “you can't play a song”.

`dashboard/plugin_api.py:341-349` constructs the `play` call kwargs with four keys, including optional `position_ms`. `dashboard/plugin_api.py:371-376` then rejects an action if **any** of `position_ms`, `volume_percent`, or `state` is `None`.

For the normal renderer request, `desktop/plugin.js:142` calls `transport('play')` with no body. FastAPI fills `PlaybackRequest.position_ms=None`; the `play` kwargs retain that `None`; and the generic guard returns the observed 422 before `_call()` reaches `SpotifyClient.start_playback`.

The core client signature confirms this is invalid validation at the projection layer, not a Spotify requirement: `plugins/spotify/client.py:146-165` declares `position_ms: Optional[int] = None` for `start_playback` and strips `None` values before issuing the upstream request (`client.py:64-81`). The plugin API and core method keyword names otherwise match exactly:

| API action | plugin API kwargs | core signature | result |
|---|---|---|---|
| play | `device_id`, `context_uri`, `uris`, `position_ms` | same | blocked locally by incorrect guard |
| pause | `device_id` | same | valid |
| next / previous | `device_id` | same | valid; next live-verified |
| seek | `device_id`, `position_ms` | same | valid; live-verified |
| volume | `device_id`, `volume_percent` | same | valid; live-verified |
| shuffle / repeat | `device_id`, `state` | same | names/types align; not live-mutated in this diagnosis pass |

**Falsifiable prediction (confirmed):** a `play` POST with an active valid device and no optional position will return local 422 rather than contact Spotify. The live trace did exactly that.

### 2. Confirmed consequential renderer behavior: a failed Play turns all controls off, making Skip appear dead

**Severity:** P1 user-visible amplification; explains the combined report.

`desktop/plugin.js:141` sets `disabled = !actionAllowed(mode)`, and `actionAllowed` at line 70 permits only `ready`. At line 142, a failed transport turns every unrecognized API error into `category: 'unavailable'`; `playbackUiState` maps that to `offline` at line 69. The result is `disabled=true` for Previous, Play/Pause, Next, and Seek (lines 147-148).

Thus the sequence is deterministic:

1. normal UI Play sends `{}`;
2. backend bug returns 422 `unavailable`;
3. renderer maps the local validation error to `offline`;
4. all controls, including Next, become disabled even though direct `POST /playback/next` succeeds against the same device.

The renderer neither preserves the last good `ready` state nor renders a distinct actionable validation/error message. It swallows the details after changing mode. This is why “skipping tracks doesn't work” can be true in the UI while the actual Spotify next endpoint is healthy.

### 3. Confirmed reliability gap: selected-device storage is declared but not wired into transport

**Severity:** P2 / not the current active-device root cause.

`desktop/plugin.js:18` declares `selected_device_id` in `STORAGE_KEYS`, but its only other storage use is `clearPluginData(storageRef)` (`lines 66, 129, 154`). `NowPlayingBar.transport()` at line 142 sends only the supplied action body and none of the Play/Pause/Next/Previous calls at line 147 supplies `device_id`.

The core client correctly omits a `None` device ID and Spotify can fall back to its active device (`client.py:64-81, 167-192`), so this is not responsible for today's live failure. It does make the UI dependent on Spotify's active-device fallback rather than the chosen device and will produce a 404/no-active-device response if the selected Connect target is not active.

### 4. Error classification is mostly designed correctly but the live 422 is misleading

**Severity:** P2 diagnostic quality.

`plugin_api.py:141-173` maps Spotify 403 restricted errors to `restricted_device`, player 403/404 to `premium_required`/`no_active_device`, and 429 to `rate_limited`/`quota_exceeded`. Existing focused mocked coverage passed for 403 and 429 categories (`tests/test_projection_contract.py:143-168`). The active-device live trace did not exercise a genuine Spotify 403/404/429.

The confirmed defect bypasses this mapping and labels a client-side missing-parameter validation as `unavailable` (line 376), which is indistinguishable in the renderer from a network/outage condition. P2 should keep real upstream categories intact and use a precise, renderer-safe validation contract for malformed action payloads.

## Minimal repair plan

### P2 — backend (`dashboard/plugin_api.py` and focused Python tests)

1. Replace the blanket `any(... is None ...)` guard at lines 371-376 with action-specific required fields:
   - require `position_ms` only for `seek`;
   - require `volume_percent` only for `volume`;
   - require `state` only for `shuffle` and `repeat`;
   - do not require optional `play` fields (`context_uri`, `uris`, `position_ms`).
2. Retain the existing call table and keyword names; they match `SpotifyClient`.
3. Add a red-capable regression test that posts `/playback/play` with `{}` (and with a device ID) using `FakeSpotify`; assert 200 and exact `start_playback` kwargs containing `None` optional values. Add action-specific negative cases for seek/volume/shuffle/repeat that assert 422 without touching the fake client.
4. Extend the `_failure()` tests to cover player-path 404 → `no_active_device` and player 403 text variants, keeping 429 retry metadata. Do not alter auth or scopes.

### P3 — renderer (`desktop/plugin.js` and `tests/now-playing-state.mjs`)

1. On a failed transport, preserve a renderer-visible action error/category rather than collapsing every non-upstream failure to `offline`; only use a state that disables controls when the failure actually means Premium/no-device/restricted/rate-limited/unavailable.
2. Once P2 makes `play` succeed, verify Play → Pause/Next stays `ready` and no 422 can lock the bar. Add a renderer contract test for the error-state transition.
3. Decide and implement one device-targeting policy: either remove the unused `selected_device_id` key or intentionally pass the selected eligible device ID through NowPlayingBar and content mutations. The latter must respect `can_transfer`/restricted status and retain Spotify active-device fallback when no selection exists.
4. Do not attempt in-app audio/Web Playback SDK work.

## Verification performed

| Gate | Result |
|---|---|
| Authorized live TestClient probe, global Desktop environment | completed; evidence saved; playback left paused |
| Focused Python projection/device tests | `9 passed in 0.59s` |
| Renderer now-playing state contract | `PASS: spotify now-playing state contract` |
| Full plugin Python suite | `44 passed, 1 failed`; unrelated test `tests/test_plugin_api.py::test_status_is_typed_capability_projection_without_secrets` assumes no configured credentials, while the required live environment is connected. This diagnosis did not change test or implementation code. |

## Artifacts

- `evidence/playback-control/live-http-trace.json` — private exact HTTP trace (contains the Connect device ID; do not publish it).
- `scripts/probe_playback_control_live.py` — repeatable authorized diagnostic probe; redacts URLs from evidence and always issues a final pause.
