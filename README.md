# Huanggang Port Taxi Dispatch Simulation

A discrete-event simulation (DES) of the empty-taxi buffer, the pickup bays and
the passenger queues at Huanggang Port, used to measure how the **current manual
dispatch process** performs and to test **smart-dispatch policies** before they
are implemented.

The whole study runs from one command:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python run_experiments.py --reps 30
```

Everything is written to `results/` (CSV, a report-ready markdown table and seven
figures). A full run takes about 2 minutes on a laptop.

---

## 1. What the model represents

```
                          HUANGGANG PORT TAXI HALL
                          ========================

  empty taxi ──▶ ┌──────────────┐   release    ┌──────────────┐   board    ┌─────────┐
   (Poisson)     │ BUFFER ZONE  │ ──────────▶  │ PICKUP BAYS  │ ─────────▶ │ departs │
                 │  urban lane  │  (manual:    │  8 urban     │  service   │  loaded │
                 │  NT lane     │   1 platoon  │  3 NT        │  1.5 min   └─────────┘
                 │  flex pool   │   per min)   │  2 pre-book  │
                 └──────────────┘              └──────────────┘
                        ▲                             ▲
                        │ buffer full?                │
                        │ circle 8–20 min             │
                        │                             │
  passenger ──▶ ┌──────────────────────┐              │
   (Poisson,    │ QUEUES               │──────────────┘
    time-varying│  urban  |  NT  | pre-book
    rate)       └──────────────────────┘
                        │
                        └── gives up after ~35 min (measured, not ignored)
```

Each entity is explicit:

* **Passengers** arrive as a non-homogeneous Poisson process (hourly profile
  with morning and evening peaks), join the queue of their destination class,
  and abandon the queue if their patience runs out.
* **Empty taxis** arrive as a separate Poisson process, queue in the buffer zone
  of their lane, are released to the pickup bays, and leave empty if they are
  not called forward in time. A taxi that enters the wrong lane is redirected
  and has to circulate (8–20 min of lost capacity).
* **Pickup bays** are multi-server stations: registration + boarding + luggage +
  payment takes 1.5 min on average with realistic variability.
* **Fleet / pre-booked taxis** use a separate channel and do not consume the
  walk-up bays.

The engine is policy-agnostic: the "current process" and the "improved process"
are the *same code* with different settings, which is what makes the comparison
fair.

## 2. Files

| File | Purpose |
|---|---|
| `run_experiments.py` | main entry point: runs every scenario, sweep, validation and figure |
| `taxi_sim/engine.py` | the discrete-event simulation (no dependencies) |
| `taxi_sim/scenarios.py` | the calibrated baseline + all policy variants |
| `taxi_sim/stats.py` | confidence intervals, Erlang-C benchmark |
| `taxi_sim/plots.py` | figures |
| `tests/test_engine.py` | 9 invariant tests (conservation, Little's law, capacity bounds) |
| `tests/parity_check.py` | proves the website's engine matches the Python research model |
| `web/` | the interactive 2.5D pixel simulator (static site — see section 2b) |
| `serve.py` | local preview server for the website |
| `render.yaml` | one-click deploy to Render |
| `config_site.example.json` | template for your own field measurements |
| `results/` | all outputs of the last run |

Useful commands:

```bash
python run_experiments.py                 # default: 20 replications
python run_experiments.py --reps 50       # tighter confidence intervals
python run_experiments.py --quick         # 5 replications, smoke test
python run_experiments.py --no-plots      # numbers only
python run_experiments.py --validate      # Erlang-C check only
python run_experiments.py --config config_site.json   # use your field data
python tests/test_engine.py               # invariant tests
```

## 2b. Interactive 2.5D pixel simulator (website)

> **Visual direction.** The scene is hand-authored pixel art in a 2.5D
> arrangement: the ground is drawn in plan, while taxis, people and props are
> billboard sprites anchored at their feet and sorted by depth. This is the
> "Stardew" camera — the whole rank stays visible, but the vehicles still have
> silhouettes. Every sprite is a character grid in `web/js/pixel/sprites.js`;
> there are no image files, models or texture downloads.

`web/` is a self-contained static site: a pixel view of the taxi hall with
sliders for every input. It is the same model as the Python engine,
re-implemented in JavaScript so it can be hosted for free with **no server and
no cold start**. The renderer draws into a 640x360 buffer and scales with
nearest-neighbour, so the pixel size is constant at any window size; portrait
screens get their own framing rather than a letterboxed strip.

The view is not locked: **drag to look around, scroll or pinch to zoom
(1x–4x), double-click to reset**. Pan and zoom move a window over the finished
frame, so the art keeps its authored pixel size instead of resampling.

![Current process at the evening peak](docs/evening_current_process.png)

*Left panel: every parameter from section 3. Right: the hall at 17:30 — 51 urban
passengers waiting, the urban buffer drained, the NT buffer full. Toggle
"All four on" and the same moment has no queue at all.*

**Compare a proposal against the current process**

![A/B comparison](docs/compare_split_view.png)

*Left A = current process, right B = your proposal, same seed and same clock.
The bar underneath states whether the difference is real: it runs both scenarios
for N replications and refuses to claim an effect when the 95% intervals overlap.*

* **Policy cards** — four measures, each showing its effect on mean wait when
  applied alone, so you can see which suggestion actually moves the needle.
  Three booking ideas were tested; only the return-trip booking survived, because
  the fleet channel and app pre-registration are secondary (about 1.3 minutes)
  and only pay off after the ticket. They remain in *More settings*.
* **Diff strip** — lists only what differs (`Urban bays 8 → 10`,
  `Dispatch 1 min → continuous`), which is the literal answer to
  "did anything change?".
* **Trials** — 1 / 10 / 30 replications, with a verdict that says
  "−55%, CIs do not overlap" or "no measurable difference".
* **Editable in one minute** — only four headline inputs and the four policy
  cards are shown; everything else is behind *More settings*. Sliders apply
  automatically (a run takes ~30 ms), so there is no Run button to forget.
* **Shareable** — *copy link* encodes the whole scenario in the URL, and a
  3-step tour runs on the first visit.
* **The Python model on the page** — the panel at the bottom serves the original
  `engine.py`, `scenarios.py` and `stats.py` for reading or download, plus a link
  to the repository. `tools/sync_py.py` copies them into `web/py/` and
  `tests/code_sync_check.py` fails if the copies drift.
* On a phone the split becomes an **A/B swap** (one scene at a time, `Show A`
  button) because two live scenes would waste memory on a phone.

**What you can do**

* Drag to orbit, scroll to zoom.
* Switch between **As it runs today**, **All four on** and **★ Recommended** presets.
* Change demand, taxi supply, bays, boarding time, dispatch cycle, misapplied
  routing, app share, patience, buffer size — then hit **Run**.
* Scrub through the day (morning peak / midday / evening peak / whole shift) and
  change playback speed.
* Read the KPIs (mean wait, p90, abandonment, queue, bay utilisation) with the
  delta against the current process.
* Deep-link any state:
  `?preset=smart&window=2&t=90` (evening peak, 17:30).

**Run it locally**

```bash
python serve.py            # http://localhost:8000
```

**Deploy to Render**

1. Push this repository to GitHub.
2. Render → **New** → **Blueprint** → pick the repo. `render.yaml` is already in
   the repo: it declares a *static site* with publish path `./web`, so there is
   no build step and no server to pay for.
3. Or manually: **New → Static Site**, build command empty, publish directory
   `web`. Done — every push redeploys.

**Why a JavaScript port, and how it is kept honest**

Hosting the Python engine would need a web service (a cold-starting container) just
to compute numbers the browser can compute in ~50 ms. The trade-off is two
implementations of one model, so `tests/parity_check.py` runs both engines on the
same configuration and requires every metric's **95% confidence interval to
overlap**:

```bash
python tests/parity_check.py            # current process
python tests/parity_check.py --smart    # smart dispatch package
```

Typical agreement is within 1–5% on wait time, p90, abandonment, queue length and
utilisation. The most sensitive combination (pooled bays + flexible taxis) drifts
by ~8% — still inside the confidence intervals, but worth knowing when you quote
a number from the website rather than from the thesis tables.

**Recording a clip for your slides**

```bash
node tests/record.mjs "?preset=baseline&window=0" results/demo.mp4 540 30 180
#                                 query            output        frames fps minutes
```

Produces a 1500×950, 30 fps H.264 video with ffmpeg. `tests/shoot.mjs` captures a
single still. Both drive the system Chrome through `playwright-core`, so no
browser download is needed.

---

## 3. Parameters — and how to measure each one on site

The defaults below reproduce a *congested but plausible* port. Replace them with
your observations; the model then becomes evidence rather than illustration.
This table doubles as your data-collection plan.

| Parameter (JSON key) | Default | Meaning | How to measure |
|---|---|---|---|
| `pax_per_hour` | 550 | walk-up passengers per hour | Count arrivals at the taxi hall for 3–4 days; average per hour |
| `party_size` | 1.3 | passengers per taxi trip | Observe ~100 departures |
| `prebook_share` | 0.10 | share using fleet / pre-booked taxis | Booking-system records |
| `urban_share` | 0.75 | urban (red) vs NT (green) split | Count each queue for a shift |
| `taxi_supply_ratio_urban` / `_nt` | 1.05 / 0.95 | empty-taxi flow ÷ passenger flow | **Queue-ticket logs** give this directly (tickets issued per hour) |
| `taxi_supply_basis_pax` | 550 | demand level at which supply was measured | Your `pax_per_hour` on the survey day |
| `supply_lag_hours` | 2 | how late taxi supply peaks vs demand | Cross-correlate the hourly taxi and passenger series |
| `buffer_capacity` | 40 | buffer spaces **per lane** | Count the marked spaces |
| `stands` | 8 / 3 / 2 | pickup bays per class | Count on site |
| `stand_queue_capacity` | 12 | taxis that can wait at the bays | Count the holding lane |
| `service_mean_min` | 1.5 | boarding transaction time | Stopwatch 50 boardings |
| `service_cv` | 0.60 | variability of that time | sd ÷ mean of the same sample |
| `dispatch_interval_min` | 1.0 | how often staff call a platoon forward | Time the dispatcher for an hour |
| `dispatch_batch` | 8 | taxis released per call | Count per call |
| `misroute_prob` | 0.06 | taxis entering the wrong lane | Count for two hours |
| `patience_mean_min` | 35 | how long before a passenger gives up | Short exit interviews / count reneges |
| `taxi_patience_mean_min` | 45 | how long an empty taxi waits before leaving | Follow 20 taxis in the buffer |
| `recirc_min` / `recirc_max` | 8 / 20 | time lost circulating | Follow a redirected taxi |
| `loaded_share` | 0.50 | share of taxi visits that arrive with a passenger | Count drop-offs vs empty arrivals (ANPR or 1 hour on the approach) |
| `return_pickup_today` | 0.40 | drop-offs that take a fare back today | Count rank joins after a drop-off; or ask 20 drivers |
| `queue_threshold` / `queue_aversion` | 0.50 / 0.70 | how full the buffer gets before drivers skip it | Count taxis entering vs passing by at a busy hour |
| `port_dwell_min` | 25.5 | time from arrival to leaving with a fare | Time 20 taxis end to end |
| `ticket_delay_min` | 8.0 | driver time lost at the ticket point | Trade report, or stopwatch 20 taxis |
| `prebook_supply_ratio` | 1.15 | fleet headroom over bookings | Booking-system logs |

`demand_profile` (24 hourly multipliers) and `nt_shift_hours` shape the peaks;
`supply_flatness` controls how badly taxi supply follows demand.

### The default setup — and how much the answer depends on it

With no field data yet, the defaults describe a *congested but plausible* port:
550 walk-up passengers an hour, 1.3 per taxi, 8 urban / 3 NT stands, a 25.5-minute
taxi visit and an 8-minute paper ticket. The supply level is anchored to the
observed empty-taxi flow (1.05 urban, 0.95 NT), so the baseline reproduces the
port's current state rather than an assumed one.

Four numbers are behavioural assumptions rather than counts: the loaded share
(0.50 on average, but 86% at 09:00 and 18% at 19:00 through an hourly profile),
today's return pickup (0.40), the busy-rank threshold (0.50) and the turn-away
share (0.70). Fleet taxis are dispatched to bookings (0.75 minutes) rather than
arriving on a Poisson stream, so no idle fleet sits in the yard. `experiments/uncertainty.py` swings each to a plausible
low/high value, 30 seeds per point:

| Assumption | Low | High | Recommended wait |
|---|---|---|---|
| Loaded share | 0.35 | 0.65 | 6.7 → 4.9 min |
| Return pickup today | 0.25 | 0.55 | 4.8 → 7.0 min |
| Drivers skipping a busy rank | 0.40 | 0.90 | 5.7 → 5.8 min |
| Passenger patience | 25 | 45 min | 4.9 → 6.7 min |
| Taxi patience | 30 | 60 min | 6.0 → 5.9 min |

Across every behavioural swing the package lands between **4.8 and 7.0
minutes**, and it remains better than either single policy in every case. The
physical drivers dominate: demand (440–660 pax/h) moves it from 0.8 to 13.7
minutes and boarding time (1.2–1.8 min) from 2.9 to 12.8. That is expected —
those are the constraints, not the policy.

When you have even one measurement, put it in `config_site.json` (see
`config_site.example.json`) and rerun; the uncertainty range narrows.

## 4. The policies tested

| ID | Policy | What changes in the model | Type |
|---|---|---|---|
| — | **Baseline** | one staff-led platoon release per minute, fixed 8/3 bay split, 6% misrouting, 25% app use | current process |
| P1 | Continuous dispatch | release is event-driven instead of a 1-minute staff cycle | software |
| P2 | Pooled pickup bays | the 11 walk-up bays serve whichever lane has a passenger waiting | layout + software |
| P3 | App pre-registration | 85% of passengers pre-registered, boarding 25% faster | software |
| P4 | Flexible taxi pool | 35% of taxis may serve either urban or NT passengers | regulation |
| P5 | Two extra bays | 10 urban + 4 NT bays | capital works |
| P6 | Digital lane routing | misrouting falls from 6% to 1% | signage + app |
| P7 | Balance NT supply | NT taxi supply raised from 0.95 to 1.05 of demand | incentives |
| — | **All operational** | P1+P2+P3+P4+P6, no new bays | package |
| — | **Smart dispatch (full)** | operational package + 2 extra bays | Step 2 |

> The website's **All four on** preset enables the four cards on the page (ticket,
> return booking, driver information, extra stands). The *smart dispatch* package in
> this table is a wider research scenario from the earlier design and is not the same
> button.

### Driver incentives (supply-side policies)

Every policy above acts *inside* the port. None of them help if taxis do not
turn up — and the reason drivers skip Huanggang is the **return leg**: a taxi
that takes a fare to the port has no guaranteed fare back, so the trip is worth
less than an hour in the city. This is a repositioning problem, not a licensing
one: the taxi stays on the Hong Kong side and needs a passenger heading back
into town. Three supply-side instruments are modelled:

| Policy | Parameter | What the model assumes it does |
|---|---|---|
| Return-trip booking | `return_pickup` 0–1 | share of drop-offs that take a passenger back into Hong Kong instead of deadheading; today about 40%, the booking policy lifts it |
| Port pickup surcharge | `port_surcharge_hkd` 0–50 | a regulated extra fare on trips leaving the port |
| Waiting-time allowance | `wait_allowance_hkd` 0–4 | paid per minute spent queueing at the port |

Supply response, identical in both engines:

```
available supply = base_ratio x pickup_share x ticket x (1 + 0.45*surcharge/50 + 0.30*allowance/4)
```

The return-booking coefficient is **0.35**: full matching raises supply by 35%,
deliberately less than the trip's revenue gain, so the headline does not depend
on drivers responding one-for-one. A sweep from 0.20 to 0.60 moves the
recommended package's wait from 6.2 to 4.0 minutes — the direction never
changes, only the size.

**The coefficients are illustrative, not measured.** No driver supply
elasticity has been published for this port, so
`experiments/incentive_sweep.py` answers *"what does the model do if the
response looks like this"* — not *"what will happen"*.

Two results are robust to the coefficients, because they follow from the queue
ceasing to be supply-limited rather than from the sizes involved:

- **Incentives saturate.** Matching only 20% of return trips captures most of
  the benefit; going to 100% adds little.
- **They substitute rather than add.** All three at once is no better than the
  best single policy at a moderate setting.

| Setting | Mean wait (min) | vs baseline |
|---|---|---|
| Baseline (550 pax/h, no incentives) | 6.14 ± 0.55 | — |
| 20% of trips matched | 3.89 | −2.25 |
| 40% of trips matched | 3.60 | −2.54 |
| +50 HKD surcharge | 2.91 | −3.23 |
| 4 HKD/min allowance | 3.21 | −2.93 |
| all three at once | 3.29 ± 0.39 | −2.85 |

Eight replications per row, seeds 11–18 (`results/incentive_sweep.txt`).

### The queue-ticket regime (October 2026)

The rebuilt port opened on 12 October 2026 with a **paper queue ticket**: every
empty taxi must collect one at a public transport buffer zone before it can
reach the rank. The taxi trade reports **~8 minutes per trip**, paid by the
driver, and has asked the Transport Department to review it.

The model carries this as `ticket_delay_min`, and it enters as driver time
rather than passenger time:

```
supply = base_ratio x T / (T + delay)      T = average taxi time at the port (~25 min)
```

| Ticket delay | Mean wait | vs no ticket | Gave up |
|---|---|---|---|
| 8.0 min (paper, today) | 18.1 min | +8.2 | 19.5% |
| 4.0 min | 13.6 | +3.7 | 12.5% |
| 2.0 min | 11.8 | +1.9 | 10.0% |
| 1.5 min (digital) | 11.3 | +1.4 | 9.3% |
| 0 (no ticket) | 9.9 | — | 7.9% |

Because the hall is supply-limited, a 24% cut in supply does not degrade the
queue linearly — it tips. How strongly drivers actually respond to eight
minutes is unknown, so the *direction* is solid and the magnitude is an upper
bound; the uncertainty sweep in Section 4b brackets it.



### Sequencing: the ticket has to be fixed first

With the paper ticket in place, app pre-registration and extra stands measure at
**zero**. The hall is starved of taxis, so making boarding faster or adding
stands changes nothing. Once a digital ticket restores supply, the same two
policies are worth about four times as much — **0.6 minutes** each before,
**1.6 minutes** after:

| | paper ticket (8 min) | digital ticket (1.5 min) |
|---|---|---|
| baseline | 18.1 min | 11.3 min |
| + app pre-registration | 17.5 (−0.6) | 9.7 (−1.6) |
| + two extra stands | 17.6 (−0.5) | 9.7 (−1.6) |

This is why the policy cards show almost nothing until you switch the ticket on.

### Drivers react to the rank

Above half of a lane's buffer capacity, 70% of arriving taxis turn away rather
than queue. A taxi with a booking is exempt: it still has to wait, but it knows
the trip is paid, so it joins the rank regardless. Without this feedback the
rank fills to its physical limit and stays there:
with the policy on, the standing pool sat at ~105 taxis. With the feedback it
is ~66, and 1,249 of the day's visits are turned away in the 30-seed runs.

The parameters are unmeasured. Sweeping the threshold from 0.30 to 0.80 and the
turn-away share from 0.5 to 0.9 moves the recommended package's wait only
between **5.2 and 5.5 minutes** — the recommendation does not depend on where
this behaviour sits, which is the useful result.

### The return leg: a booking, not a border quota

The taxi never crosses the boundary. It drops a passenger at Huanggang and needs
someone going back into Hong Kong. A cross-border quota would let Hong Kong
taxis pick up *inside* Shenzhen — a different policy, for a different regulator,
requiring a bilateral agreement. It would not fill the empty Hong Kong-bound
leg, and the model never simulated it: the old card was a +50% supply
multiplier with a border story attached.

What the model does simulate is the share of drop-offs that leave with a booked
trip back. A passenger arriving from Shenzhen books a Hong Kong taxi before
clearing immigration; the booking goes to a taxi that has just dropped off, and
it uses its own stand, so the walk-up queue is untouched. That is a
repositioning fix: the same car, already at the port, leaves loaded.

| | Mean wait | Gave up |
|---|---|---|
| today | 18.7 min | 18.0% |
| digital ticket only | 11.8 min | 5.0% |
| return booking only | 10.2 min | 4.0% |
| **both** | **6.0 min** | **0.7%** |

The same runs show the mechanism: drop-offs that go back empty fall from **60%**
to **20%** once the booking policy is on.

Thirty replications of `BASE`, seeds 1–30. The browser engine gives 19.1, 12.1,
10.9 and 6.5 for the same rows, inside the confidence intervals reported by
`tests/parity_check.py`. The booking's effect is a modelling assumption (the
supply response is illustrative), so treat the size as an upper bound and the
direction as the finding.

### Sensitivity: which assumptions matter

Twenty replications per point, swinging each assumption around the current
baseline (paper ticket, 550 pax/h, 18.8 min):

| Assumption | Swing | Change |
|---|---|---|
| Demand ±20% | 440–660 pax/h | **15.3 min** |
| Taxi supply ±20% | 0.84–1.26× | 12.0 |
| Passenger patience | 25–45 min | 11.8 |
| Ticket delay | 4–12 min | 8.3 |
| How much the ticket deters drivers | dwell 20–32 min | 3.9 |
| Live information share | 0–60% | 2.1 |
| Boarding time | 1.2–1.8 min | 0.3 |

The headline is dominated by demand and supply because the hall is
supply-limited — a property of queueing systems, not of the model. Among the
things that were *assumed* rather than measured, patience matters most, then the
ticket response. Boarding time barely matters: the stands are not the
constraint, which is exactly why the operational package measures zero.

### Which policies fit this port

| Policy | Fits Huanggang today? |
|---|---|
| Digital queue ticket | yes — the live issue, and what the trade asked for |
| App / fleet pre-registration | yes — fleet taxis are already bookable |
| Two extra stands | capital works; the PTI layout is fixed as built |
| Return-trip booking | yes — booked trips use their own stand, so the walk-up queue is untouched |
| Port pickup surcharge | no — HK fares are uniform by meter, no location surcharge |
| Flexible taxis | no — green taxis stay licensed for NT destinations |
| Pooled pickup bays | no — red and green have separate stands by licence |
| Continuous dispatch, digital lane routing | measured at ~0 min either way |
| Overnight minimum service | no measurable effect: the model has more taxis than passengers after midnight |
| Red taxis helping the NT queue | legal, but measures at zero in both urban-heavy and NT-heavy mixes |

## 5. Results (default calibration, 30 replications each)

Mean ± 95% confidence interval. Replications use **common random numbers**, so
differences between rows are policy effects rather than sampling noise.

Waits here are measured over **served passengers only**, which is the
conventional definition. The website's headline KPI uses
`wait_mean_incl_abandon` — the same mean with people who gave up counted up to
the moment they left — because a policy that shortens the queue by driving the
longest waiters to abandon would otherwise look better than it is. Both
metrics are produced by both engines and compared in `tests/parity_check.py`.

| Scenario | Mean wait (min) | 90th pct wait (min) | Gave up (%) | Avg passengers waiting | Max waiting | Bay utilisation (%) | Taxis in buffer | Taxi time at port (min) | Throughput (pax/h) | Change |
|---|---|---|---|---|---|---|---|---|---|---|
| Baseline (current process) | 17.8 ± 0.5 | 29.8 ± 0.4 | 19.0 ± 0.7 | 136.4 ± 3.5 | 222 ± 5 | 73.3 ± 0.4 | 2.5 ± 0.2 | 3.5 ± 0.1 | 449 ± 3 | — |
| P1 Continuous dispatch | 17.6 ± 0.5 | 29.9 ± 0.3 | 18.9 ± 0.7 | 135.9 ± 3.6 | 223 ± 4 | 67.7 ± 0.4 | 1.1 ± 0.2 | 3.0 ± 0.1 | 450 ± 2 | -1% |
| P2 Pooled pickup bays | 17.4 ± 0.4 | 29.8 ± 0.3 | 18.7 ± 0.7 | 134.1 ± 3.3 | 219 ± 5 | 74.6 ± 0.4 | 2.2 ± 0.2 | 3.3 ± 0.1 | 452 ± 3 | -2% |
| P3 App pre-registration | 17.3 ± 0.5 | 29.8 ± 0.3 | 18.7 ± 0.6 | 133.0 ± 3.5 | 221 ± 6 | 61.8 ± 0.4 | 1.7 ± 0.2 | 2.7 ± 0.1 | 454 ± 3 | -3% |
| P4 Flexible taxi pool | 17.7 ± 0.5 | 29.8 ± 0.4 | 18.8 ± 0.7 | 135.5 ± 3.7 | 223 ± 5 | 73.8 ± 0.4 | 2.0 ± 0.3 | 3.2 ± 0.1 | 451 ± 3 | -0% |
| P5 Two extra bays | 17.3 ± 0.5 | 29.7 ± 0.4 | 18.7 ± 0.7 | 133.5 ± 3.7 | 221 ± 6 | 62.5 ± 0.4 | 1.7 ± 0.2 | 3.0 ± 0.1 | 454 ± 3 | -3% |
| P6 Digital lane routing | 17.5 ± 0.5 | 29.8 ± 0.3 | 18.8 ± 0.6 | 134.6 ± 3.3 | 222 ± 5 | 73.4 ± 0.4 | 2.7 ± 0.3 | 3.0 ± 0.1 | 451 ± 3 | -2% |
| P7 Balance NT supply | 17.1 ± 0.5 | 29.1 ± 0.4 | 17.4 ± 0.6 | 131.3 ± 3.6 | 221 ± 5 | 74.6 ± 0.3 | 2.6 ± 0.3 | 3.6 ± 0.1 | 459 ± 2 | -4% |
| All operational measures (no new bays) | 17.2 ± 0.5 | 29.9 ± 0.4 | 18.6 ± 0.7 | 134.0 ± 3.7 | 223 ± 5 | 53.9 ± 0.4 | 0.1 ± 0.0 | 1.4 ± 0.0 | 455 ± 3 | -3% |
| Smart dispatch + 2 extra bays (full package) | 17.2 ± 0.5 | 29.8 ± 0.4 | 18.5 ± 0.7 | 133.7 ± 3.7 | 222 ± 5 | 43.8 ± 0.3 | 0.1 ± 0.0 | 1.4 ± 0.0 | 455 ± 2 | -3% |

Thirty replications, seeds 1000–1029. `results/summary_table.md` is regenerated
by `run_experiments.py`.

### What the results say

1. **The hall is supply-limited, not bay-limited.** 17.8 minutes mean, 29.8 at
   the 90th percentile and 19.0% giving up — while only **2.5 empty taxis** wait
   in the buffer and bay utilisation is 73%. Passengers queue because taxis do
   not arrive, not because the stands are full.
2. **Under the paper ticket, operational measures buy little.** Continuous
   dispatch, pooled bays, app check-in, flexible taxis, extra bays, digital
   routing and the full package all land within ±4% of the baseline. P7 (NT
   supply) is the largest at −4%. The constraint is upstream of most of what the
   hall can do.
3. **The full package halves *utilisation*, not the wait.** Bay use falls from
   73% to 44% and the buffer drains, but passengers wait the same 3% less. It is
   optimising a constraint that is not binding — a useful negative result.
4. **The two levers that do work are supply-side**: the digital ticket and the
   return-trip booking, together 18.7 → 6.0 minutes (Section 4b). Neither needs
   a new bay.
5. **Capacity matters much more after supply is restored.** With the paper
   ticket, app check-in and two extra stands each buy about **0.6 minutes**
   (3%); with the ticket fixed they buy **1.6 minutes** each (14%). The ordering
   holds, the magnitude quadruples.
6. **A policy can look good on the wrong metric.** The package's buffer and
   utilisation numbers improve sharply; the passenger wait does not. That is why
   the headline is `wait_mean_incl_abandon` and not bay occupancy.

## 6. Mapping to your research questions

| Question | Where the answer comes from |
|---|---|
| **RQ1** How efficient is the current system? | `baseline` row: 17.8 min mean, 29.8 min p90, 19.0% give up, 73% bay utilisation, 2.5 taxis in the buffer |
| **RQ2** What drives passenger wait? | P1–P7 one-at-a-time comparison + the dispatch heat map + the patience sweep (Fig. 7) |
| **RQ3** Can a smart algorithm reduce queues? | `all_operational` and `smart_full` vs `baseline`; time series in Fig. 2 |
| **RQ4** How do policies perform? | the full table, the demand sweep (Fig. 3) and the 5×5 staffing surface (Fig. 4) |

Steps 1–3 of the brief map one-to-one onto `baseline`, `smart_full` and the
comparison printed at the end of every run.

## 7. Why you can trust the numbers

* **Replications, not single runs.** Every scenario is run 30 times with
  independent seeds and reported with a 95% confidence interval. Any difference
  whose intervals overlap is not a result.
* **Common random numbers.** All scenarios use the same seed list, so the
  comparison is paired and much less noisy.
* **Analytical validation.** With taxis made unlimited and all frictions
  switched off, the pickup bays become a pure M/M/c queue. The engine's point
  estimates sit within about 10% of the Erlang-C mean at every load, and every
  95% interval covers the analytical value — including at 94% utilisation, where
  a single replication is noisy by construction (`results/validation_mmc.csv`,
  Fig. 6).
* **Little's law.** For every replication, `L = λ_served·W_served +
  λ_abandoned·W_abandoned` is checked against the simulated time-average queue
  length; the gap is reported as `little_gap_pct` (typically < 2%).
* **Invariant tests.** `tests/test_engine.py` checks conservation of entities,
  capacity bounds, arrival-rate accuracy and the expected direction of every
  policy effect.
* **No silent failures.** The runner prints a consistency warning if utilisation
  exceeds 100%, if Little's law drifts, or if more customers finish than arrive.

## 8. Assumptions and limitations (use this section in your report)

* Taxi arrivals are **exogenous**: drivers do not learn or respond to the queue
  length within the day. `supply_lag_hours` approximates their slow response.
* No road network or routing: entry, buffer, bays and exit are abstract
  resources. This keeps the model transparent and fast, but it cannot answer
  questions about traffic on the approach roads.
* Pooling bays (P2) assumes the lane geometry allows a taxi of either class to
  reach any bay. If the lanes are physically separated, P2 is not implementable
  as modelled — this is a site-verification item.
* Passenger patience is not observed directly; the default (lognormal, mean
  35 min) is an assumption, and Fig. 7 shows how much the *reported* mean wait
  depends on it. A shorter tolerance hides the tail (censoring).
* The pre-booked channel is modelled as an independent queue with guaranteed
  supply; interaction between fleet taxis and the walk-up pool is not modelled.
* The supply response to driver incentives is **assumed, not estimated**: the
  three coefficients in section 4 are a plausible shape, not a measurement.
  The saturation and substitution results follow from the queue leaving the
  supply-limited regime, so they survive a wide range of coefficient values —
  but the *sizes* of the effects should not be quoted as predictions.
* A 1-hour warm-up is discarded; results describe the 11 measured hours.
* The service-time distribution is lognormal (CV 0.6). Exponential service is
  available (`service_dist="exp"`) for the analytical validation.

## 9. Extending the study

* Add a policy: write a new `replace(BASE, ...)` in `scenarios.py` and add it to
  `ORDER`/`LABELS` — no engine changes needed.
* Add a decision rule (e.g. "hold a taxi for a pre-booked passenger if the queue
  is below *n*"): edit `_release` / `_serve` in `engine.py`; the hooks are
  isolated.
* Add a cost model: multiply `taxi_dwell_mean` by the driver's hourly cost and
  `party_abandoned` by the value of a lost trip to turn minutes into HK$.
* Run longer horizons or 24-hour profiles by changing `duration_hours` and
  `start_hour`.

---

### Reproducing the tables and figures in this README

```bash
python run_experiments.py --reps 30 --sweep-reps 15
```

Outputs: `results/summary_table.md`, `scenarios_summary.csv`,
`scenarios_raw.csv`, `dispatch_heatmap.csv`, `sweep_demand.csv`,
`sweep_patience.csv`, `validation_mmc.csv`, and `fig1`–`fig7` PNGs at 300 dpi.
