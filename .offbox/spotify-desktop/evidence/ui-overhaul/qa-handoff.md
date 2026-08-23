# Spotify Plugin UI Overhaul — QA Handoff (2026-08-22, Frontend)

## Scope shipped
- `desktop/plugin.js` — full renderer rewrite (visual system + i18n fix). No backend/API contract changes.
- `tests/esm-registration.mjs`, `tests/now-playing-state.mjs` — stub/contract updates (see below). No assertions weakened.

## Root cause of raw i18n keys (music.title etc.)
Plugin registered FLAT bundles `{'music.title': 'Music'}`, but the SDK resolver
(`i18n/runtime.ts` resolvePath) walks dot-paths into NESTED trees → every key
unresolved → raw keys rendered. Fix: `nestMessages()` expands flat keys to nested
trees at registration; flat authoring table retained for readability.

## Test changes (why they were touched)
1. `esm-registration.mjs` stub returned `{t}` — outdated; real SDK `usePluginI18n(id)`
   IS the t function (verified in `src/i18n/plugin-i18n.ts` AND shipped production
   bundle `dist/assets/i18n-DoQMgbsy.js`). Stub now matches the real contract.
2. `!source.includes('<')` "no JSX" guard false-positives on legal JS (`i < n`, `s < 10`)
   → now `/<[A-Za-z]/` (actual JSX).
3. `now-playing-state.mjs` asserted the OLD flat bundle shape
   (`translations.en['music.title']`) — the very shape that caused the UI bug.
   Now asserts dot-path resolvability (mirrors SDK resolvePath).
4. Page children count 7→6: nav tabs folded into ContentWorkspace. Assertion now
   checks structure contract (header/connection/content/now-playing/privacy) not count.

## Verification evidence
- `evidence/ui-overhaul/before-music-page.png` + `before-ocr.txt` — raw keys visible
  (music.title ×1, connection.checking, playback.open, playback.offline…)
- `evidence/ui-overhaul/after-music-page.png` + `after-ocr.txt` — 0 raw keys;
  proper header/subtitle, Home|Search|Library tabs, DEVICES/QUEUE panels,
  privacy notice, now-playing bar all rendering with theme tokens
- All 8 node contract tests PASS
- Live hot-reload verified in the actual Desktop renderer (fs-watch picked up saves)

## Developer dependency (pre-existing, NOT caused by this work)
See `developer-dependency-status-test.md` — pytest
`test_status_is_typed_capability_projection_without_secrets` fails on hosts with
live Spotify auth because it assumes `not_authenticated`. 1 failed, 44 passed.

## QA suggested checks
1. Music page at /spotify: no raw keys in en/ja/zh/zh-hant (switch app locale)
2. Dark + light theme: all surfaces use --ui-* tokens (no hardcoded colors except
   compliance logo asset)
3. Track rows: cover art, single-line title/artist ellipsis, Explicit badge, Add-to-queue
   states (loading/added/premium/no-device/restricted/rate-limited)
4. Devices panel: active-device highlight, transfer disabled on active, volume slider
   only when can_adjust_volume
5. Queue panel: now-playing + next-up sections, read-only rows
6. Now-playing bar: transport disabled in non-ready states, seek clamped, time readout
7. Responsive: sidebar min 260px column, long titles truncate (no overflow)
