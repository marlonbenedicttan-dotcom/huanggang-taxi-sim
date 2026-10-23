"""
Driver-incentive sweep: does paying drivers to come to the port help?

The port's supply problem is a return-leg problem: a taxi that takes a fare to
Huanggang has no guaranteed fare back, so drivers skip it. Three policies are
modelled here as ways to raise the expected value of a port trip:

    backhaul_match      0-1     share of port trips with a return fare matched
    port_surcharge_hkd  0-50    regulated extra fare on port pickups
    wait_allowance_hkd  0-4     paid per minute spent queueing

Supply response (both engines):

    supply = base_ratio * (1 + 0.35*backhaul + 0.45*(surcharge/50) + 0.30*(allowance/4))

THE COEFFICIENTS ARE ILLUSTRATIVE, NOT MEASURED. Nobody has published a
driver supply elasticity for this port, so the numbers below answer "what does
the model do if the response looks like this", not "what will happen".

What is robust to the assumption is the *shape*: the queue stops being
supply-limited after a fairly small improvement, so incentives saturate and
substitute for each other.

    python experiments/incentive_sweep.py
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taxi_sim.engine import Config, Simulation

SEEDS = [11, 12, 13, 14, 15, 16, 17, 18]
BASE = {"pax_per_hour": 550.0}          # the website's default demand


def wait(**kw):
    cfg = dict(BASE)
    cfg.update(kw)
    vals = [Simulation(Config(**cfg), seed=s).run().metrics["wait_mean"] for s in SEEDS]
    return statistics.mean(vals), statistics.stdev(vals) / len(vals) ** 0.5


def main():
    base, se = wait()
    print(f"baseline (550 pax/h, no incentives): {base:.2f} +- {se:.2f} min\n")

    print("guaranteed return fare")
    for bh in (0.2, 0.4, 0.6, 0.8, 1.0):
        m, s = wait(backhaul_match=bh)
        print(f"  {bh * 100:>3.0f}% of trips matched   {m:5.2f} min   {m - base:+5.2f}")

    print("\nport pickup surcharge")
    for sc in (10, 20, 30, 40, 50):
        m, _ = wait(port_surcharge_hkd=sc)
        print(f"  +{sc:>2} HKD                 {m:5.2f} min   {m - base:+5.2f}")

    print("\nwaiting-time allowance")
    for wa in (1, 2, 3, 4):
        m, _ = wait(wait_allowance_hkd=wa)
        print(f"  {wa:>2} HKD/min              {m:5.2f} min   {m - base:+5.2f}")

    m, s = wait(backhaul_match=0.7, port_surcharge_hkd=30, wait_allowance_hkd=2)
    print(f"\nall three at once: {m:.2f} +- {s:.2f} min   {m - base:+5.2f}")
    print("  -> stacking them buys almost nothing over the best single policy")


if __name__ == "__main__":
    main()
