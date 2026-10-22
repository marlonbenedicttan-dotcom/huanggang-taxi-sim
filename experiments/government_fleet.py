"""
Could the government fixing the port's taxi shortage by running its own fleet?

Two questions, in order:

1. How much extra taxi supply would a state fleet have to guarantee to match
   what a guaranteed-return-fare rule achieves with no new vehicles at all?
2. What happens if the fleet crowds out private drivers? A shorter queue means
   less to earn at the port, so some drivers stop coming — the fleet then
   shrinks the very supply it was meant to supplement.

The displacement scenarios are a sensitivity test, not a forecast: nobody has
measured how much private supply a public fleet would displace.

    python experiments/government_fleet.py
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taxi_sim.engine import Config, Simulation

SEEDS = list(range(1, 31))
BASE = {"pax_per_hour": 550.0}


def wait(**kw):
    cfg = dict(BASE)
    cfg.update(kw)
    return statistics.mean(
        Simulation(Config(**cfg), seed=s).run().metrics["wait_mean_incl_abandon"]
        for s in SEEDS
    )


def main():
    base = wait()
    backhaul = wait(backhaul_match=0.7)
    print(f"baseline                          {base:5.2f} min")
    print(f"guaranteed return fare (70%)      {backhaul:5.2f} min   {backhaul - base:+5.2f}")
    print("\na state fleet is just extra guaranteed supply:")
    for k in (1.1, 1.2, 1.3, 1.4):
        m = wait(taxi_supply_ratio_urban=1.05 * k, taxi_supply_ratio_nt=0.95 * k)
        print(f"  +{round((k - 1) * 100):>2}% taxis                    {m:5.2f} min   {m - base:+5.2f}")

    print("\nsame fleet (+30%), with private supply displaced by it:")
    for disp in (0.0, 0.1, 0.2, 0.3, 0.5):
        k = 1.3 * (1 - disp)
        m = wait(taxi_supply_ratio_urban=1.05 * k, taxi_supply_ratio_nt=0.95 * k)
        print(f"  displaces {disp * 100:>3.0f}% of private supply  {m:5.2f} min   {m - base:+5.2f}")

    print("\nreading: the fleet only works while private drivers keep coming.")
    print("past roughly a quarter displaced, it is worse than doing nothing.")


if __name__ == "__main__":
    main()
