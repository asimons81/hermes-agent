#!/usr/bin/env python3
"""Follow-up probes: previous-after-next, volume persistence, context play."""
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
print("port:", PORT)


def call(method, path, body=None, note=""):
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
        data = {"raw": raw[:200]}
    print(f"[{code}] {method} {path} ({note})")
    print("   ", json.dumps(data)[:420])
    return int(code), data


def cur(d):
    i = (d or {}).get("item") or {}
    return i.get("name"), i.get("uri"), d.get("is_playing"), (d.get("context") or {}).get("uri", "")


call("GET", "/playback", note="state-now")
time.sleep(1)

# resume
call("POST", "/playback/play", {}, "resume")
time.sleep(2)
_, d = call("GET", "/playback", note="after-resume")
print("now:", cur(d))

# next twice
call("POST", "/playback/next", {}, "next-1")
time.sleep(2.5)
_, d = call("GET", "/playback", note="after-next1")
print("after next1:", cur(d))
n1 = (d.get("item") or {}).get("id")

call("POST", "/playback/next", {}, "next-2")
time.sleep(2.5)
_, d = call("GET", "/playback", note="after-next2")
print("after next2:", cur(d))

# previous
code, d = call("POST", "/playback/previous", {}, "previous")
time.sleep(2.5)
_, d = call("GET", "/playback", note="after-previous")
print("after previous:", cur(d))

# volume 37
call("POST", "/playback/volume", {"volume_percent": 37}, "volume-37")
time.sleep(2.5)
_, dv = call("GET", "/devices", note="devices-after-volume")
act = next((x for x in dv.get("devices", []) if x.get("is_active")), {})
print("active device volume:", act.get("volume_percent"))

# album context: pick album from a search with unambiguous album
_, al = call("GET", "/search?q=Atrocity%20Exhibition&limit=3&type=album", note="find-album2")
albums = (al.get("results", {}).get("albums", {}) or {}).get("items", [])
print("albums:", [(a.get("name"), a.get("uri")) for a in albums][:3])
if albums:
    auri = albums[0]["uri"]
    call("POST", "/playback/play", {"context_uri": auri}, "play-album")
    time.sleep(3)
    _, d = call("GET", "/playback", note="after-album-play")
    print("after album play:", cur(d))
    print("album match:", (d.get("context") or {}).get("uri") == auri,
          "| item album:", ((d.get("item") or {}).get("album") or {}).get("name"))

# playlist context
_, pl = call("GET", "/playlists?limit=3", note="playlists")
items = (pl.get("page", {}) or {}).get("items", [])
print("playlists:", [(i.get("name"), i.get("uri")) for i in items][:3])
if items:
    puri = items[0]["uri"]
    call("POST", "/playback/play", {"context_uri": puri}, "play-playlist")
    time.sleep(3)
    _, d = call("GET", "/playback", note="after-playlist-play")
    print("after playlist play:", cur(d))
    print("playlist match:", (d.get("context") or {}).get("uri") == puri)

# FINAL pause
call("POST", "/playback/pause", {}, "final-pause")
time.sleep(1.5)
_, d = call("GET", "/playback", note="final")
print("FINAL:", cur(d))
