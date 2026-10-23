"""Scenario definitions: the "current process" and the policy variants.

Every scenario is the *same* engine with a different :class:`Config`.  That is
the methodological point of the project: the only thing that changes between
"current" and "improved" is the dispatch policy, so any difference in waiting
time is attributable to the policy.

Mapping to the project brief
----------------------------
Step 1  ``baseline``            - current manual process at Huanggang Port
Step 2  ``smart_full``          - full smart-dispatch system
Step 3  comparison + one-at-a-time policy levers (p1..p7)

Run ``python run_experiments.py --config config_site.json`` to replace the
assumed baseline with your own field measurements; every scenario is then
rebuilt on top of it.
"""

from __future__ import annotations

from dataclasses import replace

from .engine import Config

# ---------------------------------------------------------------------------
# Calibrated baseline ("current process")
# ---------------------------------------------------------------------------
BASE = Config(
    duration_hours=12.0,
    start_hour=8.0,
    warmup_hours=1.0,
    # ---- passenger demand ---------------------------------------------
    pax_per_hour=550.0,
    party_size=1.3,
    prebook_share=0.10,
    urban_share=0.75,
    # ---- taxi supply ---------------------------------------------------
    taxi_supply_basis_pax=550.0,
    taxi_supply_ratio_urban=1.05,
    taxi_supply_ratio_nt=0.95,
    supply_lag_hours=2,
    buffer_capacity=40,
    # ---- pickup infrastructure -----------------------------------------
    stands={"urban": 8, "nt": 3, "prebook": 2},
    stand_queue_capacity=12,
    # ---- service process -----------------------------------------------
    service_mean_min={"urban": 1.5, "nt": 1.5, "prebook": 1.5},
    service_cv=0.60,
    # ---- manual dispatch -----------------------------------------------
    dispatch_interval_min=1.0,   # one platoon per minute
    dispatch_batch=8,
    misroute_prob=0.06,
    # ---- behaviour ------------------------------------------------------
    patience_mean_min=35.0,
    taxi_patience_mean_min=45.0,
)

# ---------------------------------------------------------------------------
# Smart-dispatch building blocks (each answers a "what if" question)
# ---------------------------------------------------------------------------
SMART = dict(
    # P1  continuous, event-driven release instead of a staff cycle
    dispatch_interval_min=0.0,
    # P2  bays pooled between urban and NT lanes -> no idle bay next to a queue
    pooled_stands=True,
    # P3  app pre-registration shortens the boarding transaction
    app_share=0.85,
    fast_checkin_factor=0.75,
    # P4  a share of taxis accept either destination (dynamic balancing)
    flex_share=0.35,
    # P6  digital lane guidance removes misrouting
    misroute_prob=0.01,
)


def build(base: Config | None = None) -> dict[str, Config]:
    """Rebuild every scenario on top of ``base`` (default: the calibrated one)."""
    base = base or BASE

    def v(**kw):
        return replace(base, **kw)

    return {
        # ---------------- Step 1: current process ----------------------
        "baseline": base,
        # ---------------- Step 2: full smart system --------------------
        "smart_full": v(**SMART, stands={"urban": 10, "nt": 4, "prebook": 2}),
        # ---------------- Step 3: one lever at a time ------------------
        "p1_continuous_dispatch": v(dispatch_interval_min=0.0),
        "p2_pooled_stands": v(pooled_stands=True),
        "p3_app_checkin": v(app_share=0.85, fast_checkin_factor=0.75),
        "p4_flexible_taxis": v(flex_share=0.35),
        "p5_extra_bays": v(stands={"urban": 10, "nt": 4, "prebook": 2}),
        "p6_digital_routing": v(misroute_prob=0.01),
        "p7_balanced_supply": v(taxi_supply_ratio_nt=1.05),
        # operational package (no capital works)
        "all_operational": v(**SMART),
    }


SCENARIOS = build()

# Short labels + ordering used in tables and figures
ORDER = [
    "baseline",
    "p1_continuous_dispatch",
    "p2_pooled_stands",
    "p3_app_checkin",
    "p4_flexible_taxis",
    "p5_extra_bays",
    "p6_digital_routing",
    "p7_balanced_supply",
    "all_operational",
    "smart_full",
]

LABELS = {
    "baseline": "Baseline (current process)",
    "p1_continuous_dispatch": "P1 Continuous dispatch",
    "p2_pooled_stands": "P2 Pooled pickup bays",
    "p3_app_checkin": "P3 App pre-registration",
    "p4_flexible_taxis": "P4 Flexible taxi pool",
    "p5_extra_bays": "P5 Two extra bays",
    "p6_digital_routing": "P6 Digital lane routing",
    "p7_balanced_supply": "P7 Balance NT supply",
    "all_operational": "All operational measures (no new bays)",
    "smart_full": "Smart dispatch + 2 extra bays (full package)",
}


# ---------------------------------------------------------------------------
# Scenario factories for the sweep experiments
# ---------------------------------------------------------------------------
def demand_level(pax_per_hour: float, smart: bool = False, base: Config | None = None) -> Config:
    """Same system at a different demand level (capacity stress test).

    Taxi supply stays at its observed level, so this shows what happens when
    demand grows but the empty-taxi flow does not.
    """
    cfg = replace(base or BASE, pax_per_hour=pax_per_hour)
    return replace(cfg, **SMART) if smart else cfg


def validation_case() -> Config:
    """Textbook M/M/c case used to validate the engine (see `stats.mmc_wait`).

    Taxis are effectively unlimited and every real-world friction is switched
    off, so the pickup bays become a pure multi-server queue whose mean wait
    is known in closed form (Erlang-C).
    """
    return Config(
        duration_hours=12.0,
        start_hour=8.0,
        warmup_hours=1.0,
        pax_per_hour=190.0,
        party_size=1.0,
        prebook_share=0.0,
        urban_share=1.0,
        stands={"urban": 8, "nt": 1, "prebook": 1},
        service_mean_min={"urban": 2.0, "nt": 2.0, "prebook": 2.0},
        service_dist="exp",
        service_cv=1.0,
        dispatch_interval_min=0.0,
        misroute_prob=0.0,
        patience_mean_min=float("inf"),
        taxi_patience_mean_min=float("inf"),
        taxi_supply_basis_pax=304.0,       # 1.6x the 190/h demand
        buffer_capacity=100000,
        stand_queue_capacity=1000,
        app_share=0.0,
        demand_profile=tuple([1.0] * 24),
    )
