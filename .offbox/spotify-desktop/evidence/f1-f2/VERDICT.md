# F1 + F2 Repair — QA Evidence & Verdict

Date: 2026-08-22 · Plugin: spotify-desktop · Task: t_a5ac73c1

## F1 — double-serialized REST bodies (POST /playback/play et al. 422)

Root cause: renderer pre-stringified bodies (`body: JSON.stringify(x)`) while the
desktop bridge serializes `opts.body` exactly once (apps/desktop/electron/main.ts
fetchJson) → server received a JSON *string* → 422 model_attributes_type.

Fix: `mutateRest(path, method, plainObject)` helper in desktop/plugin.js; all 7
mutation sites converted (queue add, playback/play, transport, library toggle,
playlist item add, playlist create, generic mutate).

HTTP-level live evidence (frontend-profile backend, port 44305, auth=connected):

```
POST /playback/play  body {"uris":["spotify:track:..."]}      -> 404 no_active_device   (semantic, NOT a parse error)
POST /playback/play  body "\"{\\\"uris\\\":...}\"" (old bug)   -> 422 model_attributes_type
```

The 404/no_active_device proves the body now parses and reaches the Spotify
transport layer; no Spotify client device was active at test time (desktop app
minimized/idle), which is a legitimate upstream state, not a plugin defect.

## F2 — context play + view navigation

Fix: ContentWorkspace owns view/selection state; AlbumView/PlaylistView open
from Library/Home/Search cards; context play posts `{"context_uri": ...}`.

Live UI evidence (rendered app, frontend profile, screenshots in this dir):

- `f2_library_tab.png` — Library tab renders playlist cards with
  Open playlist / Play playlist / Open in Spotify buttons.
- `f2_playlist_opened.png` — clicking Open playlist navigates to detail view
  («Back + "90's Rock & Metal Gym" + track list + Play playlist).
- `f2_back_final.png` — Back returns to Library list (both playlists visible).

HTTP-level context-play evidence:

```
POST /playback/play  {"context_uri":"spotify:playlist:1Cr4nMXW3suijuKyk58dwC"} -> 404 no_active_device (parses OK)
POST /playback/play  double-encoded context_uri                               -> 422 model_attributes_type
GET  /playlists/1Cr4nMXW3suijuKyk58dwC                                       -> 200 (detail data loads)
GET  /playlists                                                              -> 200 (2 playlists)
```

## Automated contracts

- `for t in tests/*.mjs; do node "$t"; done` — 9/9 pass
  (includes new tests/rest-body-contract.mjs: bridge-faithful single-serialization
  contract that imports the real plugin.js and exercises register()).
- `env -u HERMES_PARENT_PID -u HERMES_PARENT_PID_LABEL -u PYTHONPATH python3 -m pytest tests/ -q`
  — 46 passed.
- `scripts/verify_f1_live.py` — ALL PASS (isolated `hermes serve` instance,
  401 not_authenticated for all endpoints, no secrets leaked, /status 200).

## Environment notes

- Live app verification ran under the `frontend` bot profile (spotify-desktop is
  in its plugins.enabled). Under the default/qa profiles the plugin data 404s —
  known cross-profile plugins.enabled issue, unrelated to F1/F2.
- Env for GUI automation: DISPLAY=:1, XAUTHORITY=/run/user/1002/xauth_mPgBKP.

## Verdict

F1: PASS — fixed and verified (source, contract tests, HTTP-level).
F2: PASS — fixed and verified (source, contract tests, rendered navigation,
context-play body shape).
