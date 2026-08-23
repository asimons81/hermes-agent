# Spotify Desktop Plugin — Test Plan

Scope: standalone trusted runtime package only. No Hermes core changes, OAuth implementation, Spotify credentials, renderer Spotify data persistence, in-app playback, voice control, AI/ML paths, or desktop restart.

## Baseline

Before T3 implementation: `node --check desktop/plugin.js`, `node tests/esm-registration.mjs`, `node tests/connection-state.mjs`, `python3 -m pytest -q`, `ruff check .`, `ruff format --check .`, and `python3 -m py_compile dashboard/plugin_api.py` passed. Python suite: 12 passed.

## T2 connection UX regression matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; real-ESM loader | Renderer remains valid ESM with only runtime-loader-safe imports. |
| L2 | `node tests/connection-state.mjs` | Deterministic state mapping and transitions for login-required, connecting, connected, expired/reauth, and disconnected; explicit CTA opens Hermes tool settings while the user runs the existing `hermes auth spotify` CLI flow, then polls status. |
| L2 | `pytest tests/test_deletion_procedure.py` | Deletion helper only targets the declared plugin-owned cache path, is idempotent, and never touches Hermes auth state. |
| L3 | source-boundary assertions in `connection-state.mjs` | Renderer does not serialize tokens, import OAuth helpers, invoke the CLI, or put secret-bearing auth material in storage/URLs. |
| L4 | existing isolated `hermes serve --port 0 --skip-build --isolated` test plus plugin route probe | The mounted plugin still serves the existing status projection from a clean `HERMES_HOME`. |

## T3 renderer and now-playing matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; `node tests/esm-registration.mjs` | Runtime-loader-safe ESM; route, sidebar nav, palette registrations, and disposer remain present. |
| L2 | `node tests/now-playing-state.mjs` | All §10 states render safely; interpolation clamps to duration; seek is bounded; Free, missing-device, and restricted states cannot issue transport mutations; rate-limit polling delay honors retry category. |
| L3 | `node tests/now-playing-state.mjs` source assertions | Every visible renderer string is looked up through `useI18n()`; English/Japanese/Simplified Chinese/Traditional Chinese bundles are registered; attribution and an external Spotify linkback are present; signature accent is not `#1ed760`; no audio/voice/AI/OAuth routes are added. |
| L4 | `env HERMES_HOME=<temporary clean home> hermes serve --port 0 --skip-build --isolated` exercised by `tests/test_isolated_serve.py` | Clean-home plugin API mount and existing typed status projection still work without touching Tony's active desktop session. |

## T5 search, Home, album, and playlist matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; `node tests/content-views.mjs` | Real runtime ESM remains loader-safe; bounded content helpers and content views exist. |
| L2 | `node tests/content-views.mjs`; `pytest tests/test_content_api.py` | Search offsets/page sizes stay within quota bounds; sparse tracks/artists do not require popularity/followers; skeleton/empty/error/retry states and other-owner metadata-only rule are deterministic. |
| L3 | source assertions in `content-views.mjs` | No recommendations/browse/audio features, no Spotify signature accent, and content includes attribution/linkback/original-form artwork contract. |
| L4 | mocked 403/404 `GET /home/recently-played` | Removed recently-played capability reports typed unavailable only; search and playlist capability flags remain enabled. |

Home uses only recently played and user playlists. The already-recorded default Hermes Spotify scope lacks `user-top-read`, so Top shelves deliberately remain an explicit unavailable notice rather than requesting a scope change or building a hidden endpoint dependency.

## T4 device picker and read-only queue matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; `node tests/device-queue.mjs` | Runtime ESM preserves the typed device/queue UI surfaces. |
| L2 | `pytest tests/test_device_queue_api.py`; `node tests/device-queue.mjs` | Devices project current/restricted/capability state; transfer accepts one `device_id`; volume is typed and bounded; queue reads and adds by URI only; Premium/no-device/restricted states disable mutations. |
| L3 | device/queue source assertions | No reorder/remove/clear/drag affordance or unsupported queue endpoint is exposed; Spotify attribution/linkback and original-art boundary remain present. |
| L4 | mocked 429 `GET /queue` + renderer retry-delay contract | `Retry-After` remains typed, QUOTA_EXCEEDED uses throttled controls, and device refresh is deferred rather than retried in a loop. |

The queue panel is a read-only projection of Now Playing and Next up. It never claims to reorder, remove, clear, or drag queue items. Track rows may issue only `POST /queue` using the track URI; backend mutations resynchronize through typed refetches.

## State contract

`GET /status` remains backend-authoritative. Connection maps safe `auth.state` as follows:

- `not_authenticated` -> `login_required`, unless a user selected Disconnect -> `disconnected`.
- `connected` -> `connected`, except immediately after the user invokes the existing Hermes Spotify auth entry point -> `connecting` until the next status poll resolves.
- `expired`, `revoked`, and `reauth_required` (forward-compatible safe values) -> `expired` with a re-auth CTA.
- malformed/failed responses -> `error`; failure strings are never rendered.

The renderer never launches authentication automatically. It may poll `GET /status` after an explicit CTA, but a failed/unauthed state has no automatic re-auth or retry launcher.

## Playback behavior contract

The renderer polls `/playback` only while the page is visible and focused. Its normal cadence is 5s, changing to 15s when hidden/unfocused and to a bounded `retry_after_seconds` delay (or 30s quota delay) after typed API rate-limit categories. It never starts local audio. Progress is interpolated from typed `progress_ms`/`timestamp`, clamped to the item duration, and seek never submits outside `[0, duration_ms]`. Free, no-device, restricted-device, and idle states render informative read-only/empty behavior rather than pretending mutations succeeded. Every transport action resynchronizes playback on completion.

## Data deletion boundary

T2 owns only plugin-scoped non-sensitive presentation state (`selected_device_id`, `layout`, and the in-memory disconnect latch) and the optional future cache directory `$HERMES_HOME/cache/spotify-desktop/`. The existing Hermes Spotify PKCE credentials in `auth.json` are core-owned and intentionally outside the plugin's delete authority. `DATA_DELETION.md` specifies the user-facing action and the idempotent offline erasure helper, with the required <=5-day timeline.

## T6 library and playlist management matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; `node tests/library-playlist.mjs` | Runtime ESM exposes Library filter chips, grid/list preference controls, typed contains paths, and snapshot helpers. |
| L2 | `pytest tests/test_library_playlist_api.py` | Saved tracks/albums/followed artists reads, generic `/me/library` save/unsave, contains checks, owned playlist create/edit/add/remove/reorder, and snapshot-id reuse are mocked end-to-end. |
| L3 | renderer source assertions in `library-playlist.mjs` | Heart state comes from `/library/contains`; external playlists retain metadata-only behavior; no cover-upload scope/surface is introduced. |
| L4 | mutation handlers call a typed refetch callback and defer it for typed rate limits | Mutations resync their surface instead of relying on optimistic stale state; snapshot IDs propagate between playlist item mutations. |

Real-account verification was intentionally not run for T6: this implementation does not inspect existing authorization, prompt for credentials, or log any sensitive value. It therefore remains an explicit T8/manual-account acceptance item.

## T7 attribution, privacy, no-voice, and no-mimicry matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `node --check desktop/plugin.js`; `node tests/esm-registration.mjs` | The runtime plugin remains valid ESM; the Hermes page includes a privacy notice without changing the route/nav/palette contract. |
| L2 | `node tests/compliance.mjs` | Explicit badge, centralized attribution, original-form cover-art, voice default-off, approved name, and user-visible privacy/deletion notices are present. |
| L3 | `node tests/compliance.mjs`; targeted static search | No Spotify signature-green token, Spotify font/SVG/logo-path copy, voice route/command, Web Playback/audio/speech API, AI/ML/analytics/ads/payments/registration implementation, or token flow was introduced. The layout and type remain Hermes-authored. |
| L4 | Isolated plugin ESM render from the registration contract | The rendered page has a distinct Hermes page shell with visible privacy notice and Spotify attribution; no active Desktop is restarted or killed. |

T7 ships `PRIVACY_NOTICE.md`, `DATA_DELETION.md`, and `COMPLIANCE_CHECKLIST.md`. The checklist deliberately records decisions reserved for independent legal/counsel review rather than asserting legal clearance.

## T8 hardening and release-integration matrix

| Layer | Test | Contract proved |
|---|---|---|
| L1 | `ruff check .`, `ruff format --check .`, `python3 -m py_compile dashboard/plugin_api.py`, `node --check desktop/plugin.js` | Standalone backend and real-ESM renderer remain syntactically valid and formatted. |
| L2 | Full Python suite plus all `tests/*.mjs` contracts | Mocked auth, playback, device, queue, content, library, playlist, compliance, capability-degradation, and error-state behavior stays deterministic. |
| L3 | Projection no-leak cases and renderer source-boundary contracts | Tokens/auth state cannot reach API responses or the renderer; no forbidden audio, voice, ML, registration, or core path is introduced. |
| L4 | `tests/test_isolated_serve.py` | A copied plugin is deliberately enabled in a clean `HERMES_HOME`, mounts `/status` in one fresh serve child, mounts again after a second fresh child using the same isolated home, and remains absent when disabled. |

Manual real-account cases (unauthed, Free, Premium/device types, transfer, refresh/relogin, and refresh-expiry) are not simulated with secrets. T8 records whether authenticated existing authorization/device availability exists; without it, each remains a known limitation rather than a claimed PASS.
