"""Statistics: replication aggregation, confidence intervals, Erlang-C check.

All scenario results are Monte-Carlo estimates.  Reporting a single run would
let random noise masquerade as a policy effect, so every scenario is run with
R independent replications and summarised as

    mean  +/-  t(0.975, R-1) * sd / sqrt(R)          (95% CI)

Only differences whose confidence intervals do not overlap should be
interpreted as real policy effects.
"""

from __future__ import annotations

import math

# two-sided 95% Student-t critical values, df = 1..30
_T975 = [
    12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228,
    2.201, 2.179, 2.160, 2.145, 2.131, 2.120, 2.110, 2.101, 2.093, 2.086,
    2.080, 2.074, 2.069, 2.064, 2.060, 2.056, 2.052, 2.048, 2.045, 2.042,
]


def t_crit(df: int) -> float:
    if df <= 0:
        return float("nan")
    if df <= len(_T975):
        return _T975[df - 1]
    return 1.960  # normal approximation for large samples


def mean_sd(vals):
    n = len(vals)
    if n == 0:
        return float("nan"), float("nan")
    m = sum(vals) / n
    if n == 1:
        return m, 0.0
    var = sum((v - m) ** 2 for v in vals) / (n - 1)
    return m, math.sqrt(var)


def summarise(rows: list[dict], metrics: list[str]) -> dict:
    """rows = one dict per replication -> {metric: {mean, sd, ci, n}}"""
    out = {}
    for k in metrics:
        vals = [r[k] for r in rows if k in r and r[k] == r[k]]  # drop NaN
        m, sd = mean_sd(vals)
        n = len(vals)
        half = t_crit(n - 1) * sd / math.sqrt(n) if n > 1 else 0.0
        out[k] = {"mean": m, "sd": sd, "ci": half, "n": n,
                  "lo": m - half, "hi": m + half}
    return out


def fmt_ci(stat: dict, nd: int = 1) -> str:
    if stat["n"] == 0:
        return "n/a"
    if stat["n"] == 1:
        return f"{stat['mean']:.{nd}f}"
    return f"{stat['mean']:.{nd}f} ± {stat['ci']:.{nd}f}"


def reduction(before: dict, after: dict) -> float:
    """Percentage reduction of a metric (positive = improvement)."""
    b, a = before["mean"], after["mean"]
    if b == 0 or b != b:
        return float("nan")
    return 100.0 * (b - a) / b


# ---------------------------------------------------------------------------
# Analytical benchmark: M/M/c (Erlang C)
# ---------------------------------------------------------------------------
def erlang_c(c: int, offered_load: float) -> float:
    """Probability that an arrival has to wait, M/M/c.

    ``offered_load`` = lambda / mu  (in erlangs).
    """
    if offered_load >= c:
        return 1.0
    a = offered_load
    s = sum(a ** k / math.factorial(k) for k in range(c))
    top = a ** c / math.factorial(c) * (c / (c - a))
    return top / (s + top)


def mmc_wait_min(lam_per_hour: float, mean_service_min: float, c: int) -> float:
    """Theoretical mean queue wait for M/M/c, in minutes."""
    mu = 1.0 / mean_service_min           # services per minute
    lam = lam_per_hour / 60.0             # arrivals per minute
    a = lam / mu
    if lam >= c * mu:
        return float("inf")
    return erlang_c(c, a) / (c * mu - lam)
