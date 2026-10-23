"""
How much does the recommendation depend on the numbers we had to assume?

The project has no field measurements yet, so every behavioural parameter is a
default. This script swings each one to a plausible low/high value and re-runs
the recommended package, to see whether the answer survives.

    python experiments/uncertainty.py

Output: mean wait (30 seeds) for today's process and for the recommended
package, plus a check that the package still beats each single policy.
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from dataclasses import replace

from taxi_sim.engine import simulate
from taxi_sim.scenarios import BASE

SEEDS = range(1, 31)

SWINGS = [
    ("loaded share of taxi visits", "loaded_share", 0.35, 0.65),
    ("drop-offs that take a fare back today", "return_pickup_today", 0.25, 0.55),
    ("drivers who skip a busy rank", "queue_aversion", 0.40, 0.90),
    ("passenger patience (min)", "patience_mean_min", 25.0, 45.0),
    ("taxi patience (min)", "taxi_patience_mean_min", 30.0, 60.0),
    ("boarding time (min)", "service_mean_min", None, None),
    ("demand (pax/h)", "pax_per_hour", 440.0, 660.0),
]


def wait(**kw):
    vals = [simulate(replace(BASE, **kw), seed=s).metrics["wait_mean_incl_abandon"]
            for s in SEEDS]
    return statistics.mean(vals)


def applied(key, value):
    if key == "service_mean_min":
        return {key: {"urban": value, "nt": value, "prebook": value}}
    if key == "taxi_supply_ratio_urban":
        return {key: value, "taxi_supply_ratio_nt": value * 0.9}
    return {key: value}


def main():
    ticket = wait(ticket_delay_min=1.5)
    booking = wait(return_pickup=0.8)
    both = wait(ticket_delay_min=1.5, return_pickup=0.8)
    today = wait()
    print(f"default: today {today:.2f} | ticket {ticket:.2f} | booking {booking:.2f} | both {both:.2f}\n")
    print(f"{'assumption':40s} {'low':>7} {'high':>7} {'range':>14}")
    print("-" * 74)
    lo_all, hi_all = 1e9, -1e9
    rows = []
    for label, key, lo, hi in SWINGS:
        if key == "service_mean_min":
            lo, hi = 1.20, 1.80
        a = wait(ticket_delay_min=1.5, return_pickup=0.8, **applied(key, lo))
        b = wait(ticket_delay_min=1.5, return_pickup=0.8, **applied(key, hi))
        # ranking check at both ends
        ok = True
        for v in (lo, hi):
            kw = {**applied(key, v)}
            ok &= wait(ticket_delay_min=1.5, **kw) > min(
                wait(ticket_delay_min=1.5, return_pickup=0.8, **kw),
                wait(return_pickup=0.8, **kw))
        lo_all, hi_all = min(lo_all, a, b), max(hi_all, a, b)
        rows.append((label, a, b, ok))
        print(f"{label:40s} {a:7.2f} {b:7.2f}   {min(a,b):.2f}-{max(a,b):.2f}"
              f"   {'package still best' if ok else 'RANKING FLIPS'}")
    print("-" * 74)
    print(f"recommended wait across every swing: {lo_all:.2f} - {hi_all:.2f} min")


if __name__ == "__main__":
    main()
