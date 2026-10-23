"""
Discrete-event simulation engine for the Huanggang Port taxi dispatch study.

Model summary (see README.md for the full reasoning)
-----------------------------------------------------
The port taxi system is modelled as a *multi-class, multi-server queueing
network with a taxi-side buffer*:

    empty taxi --> [ buffer zone ] --> [ pickup bays ] --> departs with party
                          ^                  ^
                          |                  |
                    (batching,           (service = registration + boarding +
                    misrouting,           luggage, payment)
                    overflow)

    passenger --> [ class queue: urban / NT / pre-booked ] --> boards taxi

Three passenger classes share the same physical port but have separate
queueing lanes, exactly as at Huanggang Port:

    * ``urban``   - red urban taxis (Hong Kong Island / Kowloon)
    * ``nt``      - green New Territories taxis (Fanling / Sheung Shui ...)
    * ``prebook`` - fleet / pre-booked taxis, separate pickup area

The engine is deliberately policy-agnostic: every bottleneck listed in the
project brief is a switch in :class:`Config`, so "current process" and
"improved process" are the *same code* with different settings.

Every result is produced by Monte-Carlo replication (independent seeds) so
that differences between scenarios can be reported with 95% confidence
intervals instead of single-run point estimates.
"""

from __future__ import annotations

import heapq
import math
import random
from collections import deque
from dataclasses import dataclass, field, replace

CLASSES = ("urban", "nt", "prebook")
POOL_CLASSES = ("urban", "nt")  # classes that can share bays / flex taxis


# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
@dataclass
class Config:
    """All adjustable inputs of the port taxi system.

    Rates are per hour.  Profiles are 24-length tuples of multipliers indexed
    by hour of day (0 = 00:00-01:00) and are normalised to mean 1 by the
    engine, so ``pax_per_hour`` always means the *daily average*.
    """

    # ---- horizon -------------------------------------------------------
    duration_hours: float = 12.0
    start_hour: float = 8.0          # sim clock 0 == 08:00
    warmup_hours: float = 1.0        # statistics discarded before this

    # ---- passenger demand ---------------------------------------------
    pax_per_hour: float = 450.0      # average passengers per hour (whole port)
    party_size: float = 1.3          # passengers per taxi trip
    prebook_share: float = 0.10      # share using fleet / pre-booked channel
    urban_share: float = 0.75        # urban vs NT split of the walk-up demand
    demand_profile: tuple = (
        0.12, 0.08, 0.06, 0.05, 0.06, 0.15, 0.35, 0.70,
        1.30, 1.55, 1.45, 1.20, 1.05, 1.00, 1.05, 1.20,
        1.45, 1.60, 1.45, 1.15, 0.85, 0.60, 0.40, 0.25,
    )
    nt_shift_hours: int = 2          # NT demand peaks later than urban demand

    # ---- taxi supply ---------------------------------------------------
    # Taxi supply is anchored to the *observed* rate, not to the scenario
    # demand: in reality drivers keep coming at roughly the same rate even when
    # demand changes, which is what makes demand growth hurt.
    taxi_supply_basis_pax: float = 550.0    # demand level the supply was measured at
    taxi_supply_ratio_urban: float = 1.05   # supply / demand (1.0 = balanced)
    taxi_supply_ratio_nt: float = 0.95      # NT taxis are scarcer
    # ---- driver incentives ---------------------------------------------
    # A port trip is worth less than a city trip while the return leg is a
    # gamble, so drivers skip the port. These policies raise the expected
    # value of the trip and therefore the supply that turns up. The
    # coefficients below are illustrative, not measured (see README).
    backhaul_match: float = 0.0             # 0-1: share of trips with a matched return fare
    port_surcharge_hkd: float = 0.0         # regulated extra fare on port pickups
    wait_allowance_hkd: float = 0.0         # paid per minute waiting in the queue
    # ---- queue-ticket regime (new Huanggang Port, 2026) -----------------
    # Every empty taxi must collect a paper ticket at a buffer zone before it
    # can reach the rank. The taxi trade reports ~8 minutes per trip. That time
    # is paid by the driver, not the passenger, so it works like a cut in the
    # supply that turns up: a taxi spends T minutes per port visit, and T + delay
    # is what the driver now has to spend.
    # ---- information and night service --------------------------------
    info_share: float = 0.0                 # 0-1: drivers who check live demand before setting off
    night_min_taxis: float = 0.0            # taxis/hour guaranteed per lane between 00:00 and 06:00
    port_dwell_min: float = 25.5            # average taxi time at the port (model output)
    ticket_delay_min: float = 8.0           # 1.5 = digital ticket, 8 = paper ticket
    supply_lag_hours: int = 1               # drivers react one hour late
    supply_flatness: float = 0.55           # 0 = follows demand, 1 = flat
    night_supply_factor: float = 0.35       # extra thinning of supply between 00:00 and 06:00
    buffer_capacity: int = 40               # spaces per taxi lane (urban / NT)
    flex_buffer_capacity: int = 15          # spaces for flexible taxis
    prebook_supply_ratio: float = 1.15      # booking system guarantees supply

    # ---- pickup infrastructure ----------------------------------------
    stands: dict = field(default_factory=lambda: {"urban": 8, "nt": 3, "prebook": 2})
    stand_queue_capacity: int = 4    # taxis that can wait at the bays per class
    pooled_stands: bool = False      # bays shared dynamically between urban/NT

    # ---- service process ----------------------------------------------
    service_mean_min: dict = field(
        default_factory=lambda: {"urban": 1.5, "nt": 1.5, "prebook": 1.5}
    )
    service_cv: float = 0.60
    service_dist: str = "lognormal"  # "lognormal" | "exp"
    app_share: float = 0.0           # passengers pre-registered on app
    fast_checkin_factor: float = 1.0  # service-time multiplier for app users

    # ---- dispatch policy (the "manual vs smart" core) ------------------
    dispatch_interval_min: float = 0.5   # 0 => continuous (smart) release
    dispatch_batch: int = 8              # max taxis released per class/epoch
    dispatch_delay_min: float = 0.0      # staff reaction delay per release
    misroute_prob: float = 0.06          # taxi enters the wrong lane
    flex_share: float = 0.0              # taxis able to serve either lane
    flex_threshold: int = 3              # switch lanes only if other queue >= n

    # ---- driver / passenger behaviour ---------------------------------
    # Patience is lognormal (not exponential): a passenger who has waited two
    # minutes does not have the same hazard of leaving as one who has waited
    # thirty.  Low CV => a soft threshold, which is what is observed on site.
    patience_mean_min: float = 35.0      # passenger tolerance
    patience_cv: float = 0.35
    taxi_patience_mean_min: float = 45.0  # empty taxi gives up after this
    taxi_patience_cv: float = 0.40
    recirc_min: float = 8.0              # empty-circulation time (minutes)
    recirc_max: float = 20.0

    # ---- output --------------------------------------------------------
    sample_interval_min: float = 0.5
    record_trace: bool = False

    # ------------------------------------------------------------------
    @property
    def classes(self):
        return CLASSES

    @property
    def end_min(self):
        return self.duration_hours * 60.0

    @property
    def warm_min(self):
        return self.warmup_hours * 60.0


# ---------------------------------------------------------------------------
# Entities
# ---------------------------------------------------------------------------
class Taxi:
    __slots__ = ("t_first", "t_enter", "t_stand", "t_serve", "cls", "flex", "status")

    def __init__(self, t, cls, flex=False):
        self.t_first = t      # first arrival at the port (incl. before recirculation)
        self.t_enter = t      # entry into the buffer zone
        self.t_stand = 0.0    # arrival at a pickup bay
        self.t_serve = -1.0   # start of boarding
        self.cls = cls
        self.flex = flex
        self.status = "buffer"


class Pax:
    __slots__ = ("t_arr", "cls", "app", "status", "t_serve")

    def __init__(self, t, cls, app):
        self.t_arr = t
        self.cls = cls
        self.app = app
        self.status = "waiting"
        self.t_serve = -1.0


class Result:
    __slots__ = ("metrics", "trace")

    def __init__(self, metrics, trace=None):
        self.metrics = metrics
        self.trace = trace


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _pct(sorted_vals, q):
    if not sorted_vals:
        return float("nan")
    k = (len(sorted_vals) - 1) * q
    f, c = math.floor(k), math.ceil(k)
    if f == c:
        return sorted_vals[int(k)]
    return sorted_vals[f] * (c - k) + sorted_vals[c] * (k - f)


def _mean(vals):
    return sum(vals) / len(vals) if vals else float("nan")


def _normalise(profile, hours=None):
    """Scale a 24h multiplier profile so its mean equals 1."""
    hours = hours if hours else range(len(profile))
    m = sum(profile[h] for h in hours) / len(hours)
    return tuple(v / m for v in profile) if m > 0 else profile


def _lognormal(rng, mean, cv):
    sigma2 = math.log(1.0 + cv * cv)
    mu = math.log(mean) - sigma2 / 2.0
    return math.exp(rng.gauss(mu, math.sqrt(sigma2)))


def rotated(profile, lag):
    """Shift a 24h profile forward by ``lag`` hours (drivers react late)."""
    n = len(profile)
    return tuple(profile[(h - lag) % n] for h in range(n))


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------
class Simulation:
    """One replication of the port taxi system."""

    def __init__(self, cfg: Config, seed: int = 0):
        self.cfg = cfg
        self.rng = random.Random(seed)
        self.t = 0.0
        self.seq = 0
        self.events = []

        # --- queues -----------------------------------------------------
        self.buf = {c: deque() for c in CLASSES}   # taxis in buffer, per lane
        self.flex_buf = deque()                    # flexible taxis in buffer
        self.stand = {c: deque() for c in CLASSES}  # taxis waiting at the bays
        self.pq = {c: deque() for c in CLASSES}    # passengers waiting
        self.busy = {c: 0 for c in CLASSES}        # bays currently boarding

        self.stands_total = sum(cfg.stands.values())
        # bays that the urban/NT pool may share (pre-booked bays are separate)
        self.pool_stands = cfg.stands["urban"] + cfg.stands["nt"]

        # --- arrival rates ----------------------------------------------
        # Profiles are normalised over the *simulated window* (not the whole
        # day) so that ``pax_per_hour`` is the average rate of the shift being
        # studied and the peak/average ratio keeps its real meaning.
        self.demand_mult = _normalise(cfg.demand_profile, self._window_hours())
        self.nt_mult = _normalise(
            rotated(cfg.demand_profile, cfg.nt_shift_hours), self._window_hours()
        )
        flat = tuple(
            (
                (1.0 - cfg.supply_flatness)
                * rotated(cfg.demand_profile, cfg.supply_lag_hours)[h]
                + cfg.supply_flatness
            )
            * (cfg.night_supply_factor if h < 6 else 1.0)
            for h in range(24)
        )
        self.supply_mult = _normalise(flat, self._window_hours())

        parties = cfg.pax_per_hour / cfg.party_size
        self.base_party_rate = {
            "urban": parties * (1 - cfg.prebook_share) * cfg.urban_share,
            "nt": parties * (1 - cfg.prebook_share) * (1 - cfg.urban_share),
            "prebook": parties * cfg.prebook_share,
        }
        incentive = (
            1.0
            + 0.60 * cfg.backhaul_match
            + 0.45 * (cfg.port_surcharge_hkd / 50.0)
            + 0.30 * (cfg.wait_allowance_hkd / 4.0)
        )
        # a driver's visit now costs dwell + ticket time instead of dwell
        ticket = cfg.port_dwell_min / max(1.0, cfg.port_dwell_min + cfg.ticket_delay_min)
        incentive *= ticket
        self.supply_ratio = {
            "urban": cfg.taxi_supply_ratio_urban * incentive,
            "nt": cfg.taxi_supply_ratio_nt * incentive,
            "prebook": cfg.prebook_supply_ratio,
        }
        # empty-taxi flow is anchored to the observed demand level
        supply_parties = cfg.taxi_supply_basis_pax / cfg.party_size
        self.base_taxi_rate = {
            "urban": supply_parties * (1 - cfg.prebook_share) * cfg.urban_share,
            "nt": supply_parties * (1 - cfg.prebook_share) * (1 - cfg.urban_share),
            "prebook": supply_parties * cfg.prebook_share,
        }

        # --- accumulators ------------------------------------------------
        self.waits = []           # served parties, minutes
        self.abandon_waits = []   # parties that gave up, minutes waited
        self.waits_by_class = {c: [] for c in CLASSES}
        self.pax_arrived = 0
        self.pax_served = 0
        self.pax_abandoned = 0
        self.taxi_arrived = 0
        self.taxi_served = 0
        self.taxi_left_empty = 0
        self.misroutes = 0
        self.recircs = 0
        self.taxi_diverted = 0
        self.taxi_buffer_waits = []
        self.taxi_dwells = []

        # time-average samples
        self.s_q = {c: [] for c in CLASSES}
        self.s_busy = []
        self.s_buf = []
        self.s_wait = []   # buffer + stand queue: what a visitor sees as waiting
        self.s_t = []

        self._schedule()

    def _window_hours(self):
        n = int(math.ceil(self.cfg.duration_hours))
        return [int(self.cfg.start_hour + i) % 24 for i in range(n)]

    # ------------------------------------------------------------------
    # rate functions
    # ------------------------------------------------------------------
    def _hour(self, t):
        return int((self.cfg.start_hour + t / 60.0) % 24)

    def _pax_rate(self, cls, hour):
        """Passengers of ``cls`` per hour at a given hour of day."""
        mult = self.nt_mult[hour] if cls == "nt" else self.demand_mult[hour]
        return self.base_party_rate[cls] * mult

    def _taxi_rate(self, cls, hour):
        """Empty taxis of ``cls`` per hour at a given hour of day."""
        if cls == "prebook":
            # bookings are scheduled, so supply follows the booking curve and
            # is guaranteed by the operator
            return self.base_taxi_rate[cls] * self.supply_ratio[cls] * self.demand_mult[hour]

        rate = self.base_taxi_rate[cls] * self.supply_ratio[cls] * self.supply_mult[hour]
        # a contracted overnight minimum keeps a few cars available all night
        if hour < 6 and self.cfg.night_min_taxis > 0:
            rate = max(rate, self.cfg.night_min_taxis)
        return rate

    def _poisson_times(self, rate_fn):
        """Exact sampling of a non-homogeneous Poisson process (piecewise
        constant rates, one segment per clock hour)."""
        t = 0.0
        end = self.cfg.end_min
        out = []
        while t < end:
            hour = self._hour(t)
            rate = rate_fn(hour)
            if rate <= 0:
                t = (int(t // 60) + 1) * 60.0
                continue
            seg_end = (int(t // 60) + 1) * 60.0
            dt = self.rng.expovariate(rate / 60.0)  # minutes
            if t + dt >= seg_end:
                t = seg_end
                continue
            t += dt
            if t < end:
                out.append(t)
        return out

    # ------------------------------------------------------------------
    def _schedule(self):
        cfg = self.cfg
        push = self.events.append
        heapify = heapq.heapify

        for cls in CLASSES:
            for t in self._poisson_times(lambda h, c=cls: self._pax_rate(c, h)):
                pax = Pax(t, cls, self.rng.random() < cfg.app_share)
                push((t, 0, "PAX", pax))
            for t in self._poisson_times(lambda h, c=cls: self._taxi_rate(c, h)):
                flex = cls == "urban" and self.rng.random() < cfg.flex_share
                push((t, 1, "TAXI", (cls if not flex else None, t, flex)))

        # dispatch epochs (manual process) + time-average sampling
        if cfg.dispatch_interval_min and cfg.dispatch_interval_min > 0:
            t = cfg.dispatch_delay_min
            while t < cfg.end_min:
                push((t, 2, "RELEASE", None))
                t += cfg.dispatch_interval_min

        t = 0.0
        while t <= cfg.end_min:
            push((t, 3, "SAMPLE", None))
            t += cfg.sample_interval_min

        # heapq needs ordered tuples; every payload is unique-ordered by seq
        # so wrap with a monotonic counter to avoid comparing payloads
        wrapped = [(e[0], self._next_seq(), e[2], e[3]) for e in self.events]
        self.events = wrapped
        heapify(self.events)

    def _next_seq(self):
        self.seq += 1
        return self.seq

    # ------------------------------------------------------------------
    # helpers: state queries
    # ------------------------------------------------------------------
    def _buffer_len(self, cls=None):
        if cls is None:
            return len(self.buf["urban"]) + len(self.buf["nt"]) + len(self.flex_buf)
        if cls == "flex":
            return len(self.flex_buf)
        return len(self.buf[cls])

    def _buffer_full(self, cls, flex):
        if flex:
            return len(self.flex_buf) >= self.cfg.flex_buffer_capacity
        return len(self.buf[cls]) >= self.cfg.buffer_capacity

    def _has_capacity(self, cls):
        if self.cfg.pooled_stands and cls in POOL_CLASSES:
            return (self.busy["urban"] + self.busy["nt"]) < self.pool_stands
        return self.busy[cls] < self.cfg.stands[cls]

    def _pop_taxi_for(self, cls):
        """Oldest taxi in the buffer that is able to serve ``cls`` (FIFO)."""
        lane = self.buf[cls] if cls in self.buf else None
        if cls not in POOL_CLASSES:
            return lane.popleft() if lane else None
        # urban / NT: a taxi can serve if it belongs to the lane or is flexible
        if not self.flex_buf:
            return lane.popleft() if lane else None
        if not lane:
            tx = self.flex_buf.popleft()
            tx.cls = cls
            return tx
        if lane[0].t_enter <= self.flex_buf[0].t_enter:
            return lane.popleft()
        tx = self.flex_buf.popleft()
        tx.cls = cls
        return tx

    def _pick_class(self, candidates):
        """Which lane gets the next free bay?

        Works in FIFO order per class; when bays are pooled the longest-waiting
        passenger is served first (a simple fairness / anti-starvation rule).
        """
        if len(candidates) == 1:
            return candidates[0]
        best, best_wait = candidates[0], -1.0
        for c in candidates:
            w = self.t - self.pq[c][0].t_arr
            if w > best_wait:
                best, best_wait = c, w
        return best

    # ------------------------------------------------------------------
    # core transitions
    # ------------------------------------------------------------------
    def _release(self, cls, budget):
        """Move taxis from the buffer zone to the pickup bays."""
        room = self.cfg.stand_queue_capacity - len(self.stand[cls])
        n = 0
        while n < budget and room > 0:
            tx = self._pop_taxi_for(cls)
            if tx is None:
                break
            tx.status = "stand"
            tx.t_stand = self.t
            self.stand[cls].append(tx)
            room -= 1
            n += 1

    def _release_continuous(self):
        for cls in CLASSES:
            self._release(cls, 10 ** 9)

    def _serve(self):
        """Start as many boardings as bays, taxis and passengers allow."""
        while True:
            cands = [
                c
                for c in CLASSES
                if self.pq[c] and self.stand[c] and self._has_capacity(c)
            ]
            if not cands:
                return
            self._start_boarding(self._pick_class(cands))

    def _start_boarding(self, cls):
        tx = self.stand[cls].popleft()
        pax = self.pq[cls].popleft()
        pax.status = "boarded"
        pax.t_serve = self.t
        tx.t_serve = self.t
        self.busy[cls] += 1
        # ---- statistics: only passengers/taxis of the measured cohort ----
        if pax.t_arr >= self.cfg.warm_min:
            self.waits.append(self.t - pax.t_arr)
            self.waits_by_class[cls].append(self.t - pax.t_arr)
            self.pax_served += 1
        if tx.t_enter >= self.cfg.warm_min:
            self.taxi_buffer_waits.append(self.t - tx.t_enter)
        dur = self._service_time(cls, pax)
        heapq.heappush(
            self.events, (self.t + dur, self._next_seq(), "SERVICE", (tx, cls))
        )

    def _service_time(self, cls, pax):
        m = self.cfg.service_mean_min[cls]
        if pax.app and self.cfg.fast_checkin_factor != 1.0:
            m *= self.cfg.fast_checkin_factor
        if self.cfg.service_dist == "exp":
            return self.rng.expovariate(1.0 / m)
        return min(_lognormal(self.rng, m, self.cfg.service_cv), 8.0 * m)

    def _enter_buffer(self, cls, t_first, flex):
        cfg = self.cfg
        if (cls in POOL_CLASSES or flex) and self._buffer_full(cls, flex):
            # buffer zone full -> the taxi has to circulate and try again
            self.recircs += 1
            self._schedule_recirc(cls, t_first, flex)
            return
        tx = Taxi(self.t, cls, flex)
        tx.t_first = t_first
        if flex:
            self.flex_buf.append(tx)
        else:
            self.buf[cls].append(tx)
        self.taxi_arrived += 1
        # driver gives up if not called forward in time
        if cfg.taxi_patience_mean_min < float("inf"):
            patience = _lognormal(
                self.rng, cfg.taxi_patience_mean_min, cfg.taxi_patience_cv
            )
            heapq.heappush(
                self.events, (self.t + patience, self._next_seq(), "GIVEUP", tx)
            )

    def _schedule_recirc(self, cls, t_first, flex=False):
        delay = self.rng.uniform(self.cfg.recirc_min, self.cfg.recirc_max)
        heapq.heappush(
            self.events, (self.t + delay, self._next_seq(), "RECIRC", (cls, t_first, flex))
        )

    # ------------------------------------------------------------------
    # event handling
    # ------------------------------------------------------------------
    def run(self) -> Result:
        cfg = self.cfg
        end = cfg.end_min
        warm = cfg.warm_min

        while self.events:
            t, _, kind, payload = heapq.heappop(self.events)
            if t > end:
                break
            self.t = t

            if kind == "PAX":
                pax = payload
                self.pq[pax.cls].append(pax)
                if t >= warm:
                    self.pax_arrived += 1
                if cfg.patience_mean_min < float("inf"):
                    pat = _lognormal(
                        self.rng, cfg.patience_mean_min, cfg.patience_cv
                    )
                    heapq.heappush(
                        self.events, (t + pat, self._next_seq(), "ABANDON", pax)
                    )
                if cfg.dispatch_interval_min <= 0:
                    self._release_continuous()
                self._serve()

            elif kind == "TAXI":
                cls, t_first, flex = payload
                if (
                    cfg.info_share > 0
                    and len(self.pq[cls]) < 6
                    and self.rng.random() < cfg.info_share
                ):
                    self.taxi_diverted += 1
                    continue
                if (
                    cls in POOL_CLASSES
                    and not flex
                    and cfg.misroute_prob > 0
                    and self.rng.random() < cfg.misroute_prob
                ):
                    # sent down the wrong lane, staff redirect -> extra empty
                    # driving before the taxi can queue again
                    self.misroutes += 1
                    self._schedule_recirc(cls, t_first, flex)
                    continue
                self._enter_buffer(cls, t_first, flex)
                if cfg.dispatch_interval_min <= 0:
                    self._release_continuous()
                self._serve()

            elif kind == "RECIRC":
                cls, t_first, flex = payload
                self.recircs += 1
                self._enter_buffer(cls, t_first, flex)
                if cfg.dispatch_interval_min <= 0:
                    self._release_continuous()
                self._serve()

            elif kind == "RELEASE":
                for cls in CLASSES:
                    self._release(cls, cfg.dispatch_batch)
                self._serve()

            elif kind == "SERVICE":
                tx, cls = payload
                self.busy[cls] -= 1
                self.taxi_served += 1
                self.taxi_dwells.append(self.t - tx.t_first)
                if tx.status != "left":
                    tx.status = "done"
                if cfg.dispatch_interval_min <= 0:
                    self._release_continuous()
                self._serve()

            elif kind == "ABANDON":
                pax = payload
                if pax.status == "waiting":
                    pax.status = "abandoned"
                    try:
                        self.pq[pax.cls].remove(pax)
                    except ValueError:
                        pass
                    if t >= warm:
                        self.pax_abandoned += 1
                        self.abandon_waits.append(t - pax.t_arr)

            elif kind == "GIVEUP":
                tx = payload
                if tx.status == "buffer":
                    tx.status = "left"
                    lane = self.flex_buf if tx.flex else self.buf[tx.cls]
                    try:
                        lane.remove(tx)
                    except ValueError:
                        pass
                    if t >= warm:
                        self.taxi_left_empty += 1

            elif kind == "SAMPLE":
                if t >= warm:
                    self._sample()

        return self._result()

    # ------------------------------------------------------------------
    def _sample(self):
        self.s_t.append(self.t)
        for c in CLASSES:
            self.s_q[c].append(len(self.pq[c]))
        self.s_busy.append(sum(self.busy.values()))
        self.s_buf.append(self._buffer_len())
        # taxis queued behind the stands are waiting too; counting only the
        # buffer made the KPI say "1 waiting" while the animation showed 20
        self.s_wait.append(
            self._buffer_len() + sum(len(self.stand[c]) for c in CLASSES)
        )

    def _result(self) -> Result:
        cfg = self.cfg
        window_h = max((cfg.end_min - cfg.warm_min) / 60.0, 1e-9)

        # Wait times are recorded inside the loop only for passengers that
        # actually completed boarding, so reconstruct them here.
        waits = self.waits
        by_class = self.waits_by_class

        q_total = [sum(v[i] for v in self.s_q.values()) for i in range(len(self.s_t))]
        buf = self.s_buf
        busy = self.s_busy

        served_h = self.pax_served / window_h
        mean_wait = _mean(waits)
        l_time = _mean(q_total)
        # Little's law: L = lambda_served * W_served + lambda_abandoned * W_abandoned
        l_law = (
            self.pax_served * mean_wait + self.pax_abandoned * _mean(self.abandon_waits)
        ) / (60.0 * window_h)
        all_waits = waits + self.abandon_waits
        measured = self.pax_served + self.pax_abandoned

        m = {
            "window_h": window_h,
            # ---- passenger side -------------------------------------
            "party_arrived": self.pax_arrived,
            "party_served": self.pax_served,
            "party_abandoned": self.pax_abandoned,
            "abandon_rate_pct": 100.0 * self.pax_abandoned / max(measured, 1),
            "wait_mean": mean_wait,
            "wait_mean_incl_abandon": _mean(all_waits),
            "wait_median": _pct(sorted(waits), 0.5),
            "wait_p90": _pct(sorted(waits), 0.9),
            "wait_p95": _pct(sorted(waits), 0.95),
            "wait_max": max(waits) if waits else float("nan"),
            "wait_mean_urban": _mean(by_class["urban"]),
            "wait_mean_nt": _mean(by_class["nt"]),
            "wait_mean_prebook": _mean(by_class["prebook"]),
            "throughput_pax_h": served_h * cfg.party_size,
            # ---- queueing -------------------------------------------
            "queue_avg": l_time,
            "queue_avg_urban": _mean(self.s_q["urban"]),
            "queue_avg_nt": _mean(self.s_q["nt"]),
            "queue_max": max(q_total) if q_total else 0,
            "queue_p90": _pct(sorted(q_total), 0.9),
            "little_l_time": l_time,
            "little_l_law": l_law,
            "little_gap_pct": 100.0 * (l_time - l_law) / max(l_law, 1e-9),
            # ---- taxi side ------------------------------------------
            "taxi_arrived": self.taxi_arrived,
            "taxi_served": self.taxi_served,
            "taxi_left_empty": self.taxi_left_empty,
            "taxi_diverted": self.taxi_diverted,
            "taxi_waste_pct": 100.0 * self.taxi_left_empty / max(self.taxi_arrived, 1),
            "buffer_avg": _mean(buf),
            "taxi_waiting_avg": _mean(self.s_wait),
            "buffer_max": max(buf) if buf else 0,
            "taxi_wait_mean": _mean(self.taxi_buffer_waits),
            "taxi_dwell_mean": _mean(self.taxi_dwells),
            "misroutes": self.misroutes,
            "recirculations": self.recircs,
            # ---- infrastructure --------------------------------------
            "stands_total": self.stands_total,
            "stand_util_pct": 100.0 * _mean(busy) / max(self.stands_total, 1),
            "stand_idle_pct": 100.0
            - 100.0 * _mean(busy) / max(self.stands_total, 1),
        }

        trace = None
        if cfg.record_trace:
            trace = {
                "t_min": list(self.s_t),
                "q_urban": list(self.s_q["urban"]),
                "q_nt": list(self.s_q["nt"]),
                "q_prebook": list(self.s_q["prebook"]),
                "busy": list(self.s_busy),
                "buffer": list(self.s_buf),
                "waits": list(self.waits),
            }
        return Result(m, trace)


# ---------------------------------------------------------------------------
def simulate(cfg: Config, seed: int = 0) -> Result:
    """Run one replication."""
    return Simulation(cfg, seed).run()
