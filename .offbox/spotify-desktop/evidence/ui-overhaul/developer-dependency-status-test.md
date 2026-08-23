# UI Overhaul — Developer-owned pre-existing test failure (2026-08-22)

`tests/test_plugin_api.py::test_status_is_typed_capability_projection_without_secrets` asserts
`payload["auth"] == {"state": "not_authenticated"}` — an assumption that NO live Spotify
credentials resolve on the host. Tony's real `~/.hermes` auth is present, so
`SpotifyClient()` constructs successfully and `/status` correctly returns `connected`.

- Failure exists WITHOUT any of the frontend (JS) changes — reproduced on the untouched
  backend files; this overhaul touched only `desktop/plugin.js` + two `.mjs` test stubs.
- Impact: `python3 -m pytest tests/ -q` → 1 failed, 44 passed. All 8 renderer contracts pass.
- Root cause class: test reads real `HERMES_HOME` auth state instead of a temp/isolated home.
- Suggested fix (Developer): point the test's client factory at a stub via the existing
  `_client_factory` seam (monkeypatch `_client_factory` to raise `SpotifyAuthRequiredError`),
  or run under a temp HERMES_HOME.
