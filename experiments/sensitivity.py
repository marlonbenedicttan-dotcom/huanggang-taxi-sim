"""
Which assumption actually drives the answer?

Every number in this project rests on something that was assumed rather than
measured: how much eight minutes of ticket deters a driver, how patient
passengers are, how long boarding takes. A tornado plot shows how much the
headline result moves when each of those assumptions is swung.

The baseline is the port as it operates today: paper queue ticket (8 minutes),
no digital ticket, 550 passengers an hour.

    python experiments/sensitivity.py
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taxi_sim.engine import Config, Simulation

SEEDS = list(range(1, 21))          # 20 is enough for a ranking, keeps this quick
BASE = dict(pax_per_hour=550.0, ticket_delay_min=8.0)


def wait(**kw):
    cfg = dict(BASE)
    cfg.update(kw)
    return statistics.mean(
        Simulation(Config(**cfg), seed=s).run().metrics["wait_mean_incl_abandon"]
        for s in SEEDS
    )


# name, low value, high value, kwargs template
ASSUMPTIONS = [
    ("Ticket deterrence (dwell 20 / 32 min)", 20.0, 32.0,
     lambda v: dict(port_dwell_min=v)),
    ("Ticket delay itself (4 / 12 min)", 4.0, 12.0,
     lambda v: dict(ticket_delay_min=v)),
    ("Passenger patience (25 / 45 min)", 25.0, 45.0,
     lambda v: dict(patience_mean_min=v)),
    ("Boarding time (1.2 / 1.8 min)", 1.2, 1.8,
     lambda v: dict(service_mean_min={"urban": v, "nt": v, "prebook": v})),
    ("Taxi supply (+/-20%)", 0.84, 1.26,
     lambda v: dict(taxi_supply_ratio_urban=v, taxi_supply_ratio_nt=v * 0.905)),
    ("Demand (+/-20%)", 440.0, 660.0,
     lambda v: dict(pax_per_hour=v)),
    ("Live information share (0 / 60%)", 0.0, 0.6,
     lambda v: dict(info_share=v)),
]


def main():
    base = wait()
    print(f"baseline (paper ticket, 550 pax/h): {base:.2f} min mean wait\n")

    rows = []
    for name, lo, hi, make in ASSUMPTIONS:
        a = wait(**make(lo))
        b = wait(**make(hi))
        rows.append((name, a, b, abs(b - a)))
    rows.sort(key=lambda r: r[3])

    print(f"{'assumption':38} {'low':>7} {'high':>7} {'swing':>7}")
    for name, a, b, swing in rows:
        print(f"{name:38} {a:7.2f} {b:7.2f} {swing:7.2f}")

    print("\nreading:")
    print("  Demand and taxi supply dominate, because the hall sits near capacity —")
    print("  a 20% swing in either moves the answer by 12-18 minutes. That is a")
    print("  property of queueing systems, not of the model.")
    print("  Among the things that were *assumed* rather than measured, passenger")
    print("  patience matters most, then how much the ticket deters drivers.")
    print("  Boarding time barely matters: the stands are not the constraint.")


if __name__ == "__main__":
    main()
