"""Invariant tests for the simulation engine.

Run with:  python tests/test_engine.py      (no pytest required)
       or: python -m pytest tests/ -q
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dataclasses import replace

from taxi_sim.engine import simulate
from taxi_sim.scenarios import BASE, SCENARIOS
from taxi_sim.stats import erlang_c, mmc_wait_min


def _m(cfg, seed=1):
    return simulate(cfg, seed).metrics


def test_conservation():
    """Every party either boards or abandons; no phantom customers."""
    for seed in (1, 2, 3):
        m = _m(BASE, seed)
        assert m["party_served"] + m["party_abandoned"] <= m["party_arrived"] + 1
        assert m["party_served"] <= m["party_arrived"] + 1


def test_little_law():
    """L = lambda_served*W + lambda_abandoned*W_abandoned (within 10%)."""
    for seed in (1, 2, 3):
        m = _m(BASE, seed)
        assert abs(m["little_gap_pct"]) < 10, m["little_gap_pct"]


def test_utilisation_bounds():
    """Bay utilisation must stay inside [0, 100]%."""
    for name in ("baseline", "smart_full"):
        m = _m(SCENARIOS[name])
        assert 0 <= m["stand_util_pct"] <= 100.5, m["stand_util_pct"]


def test_arrival_rate_close_to_config():
    """Realised arrivals should match pax_per_hour within sampling error."""
    m = _m(replace(BASE, patience_mean_min=float("inf")), seed=7)
    expected = (
        BASE.pax_per_hour
        / BASE.party_size
        * (BASE.duration_hours - BASE.warmup_hours)
    )
    assert abs(m["party_arrived"] - expected) / expected < 0.06


def test_no_abandonment_when_infinitely_patient():
    m = _m(replace(BASE, patience_mean_min=float("inf")), seed=5)
    assert m["party_abandoned"] == 0


def test_smart_beats_baseline():
    """The policy package must reduce mean wait on identical seeds."""
    b = [_m(SCENARIOS["baseline"], s)["wait_mean"] for s in (11, 12, 13)]
    s_ = [_m(SCENARIOS["smart_full"], s)["wait_mean"] for s in (11, 12, 13)]
    assert sum(s_) / 3 < sum(b) / 3 * 0.8, (b, s_)


def test_more_demand_more_wait():
    low = _m(replace(BASE, pax_per_hour=400.0), seed=4)["wait_mean"]
    high = _m(replace(BASE, pax_per_hour=700.0), seed=4)["wait_mean"]
    assert high > low, (low, high)


def test_erlang_c_limits():
    """Sanity of the analytical benchmark used for validation."""
    assert abs(erlang_c(1, 0.5) - 0.5) < 1e-9      # M/M/1: P(wait) = rho
    assert erlang_c(5, 4.999) > 0.99
    assert mmc_wait_min(1000, 2.0, 8) == float("inf")


def test_buffer_never_exceeds_capacity():
    """Taxi lanes must respect their physical capacity."""
    m = _m(BASE, seed=3)
    cap = BASE.buffer_capacity * 2 + BASE.flex_buffer_capacity
    assert m["buffer_max"] <= cap + 1, (m["buffer_max"], cap)


if __name__ == "__main__":
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    for fn in fns:
        fn()
        print(f"PASS  {fn.__name__}")
    print(f"\n{len(fns)} tests passed")
