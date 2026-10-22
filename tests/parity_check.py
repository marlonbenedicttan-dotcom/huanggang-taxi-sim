"""Cross-check the browser engine against the Python research model.

The website ships its own JavaScript implementation of the simulation so it can
be hosted as a static site (no server, no cold start).  Two implementations of
the same model is a risk, so this script runs both on identical configurations
and compares the headline metrics.

    python tests/parity_check.py                 # 20 seeds, baseline
    python tests/parity_check.py --smart         # smart-dispatch package
    python tests/parity_check.py --seeds 1,2,3

Pass criterion: the 95% confidence intervals of the two estimates must overlap
for every metric.  The two engines use different random number generators, so
they are not expected to be bit-identical — this is a statistical equivalence
test, which is the right standard for a Monte-Carlo model.

Note: `buffer_avg` is a *bistable* quantity (a lane is either draining or pinned
at capacity), so it needs more replications than the others to settle.  With 20
seeds its CI also overlaps.
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from dataclasses import replace

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from taxi_sim.engine import simulate
from taxi_sim.scenarios import BASE, SMART

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
NODE = os.path.expanduser("~/.local/node/bin/node")

PAIRS = [
    ("wait_mean", "waitMean"),
    ("wait_mean_incl_abandon", "waitMeanInclAbandon"),
    ("wait_p90", "waitP90"),
    ("abandon_rate_pct", "abandonRatePct"),
    ("queue_avg", "queueAvg"),
    ("stand_util_pct", "standUtilPct"),
    ("buffer_avg", "bufferAvg"),
    ("taxi_dwell_mean", "taxiDwellMean"),
    ("throughput_pax_h", "throughputPaxH"),
    ("party_arrived", "partyArrived"),
]


def mean_ci(values):
    n = len(values)
    m = sum(values) / n
    if n < 2:
        return m, 0.0
    sd = (sum((v - m) ** 2 for v in values) / (n - 1)) ** 0.5
    return m, 1.96 * sd / n ** 0.5


def run_python(cfg, seeds):
    rows = []
    for s in seeds:
        m = simulate(cfg, s).metrics
        rows.append({k: m[k] for k, _ in PAIRS})
    return rows


def run_js(seeds, smart):
    cmd = [NODE, os.path.join(ROOT, "tests", "js_run.mjs"),
           "--seeds", ",".join(map(str, seeds))]
    if smart:
        cmd.append("--smart")
    out = subprocess.run(cmd, capture_output=True, text=True, check=True).stdout
    return [r["metrics"] for r in json.loads(out)]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--seeds", default=",".join(str(i) for i in range(1, 21)))
    ap.add_argument("--smart", action="store_true")
    args = ap.parse_args()

    seeds = [int(s) for s in args.seeds.split(",")]
    cfg = replace(BASE, **SMART) if args.smart else BASE

    py = run_python(cfg, seeds)
    js = run_js(seeds, args.smart)

    print(f"Python research model  vs  browser model")
    print(f"{len(seeds)} replications, {'smart dispatch' if args.smart else 'current process'}\n")
    print(f"{'metric':<20}{'python (95% CI)':>24}{'browser (95% CI)':>26}{'diff':>9}  ")
    print("-" * 82)

    failures = []
    for py_key, js_key in PAIRS:
        pm, pc = mean_ci([r[py_key] for r in py])
        jm, jc = mean_ci([r[js_key] for r in js])
        overlap = not (pm + pc < jm - jc or jm + jc < pm - pc)
        rel = 100 * (jm - pm) / pm if pm else 0.0
        if not overlap:
            failures.append((py_key, rel))
        print(f"{py_key:<20}{pm:>11.2f} ± {pc:<9.2f}{jm:>13.2f} ± {jc:<9.2f}"
              f"{rel:>+8.1f}%  {'ok' if overlap else 'NO OVERLAP'}")

    print("-" * 82)
    if failures:
        print("\nFAILED (confidence intervals do not overlap):")
        for k, rel in failures:
            print(f"  - {k}: {rel:+.1f}%")
        sys.exit(1)
    print("PASS — every metric agrees within its 95% confidence interval")


if __name__ == "__main__":
    main()
