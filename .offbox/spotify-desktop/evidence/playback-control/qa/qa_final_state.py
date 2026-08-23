#!/usr/bin/env python3
"""Final state check: playback must be PAUSED (authorization condition)."""
import json
import subprocess


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
print("port:", PORT)
p = subprocess.run(
    ["curl", "-s", "-m", "10", "-H", f"Authorization: Bearer {tok}",
     f"http://127.0.0.1:{PORT}/api/plugins/spotify-desktop/playback"],
    capture_output=True, text=True)
try:
    d = json.loads(p.stdout)
    print(json.dumps({k: d.get(k) for k in
                      ("ok", "idle", "is_playing", "progress_ms", "shuffle_state")},
                     default=str))
    item = d.get("item") or {}
    print("item:", item.get("name"), "|", [a.get("name") for a in item.get("artists", [])])
    print("PLAYING STATE:", "PLAYING!" if d.get("is_playing") else "PAUSED/IDLE (correct)")
except Exception as e:
    print("ERR", e, p.stdout[:200])
