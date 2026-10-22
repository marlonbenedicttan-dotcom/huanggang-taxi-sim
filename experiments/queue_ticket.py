"""
The queue-ticket regime at the new Huanggang Port (opened October 2026).

Every empty taxi must collect a paper ticket at a public-transport buffer zone
before it can reach the rank, then hand it back on the way in. The taxi trade
reports about eight minutes per trip and has asked the government to review it.

The ticket time is paid by the driver, not the passenger, so it enters the
model as a cut in the supply that turns up:

    supply = base x T / (T + delay)

where T is a taxi's average time at the port (about 25.5 min in this model) and
delay is the ticket time. Eight minutes therefore costs the port about a
quarter of its taxi supply.

    python experiments/queue_ticket.py
"""
import statistics
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from taxi_sim.engine import Config, Simulation

SEEDS = list(range(1, 31))
BASE = {"pax_per_hour": 550.0}


def run(**kw):
    cfg = dict(BASE)
    cfg.update(kw)
    rows = [Simulation(Config(**cfg), seed=s).run().metrics for s in SEEDS]
    def m(k): return statistics.mean(r[k] for r in rows)
    def se(k):
        v = [r[k] for r in rows]
        return statistics.stdev(v) / len(v) ** 0.5
    return m, se


def main():
    print(f"{'ticket delay':>14} {'wait (all)':>11} {'vs no ticket':>13} {'gave up %':>10}")
    base_m, _ = run(ticket_delay_min=0)
    base_w = base_m('wait_mean_incl_abandon')
    for d in (8.0, 6.0, 4.0, 2.0, 1.5, 0.0):
        m, se = run(ticket_delay_min=d)
        print(f"{d:>11.1f} min {m('wait_mean_incl_abandon'):>9.2f}  "
              f"{m('wait_mean_incl_abandon') - base_w:>+11.2f}  {m('abandon_rate_pct'):>8.1f}")

    paper, _ = run(ticket_delay_min=8.0)
    digital, _ = run(ticket_delay_min=1.5)
    print(f"\npaper (8 min)  -> {paper('wait_mean_incl_abandon'):.2f} min waiting, "
          f"{paper('abandon_rate_pct'):.1f}% gave up")
    print(f"digital (1.5)  -> {digital('wait_mean_incl_abandon'):.2f} min waiting, "
          f"{digital('abandon_rate_pct'):.1f}% gave up")
    print(f"recovers {paper('wait_mean_incl_abandon') - digital('wait_mean_incl_abandon'):.2f} min per passenger")

    # How much of the 8 minutes actually deters drivers is unknown. The model
    # above assumes they respond fully; here is the same ticket with weaker
    # responses, as a range rather than a point.
    print("\nsensitivity: how strongly drivers react to the 8-minute ticket")
    for label, factor in (("full response", 1.0), ("half", 0.5), ("quarter", 0.25)):
        k = 0.761 + (1 - 0.761) * (1 - factor)     # 0.761 at full response
        m, _ = run(taxi_supply_ratio_urban=1.05 * k, taxi_supply_ratio_nt=0.95 * k)
        print(f"  {label:14} supply x{k:.3f}  wait {m('wait_mean_incl_abandon'):6.2f} min")


if __name__ == "__main__":
    main()
