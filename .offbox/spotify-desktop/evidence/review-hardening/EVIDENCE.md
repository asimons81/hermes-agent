# R1 Review-Hardening Evidence — spotify-desktop

Date: 2026-08-22 · Executor: Orchestrator (direct execution, card t_8ea148ff)
Scope: plugin tree only. No merge/publish/release. Desktop app untouched.

## Findings → changes

### F1 — Projection boundary (dashboard/plugin_api.py)
New renderer-safe projectors following the existing `_track`/`_artist`/
`_device`/`_playback` pattern: `_page(items projector)`, `_album_summary`,
 `_album_detail`, `_playlist_summary`, `_playlist_detail`,
`_playlist_track_entry`, `_external_urls`, `_search_results`, `_library_item`.
Rewired endpoints: `/search`, `/albums/{id}`, `/library/{kind}`,
`/playlists`, `GET/POST /playlists/{id}` (detail + create). Raw catalog fields
(popularity, available_markets, followers, copyrights, genres) verified absent
from responses by regression test.

### F2 — Playback validation
`PlaybackRequest` now strict: `StrictBool | Literal["off","context","track"]`
state, `StrictInt` position/volume with 0–100 bound on volume,
`extra="forbid"`. New `_validate_playback_body()` runs BEFORE client
construction: shuffle bool-only, repeat enum-only, seek requires int ≥ 0,
volume requires int 0–100, play rejects context_uri+uris combos and
non-spotify: URIs. Wrong-typed values fail at pydantic parse (also pre-client).

### F3 — Stateless capability probe
`_CAPABILITIES[body.feature] = available` mutation REMOVED from
`capability_probe`. Probe result is per-request only; module-level capability
map is now a static declaration no endpoint can mutate.

### F4 — Honest /status
Verified `SpotifyClient.__init__` only resolves/refreshes stored credentials —
zero network I/O (`hermes-agent/plugins/spotify/client.py`). `/status` no
longer reports verified "connected": now returns
`auth.state="credentials_available", auth.verified=false` with explanatory
detail; no API polling added. Renderer `connectionState()` maps
`credentials_available` to the usable connected state (genuine 401s still
surface via data calls).

### F5 — Repo surface (.gitignore)
Added `.gitignore`: excludes `__pycache__/`, bytecode, tool caches
(`.pytest_cache/`, `.ruff_cache/`, etc.), `evidence/`, `*EVIDENCE.md`,
`TEST_PLAN.md`, `IDEA.md`, editor/OS noise. Verified via `git add -A -n`
dry-run in a throwaway repo (removed after): exactly 31 files would commit —
source, tests, manifest, README, compliance docs, scripts, .gitignore.

### F6 — README.md
Documents purpose, architecture, Hermes-Spotify auth dependency, /status
semantics, Premium limitations, feature/endpoint table, strict validation
rules, dev/test commands (Hermes venv python + node), privacy/local storage,
disconnect behavior, compliance constraints, committed-surface definition.

## Small quality fixes (no broad refactor)
- Removed dead `_coerce_position` helper before it ever shipped.
- Capability probe: validate-before-use ordering fixed (was use-then-validate).
- Uniform typed 422 body (`Failure.model_dump()`) for playback validation.
- Renderer: no new state-machine phases introduced.

## Verification (Hermes runtime toolchain)
- venv: `/home/tony/.hermes/hermes-agent/venv/bin/python3` (Python 3.11.15),
  node v22.22.3, ruff 0.16.0 — NOT system python.
- pytest: **55 passed** (46 pre-existing incl. updated contract +
  9 new `tests/test_review_hardening.py` regressions).
- Node contracts: **9/9 PASS** (incl. new `credentials_available` mapping in
  connection-state.mjs).
- ruff: All checks passed (dashboard/ + tests/).
- py_compile: OK. manifest.json: valid JSON, identity stable.
- Isolated Desktop check: `test_isolated_serve.py` PASSED — real
  `hermes serve --isolated` mounted the plugin at
  `/api/plugins/spotify-desktop/status` (200 enabled / 404 disabled).
- Test-file edits to pre-existing tests: one assertion updated to the uniform
  422 body shape (documented above); all other green runs are unmodified tests.

## Deferred / notes
- No live Spotify API calls made or needed for this pass (mocked contracts).
- Merge into the Hermes Desktop repo is Tony's gate — NOT done.
- Card t_8ea148ff closed manually (dispatcher respawn loop aborted on empty
  responses; orchestrator executed directly).
