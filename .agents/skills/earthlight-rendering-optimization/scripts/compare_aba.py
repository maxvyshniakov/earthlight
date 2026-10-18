#!/usr/bin/env python3
"""Summarize matched A/B/A timing samples; no significance or quality claims."""
import argparse
import json
import math
import statistics
from pathlib import Path


def summarize(data):
    if not isinstance(data, dict) or data.get("unit") != "ms":
        raise ValueError("Expected an object with unit 'ms'")
    if data.get("metric") not in {"gpu-frame", "cpu-frame", "raf-interval"}:
        raise ValueError("metric must be gpu-frame, cpu-frame or raf-interval")
    runs = {}
    for name in ("a", "b", "a2"):
        values = data.get(name)
        if not isinstance(values, list) or not values:
            raise ValueError(f"{name} must be a nonempty list")
        if any(type(x) not in (int, float) or not math.isfinite(x) or x <= 0 for x in values):
            raise ValueError(f"{name} must contain finite positive durations")
        ordered = sorted(values)
        runs[name] = {
            "count": len(values),
            "median_ms": statistics.median(values),
            "p95_ms": ordered[math.ceil(len(values) * .95) - 1],
        }
    a, b, a2 = (runs[x]["median_ms"] for x in ("a", "b", "a2"))
    return {
        "metric": data["metric"],
        "unit": "ms",
        "runs": runs,
        "control_drift_percent": 100 * (a2 - a) / a,
        "b_time_reduction_percent": {"vs_a": 100 * (a - b) / a, "vs_a2": 100 * (a2 - b) / a2},
        "interpretation": "Positive reduction means shorter duration. Drift is A2 relative to A. Descriptive only; no significance, matched-state or visual-quality validation.",
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("samples", type=Path)
    args = parser.parse_args()
    try:
        result = summarize(json.loads(args.samples.read_text()))
    except (OSError, ValueError) as error:
        parser.error(str(error))
    print(json.dumps(result, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
