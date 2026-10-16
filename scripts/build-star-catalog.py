"""Pack HYG v4.1 CSV into eight little-endian floats per star. No runtime CSV.

Usage: python3 scripts/build-star-catalog.py /path/to/hyg_v41.csv
Source/attribution and CC BY-SA 4.0 terms: public/media/earthlight/README.md.
"""
import csv
import math
from pathlib import Path
import struct
import sys

target = Path(__file__).resolve().parents[1] / 'public/media/earthlight/stars-hyg.bin'
count = 0
with open(sys.argv[1], newline='') as source, target.open('wb') as out:
    for row in csv.DictReader(source):
        if row['id'] == '0' or not row['mag'] or float(row['mag']) > 7:
            continue
        position = [float(row[k]) for k in ('x', 'y', 'z')]
        distance = math.hypot(*position)
        velocity = [float(row[k]) for k in ('vx', 'vy', 'vz')]
        # Retain the Cartesian space velocity, including radial velocity. The
        # vertex shader advances it from epoch J2000 before normalizing.
        values = [v / distance for v in position + velocity]
        values += [float(row['mag']), float(row['ci'] or '0.65')]
        if not all(math.isfinite(v) for v in values):
            raise ValueError(f"Invalid HYG star {row['id']}")
        out.write(struct.pack('<8f', *values))
        count += 1
print(f'{count} stars, {target.stat().st_size} bytes: {target}')
