#!/usr/bin/env python3
"""Read KWin script print() output via journald, filtered to QA markers."""
import subprocess
import sys

marker = sys.argv[1] if len(sys.argv) > 1 else "QA-"
since = sys.argv[2] if len(sys.argv) > 2 else "16:25"
out = subprocess.run(
    ["journalctl", "--user", "--no-pager", "--since", since],
    capture_output=True,
    text=True,
).stdout
for line in out.splitlines():
    if marker in line:
        print(line)
