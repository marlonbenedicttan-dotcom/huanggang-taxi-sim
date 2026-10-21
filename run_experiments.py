#!/usr/bin/env python3
"""
Huanggang Port taxi dispatch simulation -- main experiment driver.

    python run_experiments.py                 # full study (~2 min)
    python run_experiments.py --reps 40       # tighter confidence intervals
    python run_experiments.py --quick         # fast smoke test
    python run_experiments.py --validate      # Erlang-C validation only
    python run_experiments.py --no-plots

Outputs (all in ./results):
    scenarios_raw.csv          one row per replicate (audit trail)
    scenarios_summary.csv      mean / sd / 95% CI per scenario and metric
    summary_table.md           ready-to-paste report table
    dispatch_heatmap.csv       manual-dispatch staffing surface
    sweep_demand.csv           capacity curve
    sweep_patience.csv         sensitivity to passenger tolerance
    validation_mmc.csv         engine vs Erlang-C
    fig1..fig5 *.png           figures

Research questions answered
---------------------------
RQ1 How efficient is the current system?      -> scenario `baseline`
RQ2 What drives passenger wait time?          -> P1..P7 one-at-a-time + heatmap
RQ3 Can smart dispatch reduce queues?         -> `smart_full` vs `baseline`
RQ4 How do different policies perform?        -> full scenario set + sweeps
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import os
import sys
from concurrent.futures import ProcessPoolExecutor
from dataclasses import fields, replace

from taxi_sim import scenarios, stats
from taxi_sim.engine import Config, simulate
from taxi_sim.scenarios import BASE, LABELS, ORDER, demand_level, validation_case

RES = os.path.join(os.path.dirname(os.path.abspath(__file__)), "results")
SUMMARY_METRICS = [
    "wait_mean", "wait_median", "wait_p90", "wait_p95", "wait_max",
    "wait_mean_incl_abandon", "abandon_rate_pct",
    "queue_avg", "queue_max", "queue_p90",
    "stand_util_pct", "buffer_avg", "buffer_max",
    "taxi_dwell_mean", "taxi_wait_mean", "taxi_waste_pct",
    "throughput_pax_h", "misroutes", "little_gap_pct",
]


# ---------------------------------------------------------------------------
# parallel execution helpers (module level so they are picklable)
# ---------------------------------------------------------------------------
def _run_one(job):
    cfg, seed, trace = job
    r = simulate(cfg, seed)
    return r.metrics, r.trace


def run_batch(jobs, workers):
    if workers and workers > 1:
        with ProcessPoolExecutor(max_workers=workers) as ex:
            return list(ex.map(_run_one, jobs, chunksize=2))
    return [_run_one(j) for j in jobs]


# ---------------------------------------------------------------------------
def check_consistency(rows):
    """Guard against silent modelling errors before any conclusion is drawn."""
    problems = []
    for r in rows:
        if r["stand_util_pct"] > 100.5:
            problems.append(f"bay utilisation {r['stand_util_pct']:.1f}% > 100%")
        if abs(r["little_gap_pct"]) > 8:
            problems.append(f"Little's law off by {r['little_gap_pct']:.1f}%")
        if r["party_served"] + r["party_abandoned"] > r["party_arrived"] * 1.01:
            problems.append("more parties finished than arrived")
    return sorted(set(problems))


def write_csv(path, rows, fieldnames=None):
    if not rows:
        return
    fieldnames = fieldnames or list(rows[0].keys())
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fieldnames)
        w.writeheader()
        for r in rows:
            w.writerow({k: (f"{r[k]:.4f}" if isinstance(r.get(k), float) else r.get(k))
                        for k in fieldnames})


# ---------------------------------------------------------------------------
# Experiment 1 + 2 + 3: scenarios
# ---------------------------------------------------------------------------
def experiment_scenarios(scen, workers, seeds):
    jobs, index = [], []
    for name in ORDER:
        for s in seeds:
            jobs.append((scen[name], s, False))
            index.append(name)
    out = run_batch(jobs, workers)

    raw, by_scen = [], {n: [] for n in ORDER}
    for name, (m, _) in zip(index, out):
        row = {"scenario": name, **m}
        raw.append(row)
        by_scen[name].append(m)

    problems = check_consistency(raw)
    summary = {n: stats.summarise(by_scen[n], SUMMARY_METRICS) for n in ORDER}
    return raw, by_scen, summary, problems


def markdown_table(summary, base="baseline"):
    keys = [
        ("wait_mean", "Mean wait (min)", 1),
        ("wait_p90", "90th pct wait (min)", 1),
        ("abandon_rate_pct", "Gave up (%)", 1),
        ("queue_avg", "Avg passengers waiting", 1),
        ("queue_max", "Max passengers waiting", 0),
        ("stand_util_pct", "Bay utilisation (%)", 1),
        ("buffer_avg", "Avg taxis in buffer", 1),
        ("taxi_dwell_mean", "Taxi time at port (min)", 1),
        ("throughput_pax_h", "Throughput (pax/h)", 0),
    ]
    head = "| Scenario | " + " | ".join(h for _, h, _ in keys) + " | Change in mean wait |"
    sep = "|" + "---|" * (len(keys) + 2)
    lines = [head, sep]
    for name in ORDER:
        s = summary[name]
        cells = [stats.fmt_ci(s[k], nd) for k, _, nd in keys]
        red = stats.reduction(summary[base]["wait_mean"], s["wait_mean"])
        tag = "—" if name == base else f"{-red:+.0f}%"
        lines.append(f"| {LABELS[name]} | " + " | ".join(cells) + f" | {tag} |")
    return "\n".join(lines)


# ---------------------------------------------------------------------------
# Experiment: manual dispatch staffing surface (RQ2)
# ---------------------------------------------------------------------------
def experiment_dispatch(reps, workers, seeds):
    intervals = [0.5, 1.0, 2.0, 3.0, 5.0]
    batches = [2, 4, 6, 8, 12]
    jobs, cells = [], []
    for iv in intervals:
        for b in batches:
            cfg = replace(BASE, dispatch_interval_min=iv, dispatch_batch=b)
            for s in seeds[:reps]:
                jobs.append((cfg, s, False))
                cells.append((iv, b))
    out = run_batch(jobs, workers)

    grid_rows = []
    grid = [[0.0] * len(batches) for _ in intervals]
    for (iv, b), (m, _) in zip(cells, out):
        grid_rows.append({"interval_min": iv, "batch": b, **m})
    for i, iv in enumerate(intervals):
        for j, b in enumerate(batches):
            vals = [r["wait_mean"] for r in grid_rows
                    if r["interval_min"] == iv and r["batch"] == b]
            grid[i][j] = sum(vals) / len(vals) if vals else float("nan")
    return intervals, batches, grid, grid_rows


# ---------------------------------------------------------------------------
# Experiment: demand sweep (RQ3/RQ4 -- capacity headroom)
# ---------------------------------------------------------------------------
def experiment_demand(workers, seeds, base, levels=(350, 450, 550, 650, 750, 850)):
    jobs, tags = [], []
    for pax in levels:
        for smart in (False, True):
            cfg = demand_level(float(pax), smart=smart, base=base)
            for s in seeds:
                jobs.append((cfg, s, False))
                tags.append((pax, "smart" if smart else "baseline"))
    out = run_batch(jobs, workers)

    buckets = {}
    for tag, (m, _) in zip(tags, out):
        buckets.setdefault(tag, []).append(m)

    rows, by_scen = [], {"baseline": [], "smart": []}
    for (pax, name), ms in sorted(buckets.items()):
        ss = stats.summarise(ms, ["wait_mean", "abandon_rate_pct", "queue_avg", "stand_util_pct"])
        row = {
            "pax_per_hour": pax,
            "policy": name,
            "wait_mean": ss["wait_mean"]["mean"],
            "wait_ci": ss["wait_mean"]["ci"],
            "abandon_pct": ss["abandon_rate_pct"]["mean"],
            "queue_avg": ss["queue_avg"]["mean"],
            "util_pct": ss["stand_util_pct"]["mean"],
        }
        rows.append(row)
        by_scen[name].append(row)
    return rows, by_scen


# ---------------------------------------------------------------------------
# Experiment: passenger tolerance sweep (RQ2)
# ---------------------------------------------------------------------------
def experiment_patience(workers, seeds, base, levels=(10, 20, 35, 50, 75)):
    jobs, tags = [], []
    for pat in levels:
        for smart in (False, True):
            cfg = demand_level(base.pax_per_hour, smart=smart, base=base)
            cfg = replace(cfg, patience_mean_min=float(pat))
            for s in seeds:
                jobs.append((cfg, s, False))
                tags.append((pat, "smart" if smart else "baseline"))
    out = run_batch(jobs, workers)
    buckets = {}
    for tag, (m, _) in zip(tags, out):
        buckets.setdefault(tag, []).append(m)
    rows = []
    for (pat, name), ms in sorted(buckets.items()):
        ss = stats.summarise(ms, ["wait_mean", "abandon_rate_pct", "party_served"])
        rows.append({
            "patience_min": pat, "policy": name,
            "wait_mean": ss["wait_mean"]["mean"],
            "abandon_pct": ss["abandon_rate_pct"]["mean"],
            "served": ss["party_served"]["mean"],
        })
    return rows


# ---------------------------------------------------------------------------
# Experiment: validation against Erlang-C
# ---------------------------------------------------------------------------
def experiment_validation(workers, seeds):
    cfg = validation_case()
    c = cfg.stands["urban"]
    levels = [120, 150, 170, 190, 210, 225]
    jobs, load = [], []
    for lam in levels:
        cfg_l = replace(cfg, pax_per_hour=float(lam))
        for s in seeds:
            jobs.append((cfg_l, s, False))
            load.append(lam)
    out = run_batch(jobs, workers)
    buckets = {}
    for lam, (m, _) in zip(load, out):
        buckets.setdefault(lam, []).append(m)

    rows = []
    for lam in levels:
        ms = buckets[lam]
        ss = stats.summarise(ms, ["wait_mean"])
        a = (lam / 60.0) * cfg.service_mean_min["urban"]   # offered load, erlangs
        rows.append({
            "lambda_per_h": lam,
            "offered_load_erlang": a,
            "sim_wait_min": ss["wait_mean"]["mean"],
            "sim_ci": ss["wait_mean"]["ci"],
            "erlang_c_wait_min": stats.mmc_wait_min(lam, cfg.service_mean_min["urban"], c),
        })
    return rows


# ---------------------------------------------------------------------------
def main(argv=None):
    ap = argparse.ArgumentParser(description="Huanggang Port taxi simulation")
    ap.add_argument("--reps", type=int, default=20, help="replications per scenario")
    ap.add_argument("--sweep-reps", type=int, default=12)
    ap.add_argument("--workers", type=int, default=max(1, (os.cpu_count() or 2) - 1))
    ap.add_argument("--quick", action="store_true", help="small run for a smoke test")
    ap.add_argument("--no-plots", action="store_true")
    ap.add_argument("--validate", action="store_true", help="run only the Erlang-C check")
    ap.add_argument("--config", type=str, default=None,
                    help="JSON file with field measurements that override the defaults")
    args = ap.parse_args(argv)

    if args.quick:
        args.reps, args.sweep_reps = 5, 4

    os.makedirs(RES, exist_ok=True)

    # optional calibration from real field data
    base = BASE
    if args.config:
        with open(args.config) as fh:
            user = json.load(fh)
        user = {k: v for k, v in user.items() if not k.startswith("_")}
        allowed = {f.name for f in fields(Config)}
        unknown = set(user) - allowed
        if unknown:
            sys.exit(f"Unknown config keys: {sorted(unknown)}")
        for k, v in user.items():
            cur = getattr(base, k)
            if isinstance(cur, dict):   # e.g. stands, service_mean_min
                base = replace(base, **{k: {**cur, **v}})
            else:
                base = replace(base, **{k: v})
        print(f"Calibration loaded from {args.config}: {len(user)} parameters")

    # every scenario is rebuilt on top of the (possibly calibrated) baseline
    scen = scenarios.build(base)

    seeds = list(range(1000, 1000 + args.reps))
    sweep_seeds = list(range(5000, 5000 + args.sweep_reps))

    print("=" * 78)
    print("HUANGGANG PORT TAXI DISPATCH SIMULATION")
    print(f"  replications/scenario : {args.reps}   workers: {args.workers}")
    print(f"  shift                 : {base.start_hour:.0f}:00 + {base.duration_hours:.0f} h")
    print(f"  demand                : {base.pax_per_hour:.0f} passengers/h")
    print("=" * 78)

    if args.validate:
        print("\n[Validation] M/M/c engine check ...")
        rows = experiment_validation(args.workers, list(range(9000, 9000 + max(args.reps, 20))))
        print(f"{'lambda':>8} {'erlangs':>8} {'sim':>10} {'theory':>10} {'diff %':>8}")
        for r in rows:
            d = 100 * (r["sim_wait_min"] - r["erlang_c_wait_min"]) / r["erlang_c_wait_min"]
            print(f"{r['lambda_per_h']:8.0f} {r['offered_load_erlang']:8.2f} "
                  f"{r['sim_wait_min']:7.2f}±{r['sim_ci']:.2f} "
                  f"{r['erlang_c_wait_min']:10.2f} {d:7.1f}%")
        write_csv(os.path.join(RES, "validation_mmc.csv"), rows)
        return

    # ---------------- 1. scenarios -------------------------------------
    print("\n[1/4] Running policy scenarios ...")
    raw, by_scen, summary, problems = experiment_scenarios(
        scen, args.workers, seeds
    )
    write_csv(os.path.join(RES, "scenarios_raw.csv"), raw)
    sum_rows = []
    for name in ORDER:
        row = {"scenario": name}
        for k, st in summary[name].items():
            row[f"{k}_mean"] = st["mean"]
            row[f"{k}_ci"] = st["ci"]
            row[f"{k}_sd"] = st["sd"]
        sum_rows.append(row)
    write_csv(os.path.join(RES, "scenarios_summary.csv"), sum_rows)

    table = markdown_table(summary)
    with open(os.path.join(RES, "summary_table.md"), "w") as fh:
        fh.write("# Scenario comparison (mean ± 95% CI over "
                 f"{args.reps} replications)\n\n{table}\n")
    print(table)

    if problems:
        print("\n  !! CONSISTENCY WARNINGS")
        for p in problems[:6]:
            print("     -", p)

    # ---------------- 2. manual dispatch surface -----------------------
    print("\n[2/4] Manual dispatch staffing surface ...")
    intervals, batches, grid, grid_rows = experiment_dispatch(
        args.sweep_reps, args.workers, sweep_seeds
    )
    write_csv(os.path.join(RES, "dispatch_heatmap.csv"), grid_rows)

    # ---------------- 3. demand sweep ----------------------------------
    print("\n[3/4] Demand sweep (capacity headroom) ...")
    dem_rows, dem_by = experiment_demand(args.workers, sweep_seeds, base)
    write_csv(os.path.join(RES, "sweep_demand.csv"), dem_rows)

    # ---------------- 4. patience sweep --------------------------------
    print("\n[4/4] Passenger tolerance sweep ...")
    pat_rows = experiment_patience(args.workers, sweep_seeds, base)
    write_csv(os.path.join(RES, "sweep_patience.csv"), pat_rows)

    # ---------------- validation ---------------------------------------
    print("\n[extra] Engine validation vs Erlang-C ...")
    val = experiment_validation(args.workers, list(range(9000, 9000 + max(args.reps, 20))))
    write_csv(os.path.join(RES, "validation_mmc.csv"), val)
    print(f"{'lambda/h':>9} {'erlangs':>8} {'sim wait':>12} {'theory':>8} {'diff':>7}")
    for r in val:
        d = 100 * (r["sim_wait_min"] - r["erlang_c_wait_min"]) / r["erlang_c_wait_min"]
        print(f"{r['lambda_per_h']:9.0f} {r['offered_load_erlang']:8.2f} "
              f"{r['sim_wait_min']:7.2f}±{r['sim_ci']:.2f} "
              f"{r['erlang_c_wait_min']:8.2f} {d:6.1f}%")

    # ---------------- figures ------------------------------------------
    if not args.no_plots:
        print("\n[figures] ...")
        try:
            from taxi_sim import plots

            plots.fig_scenarios(summary, LABELS, ORDER,
                                os.path.join(RES, "fig1_wait_by_policy.png"))

            # time-series comparison with common random numbers
            cfg_a = replace(scen["baseline"], record_trace=True)
            cfg_b = replace(scen["smart_full"], record_trace=True)
            ta = simulate(cfg_a, seed=4242).trace
            tb = simulate(cfg_b, seed=4242).trace
            plots.fig_queue_timeseries(
                ta, tb, base.start_hour,
                (LABELS["baseline"], LABELS["smart_full"]),
                os.path.join(RES, "fig2_queue_timeseries.png"),
            )
            plots.fig_demand_sweep(
                dem_by, os.path.join(RES, "fig3_demand_sweep.png"),
                LABELS["baseline"], "Smart dispatch",
            )
            plots.fig_dispatch_heatmap(
                intervals, batches, grid,
                os.path.join(RES, "fig4_dispatch_heatmap.png"),
            )
            wa, wb = [], []
            for s in range(6):
                wa += simulate(cfg_a, seed=s).trace["waits"]
                wb += simulate(cfg_b, seed=s).trace["waits"]
            plots.fig_wait_cdf(wa, wb, os.path.join(RES, "fig5_wait_cdf.png"),
                               "Current process", "Smart dispatch")
            plots.fig_patience(pat_rows, os.path.join(RES, "fig7_patience.png"),
                               LABELS["baseline"], "Smart dispatch")
            plots.fig_validation([r["offered_load_erlang"] for r in val],
                                 [r["sim_wait_min"] for r in val],
                                 [r["sim_ci"] for r in val],
                                 [r["erlang_c_wait_min"] for r in val],
                                 os.path.join(RES, "fig6_validation.png"))
            print(f"  figures written to {RES}")
        except ImportError:
            print("  plotting skipped: install matplotlib with "
                  "'pip install -r requirements.txt'")
        except Exception as exc:      # plotting must never break the study
            print(f"  plotting skipped: {exc}")

    # ---------------- headline answer ----------------------------------
    b, s = summary["baseline"], summary["smart_full"]
    print("\n" + "=" * 78)
    print("STEP 3 -- COMPARISON")
    print(f"  mean wait      : {b['wait_mean']['mean']:.1f} min -> "
          f"{s['wait_mean']['mean']:.1f} min "
          f"({stats.reduction(b['wait_mean'], s['wait_mean']):.0f}% lower)")
    print(f"  90th pct wait  : {b['wait_p90']['mean']:.1f} min -> "
          f"{s['wait_p90']['mean']:.1f} min "
          f"({stats.reduction(b['wait_p90'], s['wait_p90']):.0f}% lower)")
    print(f"  gave up        : {b['abandon_rate_pct']['mean']:.1f}% -> "
          f"{s['abandon_rate_pct']['mean']:.1f}%")
    print(f"  avg queue      : {b['queue_avg']['mean']:.1f} -> "
          f"{s['queue_avg']['mean']:.1f} passengers")
    print(f"  taxis in buffer: {b['buffer_avg']['mean']:.1f} -> "
          f"{s['buffer_avg']['mean']:.1f}")
    print("=" * 78)


if __name__ == "__main__":
    main()
