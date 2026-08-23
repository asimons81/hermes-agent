#!/usr/bin/env python3
"""Find the on-screen cursor in a screenshot by template-free scan:
look for the KDE default cursor shape (white fill + black outline) near
expected coordinates, and report the brightest cluster centroid."""
import sys
from PIL import Image

path = sys.argv[1]
ex, ey = int(sys.argv[2]), int(sys.argv[3])
im = Image.open(path).convert("RGB")
w, h = im.size

best = []
for dx in range(-25, 26):
    for dy in range(-25, 26):
        x, y = ex + dx, ey + dy
        if 0 <= x < w and 0 <= y < h:
            r, g, b = im.getpixel((x, y))
            if r > 230 and g > 230 and b > 230:
                best.append((x, y))

if best:
    cx = sum(p[0] for p in best) / len(best)
    cy = sum(p[1] for p in best) / len(best)
    print(f"bright-cluster near ({ex},{ey}): n={len(best)} centroid=({cx:.0f},{cy:.0f})")
else:
    print(f"no bright cluster near ({ex},{ey})")

# global scan fallback: count pure-white pixels per 40px cell in middle band
from collections import Counter  # noqa: E402

cells = Counter()
for y in range(0, h, 2):
    for x in range(0, w, 2):
        r, g, b = im.getpixel((x, y))
        if r > 240 and g > 240 and b > 240:
            cells[(x // 40, y // 40)] += 1
top = cells.most_common(5)
print("white-cell hotspots (top5):", top)
