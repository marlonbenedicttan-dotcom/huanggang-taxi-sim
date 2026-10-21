"""Figures for the report (matplotlib only, no seaborn).

Every figure is written to ``results/`` as PNG (300 dpi, print-ready) and the
underlying numbers are kept in CSV so the graphs can be redrawn in Excel/R.
"""

from __future__ import annotations

import os

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt

C_BASE = "#b23a48"      # baseline red
C_SMART = "#2a6f97"     # smart blue
C_GREY = "#8d99ae"
DPI = 300


def _style():
    plt.rcParams.update(
        {
            "figure.dpi": DPI,
            "savefig.dpi": DPI,
            "font.size": 9,
            "axes.titlesize": 10,
            "axes.labelsize": 9,
            "axes.spines.top": False,
            "axes.spines.right": False,
            "axes.grid": True,
            "grid.alpha": 0.25,
            "grid.linewidth": 0.6,
            "legend.frameon": False,
        }
    )


# ---------------------------------------------------------------------------
def fig_scenarios(summary, labels, order, path, baseline_key="baseline"):
    """Mean wait with 95% CI + p90 marker, per scenario."""
    _style()
    names = [k for k in order if k in summary]
    means = [summary[k]["wait_mean"]["mean"] for k in names]
    cis = [summary[k]["wait_mean"]["ci"] for k in names]
    p90 = [summary[k]["wait_p90"]["mean"] for k in names]
    base = summary[baseline_key]["wait_mean"]["mean"]

    fig, ax = plt.subplots(figsize=(6.6, 0.42 * len(names) + 1.4))
    y = range(len(names))
    colors = [C_BASE if k == baseline_key else (C_SMART if k.startswith(("all", "smart")) else C_GREY)
              for k in names]
    ax.barh(list(y), means, xerr=cis, color=colors, height=0.62,
            error_kw=dict(ecolor="#333", lw=1, capsize=3))
    ax.scatter(p90, list(y), marker="o", s=26, facecolor="white",
               edgecolor="#111", linewidth=0.9, zorder=6,
               label="90th percentile wait")
    for i, (mu, ci, p90v) in enumerate(zip(means, cis, p90)):
        ax.text(max(mu + ci, p90v) + 0.8, i, f"{mu:.1f}",
                va="center", fontsize=8, color="#222")
    ax.set_yticks(list(y))
    ax.set_yticklabels([labels.get(k, k) for k in names])
    ax.invert_yaxis()
    ax.set_xlabel("Passenger wait for a taxi (minutes)")
    ax.set_title("Passenger waiting time by dispatch policy\n"
                 "(bar = mean with 95% CI, dot = 90th percentile)")
    ax.set_xlim(0, max(max(means), max(p90)) * 1.16)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_queue_timeseries(trace_a, trace_b, start_hour, labels, path):
    """Queue length over the shift: current process vs smart dispatch."""
    _style()
    fig, axes = plt.subplots(2, 1, figsize=(6.8, 5.0), sharex=True)

    for tr, color, lab in (
        (trace_a, C_BASE, labels[0]),
        (trace_b, C_SMART, labels[1]),
    ):
        x = [start_hour + t / 60.0 for t in tr["t_min"]]
        q = [a + b for a, b in zip(tr["q_urban"], tr["q_nt"])]
        axes[0].plot(x, q, color=color, lw=1.3, label=lab)
        axes[1].plot(x, tr["buffer"], color=color, lw=1.3, label=lab)

    axes[0].set_ylabel("Passengers waiting\n(parties)")
    axes[0].set_title("Passenger queue at the taxi hall")
    axes[1].set_ylabel("Empty taxis in\nbuffer zone")
    axes[1].set_title("Taxi queue in the buffer zone")
    axes[1].set_xlabel("Hour of day")
    axes[0].legend(loc="upper right")   # both panels share the same colours
    for ax in axes:
        ax.axvspan(8.5, 11.5, color="#f2c14e", alpha=0.15, lw=0)
        ax.axvspan(16.5, 19.5, color="#f2c14e", alpha=0.15, lw=0)
        ax.set_xlim(start_hour, start_hour + 12)
    fig.suptitle("Step 3: queue behaviour of the current process vs smart dispatch\n"
                 "(shaded = observed peak windows)", fontsize=10)
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_demand_sweep(rows_by_scenario, path, label_a, label_b):
    """Capacity curve: what happens as demand grows."""
    _style()
    fig, axes = plt.subplots(1, 2, figsize=(7.4, 3.0))
    for key, color, lab in (("baseline", C_BASE, label_a), ("smart", C_SMART, label_b)):
        rows = rows_by_scenario[key]
        x = [r["pax_per_hour"] for r in rows]
        axes[0].errorbar(x, [r["wait_mean"] for r in rows],
                         yerr=[r["wait_ci"] for r in rows],
                         marker="o", ms=4, lw=1.4, capsize=2.5, color=color, label=lab)
        axes[1].plot(x, [r["abandon_pct"] for r in rows], marker="o", ms=4,
                     lw=1.4, color=color, label=lab)
    axes[0].set_xlabel("Passenger demand (passengers/hour)")
    axes[0].set_ylabel("Mean wait (min)")
    axes[0].set_title("Waiting time vs demand")
    axes[1].set_xlabel("Passenger demand (passengers/hour)")
    axes[1].set_ylabel("Passengers who give up (%)")
    axes[1].set_title("Abandonment vs demand")
    axes[0].legend(loc="upper right")   # both panels share the same colours
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_dispatch_heatmap(intervals, batches, grid, path):
    """Mean wait as a function of the staff dispatch cycle."""
    _style()
    fig, ax = plt.subplots(figsize=(4.9, 3.4))
    im = ax.imshow(grid, aspect="auto", cmap="RdYlGn_r", origin="lower")
    ax.set_xticks(range(len(batches)))
    ax.set_xticklabels([str(b) for b in batches])
    ax.set_yticks(range(len(intervals)))
    ax.set_yticklabels([str(i) for i in intervals])
    ax.set_xlabel("Taxis released per dispatch (batch size)")
    ax.set_ylabel("Dispatch interval (minutes)")
    ax.set_title("Mean passenger wait (min)\nby manual dispatch staffing")
    ax.grid(False)
    vmax = max(max(r) for r in grid)
    for i in range(len(intervals)):
        for j in range(len(batches)):
            ax.text(j, i, f"{grid[i][j]:.0f}", ha="center", va="center", fontsize=8,
                    color="white" if grid[i][j] > 0.62 * vmax else "#222")
    fig.colorbar(im, ax=ax, label="minutes")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_wait_cdf(waits_a, waits_b, path, label_a, label_b):
    """Cumulative distribution of wait: shows the tail, not just the mean."""
    _style()
    fig, ax = plt.subplots(figsize=(4.9, 3.2))
    for waits, color, lab in ((waits_a, C_BASE, label_a), (waits_b, C_SMART, label_b)):
        w = sorted(waits)
        n = len(w)
        y = [(i + 1) / n * 100 for i in range(n)]
        ax.plot(w, y, lw=1.6, color=color, label=lab)
    ax.set_xlabel("Wait for a taxi (minutes)")
    ax.set_ylabel("Passengers served within this time (%)")
    ax.set_title("Distribution of passenger waiting time")
    ax.set_xlim(0, 45)
    ax.set_ylim(0, 100)
    ax.legend(loc="lower right")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_validation(levels, sim_wait, sim_ci, theory, path):
    """Simulation vs Erlang-C for the textbook M/M/c case."""
    _style()
    fig, ax = plt.subplots(figsize=(4.4, 3.0))
    ax.errorbar(levels, sim_wait, yerr=sim_ci, marker="o", ms=4, lw=1.2,
                capsize=2.5, color=C_SMART, label="Simulation (95% CI)")
    ax.plot(levels, theory, "--", color=C_BASE, lw=1.4, label="Erlang-C (M/M/c)")
    ax.set_xlabel("Offered load (erlangs)")
    ax.set_ylabel("Mean wait (min)")
    ax.set_title("Engine validation against the analytical model")
    ax.legend()
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)


# ---------------------------------------------------------------------------
def fig_patience(rows, path, label_a="Current process", label_b="Smart dispatch"):
    """How the *measured* wait depends on how long passengers are willing to wait.

    This is the censoring effect: a shorter tolerance hides the tail of the
    distribution, so the mean wait looks smaller even though the queue is not.
    """
    _style()
    fig, axes = plt.subplots(1, 2, figsize=(7.2, 2.9))
    for name, color, lab in (("baseline", C_BASE, label_a), ("smart", C_SMART, label_b)):
        pts = [r for r in rows if r["policy"] == name]
        pts.sort(key=lambda r: r["patience_min"])
        x = [r["patience_min"] for r in pts]
        axes[0].plot(x, [r["wait_mean"] for r in pts], marker="o", ms=4, lw=1.4,
                     color=color, label=lab)
        axes[1].plot(x, [r["abandon_pct"] for r in pts], marker="o", ms=4, lw=1.4,
                     color=color, label=lab)
    axes[0].set_xlabel("Passenger tolerance (minutes)")
    axes[0].set_ylabel("Measured mean wait (min)")
    axes[0].set_title("Censoring of the wait estimate")
    axes[1].set_xlabel("Passenger tolerance (minutes)")
    axes[1].set_ylabel("Passengers who give up (%)")
    axes[1].set_title("Abandonment")
    axes[0].legend(loc="upper left")
    axes[1].legend(loc="upper right")
    fig.tight_layout()
    fig.savefig(path)
    plt.close(fig)
