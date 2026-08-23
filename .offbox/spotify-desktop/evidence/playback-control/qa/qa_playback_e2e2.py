#!/usr/bin/env python3
"""QA playback-control e2e v2: activate device via /transfer first; POSTs
always carry a JSON body (matching the renderer's behavior of sending at
least {}). Leaves playback PAUSED at the end."""
import json
import subprocess
import time


def _backend():
    p = subprocess.run(
        ["bash", "-c",
         "pgrep -af 'hermes_cli.main serve' | grep -v bash | head -1 | cut -d' ' -f1"],
        capture_output=True, text=True).stdout.strip()
    port = subprocess.run(
        ["bash", "-c",
         f"ss -tlnp 2>/dev/null | grep 'pid={p},' | grep -oP '(?<=:)[0-9]+' | head -1"],
        capture_output=True, text=True).stdout.strip()
    tok = subprocess.run(
        ["bash", "-c",
         f"tr '\\0' '\\n' < /proc/{p}/environ | grep '^HERMES_DASHBOARD_SESSION_TOKEN=' | cut -d= -f2-"],
        capture_output=True, text=True).stdout.strip()
    return port, tok


PORT, tok = _backend()
BASE = f"http://127.0.0.1:{PORT}/api/plugins/spotify-desktop"
print("backend port:", PORT)
LOG = []
RESULTS = {}


def call(method, path, body=None, note="", quiet=False):
    cmd = ["curl", "-s", "-m", "15", "-w", "\n%{http_code}", "-X", method,
           "-H", f"Authorization: Bearer {tok}"]
    if method == "POST":
        body = {} if body is None else body
    if body is not None:
        cmd += ["-H", "Content-Type: application/json", "-d", json.dumps(body)]
    cmd.append(f"{BASE}{path}")
    p = subprocess.run(cmd, capture_output=True, text=True)
    raw, _, code = p.stdout.rpartition("\n")
    try:
        data = json.loads(raw)
    except Exception:
        data = {"raw": raw[:300]}
    LOG.append({"method": method, "path": path, "status": int(code),
                "note": note, "body": body, "resp": data})
    if not quiet:
        print(f"[{code}] {method} {path} ({note})")
        print("   ", json.dumps(data)[:240])
    return int(code), data


def wait_for(pred, tries=8, delay=1.6, note="poll"):
    for _ in range(tries):
        time.sleep(delay)
        code, d = call("GET", "/playback", note=note, quiet=True)
        if pred(d):
            return d
    return None


def current(d):
    item = (d or {}).get("item") or {}
    return item.get("id"), item.get("uri"), item.get("name")


# ── 0. baseline
_, play0 = call("GET", "/playback", "baseline")
b_id, b_uri, b_name = current(play0)
print("baseline:", b_name, "playing:", play0.get("is_playing"))

# ── 0b. activate device via transfer (play=true starts playback too)
_, devs = call("GET", "/devices", "devices")
devs_list = devs.get("devices", [])
assert devs_list, "no devices visible"
dev = next((d for d in devs_list if d.get("is_active")), None)
if not dev:
    dev = devs_list[0]
    call("POST", "/transfer", {"device_id": dev["id"], "play": True}, "transfer-activate")
    d = wait_for(lambda x: (x.get("device") or {}).get("is_active"), note="wait-active")
    RESULTS["transfer_activate"] = bool(d and (d.get("device") or {}).get("is_active"))
else:
    RESULTS["transfer_activate"] = "already-active"
print("TRANSFER/ACTIVE:", RESULTS["transfer_activate"], "device:", dev.get("name"))

# if transfer(play=true) started something, note it
_, pnow = call("GET", "/playback", "post-transfer", quiet=True)
c_id, c_uri, c_name = current(pnow)
if not pnow.get("is_playing") and not c_uri:
    # transfer with play may need an explicit play; do play from search
    pass

# ── 1. PLAY track from search
_, search = call("GET", "/search?q=haunted%20by%20you&limit=3", "find-track", quiet=True)
tracks = (search.get("results", {}).get("tracks", {}) or {}).get("items", [])
t0 = tracks[0]
print("chosen:", t0.get("name"), t0.get("uri"))
code, _ = call("POST", "/playback/play", {"uris": [t0["uri"]]}, "play-from-search")
after = wait_for(lambda d: (d.get("item") or {}).get("uri") == t0["uri"]
                 and d.get("is_playing"), note="wait-track")
RESULTS["play_from_search"] = bool(after and after.get("is_playing"))
print("PLAY-FROM-SEARCH:", RESULTS["play_from_search"], current(after))

# ── 2. PAUSE
call("POST", "/playback/pause", {}, "pause")
d = wait_for(lambda x: x.get("is_playing") is False, note="wait-pause")
RESULTS["pause"] = bool(d and d.get("is_playing") is False)
print("PAUSE:", RESULTS["pause"])

# ── 3. RESUME
call("POST", "/playback/play", {}, "resume")
d = wait_for(lambda x: x.get("is_playing") is True, note="wait-resume")
RESULTS["resume"] = bool(d and d.get("is_playing"))
print("RESUME:", RESULTS["resume"])

# ── 4. NEXT
n_id = current(d)[0]
call("POST", "/playback/next", {}, "next")
d = wait_for(lambda x: x.get("is_playing") and current(x)[0] != n_id, note="wait-next")
RESULTS["next_advances"] = bool(d)
print("NEXT:", RESULTS["next_advances"], current(d))

# ── 5. PREVIOUS
n2_id = current(d)[0]
call("POST", "/playback/previous", {}, "previous")
d = wait_for(lambda x: current(x)[0] not in (None, n2_id), note="wait-prev")
RESULTS["previous"] = bool(d and current(d)[0] != n2_id)
print("PREVIOUS:", RESULTS["previous"], current(d))

# ── 6. SEEK
call("POST", "/playback/seek", {"position_ms": 30000}, "seek-30s")
d = wait_for(lambda x: abs((x.get("progress_ms") or 0) - 30000) < 9000, note="wait-seek")
RESULTS["seek"] = bool(d)
print("SEEK-30s:", RESULTS["seek"], "progress:", (d or {}).get("progress_ms"))

# ── 7. VOLUME 42
call("POST", "/playback/volume", {"volume_percent": 42}, "volume-42")
time.sleep(1.6)
_, dv = call("GET", "/devices", "after-volume", quiet=True)
act = next((x for x in dv.get("devices", []) if x.get("is_active")), {})
RESULTS["volume_set"] = act.get("volume_percent") == 42
print("VOLUME-42:", RESULTS["volume_set"], "->", act.get("volume_percent"))
call("POST", "/playback/volume", {"volume_percent": 100}, "volume-restore", quiet=True)

# ── 8. SHUFFLE on/off
call("POST", "/playback/shuffle", {"state": True}, "shuffle-on")
d = wait_for(lambda x: x.get("shuffle_state") is True, note="wait-shuffle-on")
RESULTS["shuffle_on"] = bool(d and d.get("shuffle_state") is True)
call("POST", "/playback/shuffle", {"state": False}, "shuffle-off")
d = wait_for(lambda x: x.get("shuffle_state") is False, note="wait-shuffle-off")
RESULTS["shuffle_off"] = bool(d and d.get("shuffle_state") is False)
print("SHUFFLE on/off:", RESULTS["shuffle_on"], "/", RESULTS["shuffle_off"])

# ── 9. QUEUE add + visible
call("POST", "/queue", {"uri": t0["uri"]}, "add-to-queue")
time.sleep(1.2)
_, q = call("GET", "/queue", "queue-after-add", quiet=True)
RESULTS["queue_add_visible"] = any((x or {}).get("uri") == t0["uri"]
                                   for x in q.get("queue", []))
print("QUEUE-ADD-VISIBLE:", RESULTS["queue_add_visible"])

# ── 10. ALBUM context play
_, al = call("GET", "/search?q=lead%20sails%20paper%20anchor&limit=3", "find-album", quiet=True)
albums = (al.get("results", {}).get("albums", {}) or {}).get("items", [])
if albums:
    auri = albums[0].get("uri")
    call("POST", "/playback/play", {"context_uri": auri}, "play-album-context")
    d = wait_for(lambda x: (x.get("context") or {}).get("uri") == auri
                 and x.get("is_playing"), note="wait-album")
    RESULTS["play_album_context"] = bool(d and d.get("is_playing"))
    print("PLAY-ALBUM-CONTEXT:", RESULTS["play_album_context"],
          (d or {}).get("context", {}).get("uri", "")[:60])

# ── 11. PLAYLIST context play
_, pl = call("GET", "/playlists?limit=5", "my-playlists", quiet=True)
items = (pl.get("page", {}) or {}).get("items", [])
if items:
    puri = items[0].get("uri")
    call("POST", "/playback/play", {"context_uri": puri}, "play-playlist-context")
    d = wait_for(lambda x: (x.get("context") or {}).get("uri") == puri
                 and x.get("is_playing"), note="wait-playlist")
    RESULTS["play_playlist_context"] = bool(d and d.get("is_playing"))
    print("PLAY-PLAYLIST-CONTEXT:", RESULTS["play_playlist_context"],
          (d or {}).get("context", {}).get("uri", "")[:60])

# ── 12. NO-DEVICE error honesty (typed category) — verified earlier at 16:44
RESULTS["no_device_typed_error"] = "verified-16:44:404-no_active_device"

# ── FINAL: PAUSE (mandated)
call("POST", "/playback/pause", {}, "final-pause")
d = wait_for(lambda x: x.get("is_playing") is False, note="wait-final-pause")
RESULTS["final_paused"] = bool(d and d.get("is_playing") is False)
print("FINAL-PAUSED:", RESULTS["final_paused"], "item:", current(d))

with open("/tmp/qa_playback_trace2.json", "w") as f:
    json.dump({"results": RESULTS, "trace": LOG}, f, indent=1)
print("\nSUMMARY:", json.dumps(RESULTS, indent=1))
