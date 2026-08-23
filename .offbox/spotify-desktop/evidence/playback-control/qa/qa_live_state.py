#!/usr/bin/env python3
"""QA live state snapshot (read-only): playback, devices, queue against the
live desktop backend child that serves the real UI."""
import json
import os
import urllib.request

BASE = os.environ["QA_BASE"]
TOKEN = os.environ["QA_TOKEN"]


def get(path):
    req = urllib.request.Request(
        BASE + path, headers={"Authorization": "Bearer " + TOKEN}
    )
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, json.loads(r.read().decode())


out = {}
for ep in ("playback", "devices", "queue"):
    try:
        status, body = get("/" + ep)
        out[ep] = {"status": status, "body": body}
    except Exception as exc:  # noqa: BLE001
        out[ep] = {"error": repr(exc)}

print(json.dumps(out, indent=1, default=str)[:6000])
