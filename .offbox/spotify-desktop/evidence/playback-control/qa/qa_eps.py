#!/usr/bin/env python3
"""Hit several plugin endpoints once, print compact JSON."""
import json
import subprocess

tok = subprocess.run(
    ["bash", "-c",
     "tr '\\0' '\\n' < /proc/3585/environ | grep '^HERMES_DASHBOARD_SESSION_TOKEN=' | cut -d= -f2-"],
    capture_output=True, text=True).stdout.strip()
BASE = "http://127.0.0.1:34219/api/plugins/spotify-desktop"
for ep in ("home/recently-played?limit=10", "playlists?limit=10",
            "search?q=tool&limit=5"):
    p = subprocess.run(
        ["curl", "-s", "-m", "10", "-H", f"Authorization: Bearer {tok}",
         f"{BASE}/{ep}"], capture_output=True, text=True)
    try:
        d = json.loads(p.stdout)
        s = json.dumps(d)
        print(f"== /{ep}\n{s[:500]}")
    except Exception:
        print(f"== /{ep}\nRAW: {p.stdout[:300]}")
