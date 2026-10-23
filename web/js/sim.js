/**
 * Huanggang Port taxi dispatch — browser/Node port of `taxi_sim/engine.py`.
 *
 * Same model, same parameters, same event logic.  Kept deliberately close to
 * the Python version so the two can be compared (see tests/parity_check.py):
 *
 *   empty taxi -> buffer lane -> pickup bays -> departs
 *   passenger  -> class queue -> boards -> leaves
 *
 * Three passenger classes: urban (red), NT (green), pre-booked (blue).
 * Everything is policy-agnostic: "current process" and "smart dispatch" are
 * the same code with different settings.
 */

export const CLS = { urban: 0, nt: 1, prebook: 2, flex: 3 };
export const CLASSES = ["urban", "nt", "prebook"];
export const POOL_CLASSES = ["urban", "nt"];

/* ------------------------------------------------------------------ *
 * Deterministic RNG (mulberry32) — seeded so every run is repeatable
 * ------------------------------------------------------------------ */
export function makeRng(seed) {
  let a = (seed >>> 0) || 1;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const safeMean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const expo = (rng, rate) => -Math.log(1 - rng()) / rate;
const uniform = (rng, lo, hi) => lo + (hi - lo) * rng();

/** Box–Muller, one value per call (close enough to Python's gauss). */
const gauss = (rng) => {
  const u = Math.max(rng(), 1e-12);
  const v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};

const lognormal = (rng, mean, cv) => {
  const s2 = Math.log(1 + cv * cv);
  return Math.exp(Math.log(mean) - s2 / 2 + Math.sqrt(s2) * gauss(rng));
};

/* ------------------------------------------------------------------ *
 * Defaults — mirror of scenarios.BASE
 * ------------------------------------------------------------------ */
export const DEFAULTS = {
  durationHours: 12,
  startHour: 8,
  warmupHours: 1,

  paxPerHour: 550,
  partySize: 1.3,
  prebookShare: 0.1,
  urbanShare: 0.75,
  demandProfile: [
    0.12, 0.08, 0.06, 0.05, 0.06, 0.15, 0.35, 0.7,
    1.3, 1.55, 1.45, 1.2, 1.05, 1.0, 1.05, 1.2,
    1.45, 1.6, 1.45, 1.15, 0.85, 0.6, 0.4, 0.25,
  ],
  ntShiftHours: 2,

  taxiSupplyBasisPax: 550,
  taxiSupplyRatioUrban: 1.05,
  taxiSupplyRatioNt: 0.95,
  // driver incentives: each raises the expected value of a port trip, which
  // raises how many empty taxis choose to come. Coefficients are illustrative
  // (see README "what the incentives actually assume").
  backhaulMatch: 0,
  portSurchargeHkd: 0,
  waitAllowanceHkd: 0,
  // queue-ticket regime: paper ticket at the buffer costs the driver ~8 min
  portDwellMin: 25.5,
  ticketDelayMin: 8,
  infoShare: 0,
  nightMinTaxis: 0,
  supplyLagHours: 2,
  supplyFlatness: 0.55,
  nightSupplyFactor: 0.35,
  prebookSupplyRatio: 1.15,
  bufferCapacity: 40,
  flexBufferCapacity: 15,

  stands: { urban: 8, nt: 3, prebook: 2 },
  standQueueCapacity: 12,
  pooledStands: false,

  serviceMeanMin: { urban: 1.5, nt: 1.5, prebook: 1.5 },
  serviceCv: 0.6,
  serviceDist: "lognormal",
  appShare: 0,
  fastCheckinFactor: 1,

  dispatchIntervalMin: 1,
  dispatchBatch: 8,
  dispatchDelayMin: 0,
  misrouteProb: 0.06,
  flexShare: 0,

  patienceMeanMin: 35,
  patienceCv: 0.35,
  taxiPatienceMeanMin: 45,
  taxiPatienceCv: 0.4,
  recircMin: 8,
  recircMax: 20,

  sampleIntervalMin: 0.5,
};

/* ------------------------------------------------------------------ *
 * Binary min-heap on (time, sequence)
 * ------------------------------------------------------------------ */
class Heap {
  constructor() {
    this.a = [];
  }
  get size() {
    return this.a.length;
  }
  static lt(x, y) {
    return x[0] < y[0] || (x[0] === y[0] && x[1] < y[1]);
  }
  push(x) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (Heap.lt(a[i], a[p])) {
        const t = a[i];
        a[i] = a[p];
        a[p] = t;
        i = p;
      } else break;
    }
  }
  pop() {
    const a = this.a;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && Heap.lt(a[l], a[m])) m = l;
        if (r < a.length && Heap.lt(a[r], a[m])) m = r;
        if (m === i) break;
        const t = a[i];
        a[i] = a[m];
        a[m] = t;
        i = m;
      }
    }
    return top;
  }
}

/* ------------------------------------------------------------------ *
 * Event kinds
 * ------------------------------------------------------------------ */
const EV = {
  PAX: 0, TAXI: 1, ABANDON: 2, GIVEUP: 3,
  SERVICE: 4, RELEASE: 5, RECIRC: 6, SAMPLE: 7, FRAME: 8,
};

/* ------------------------------------------------------------------ *
 * Simulation
 * ------------------------------------------------------------------ */
export class Simulation {
  constructor(config, seed = 1) {
    const cfg = { ...DEFAULTS, ...config };
    cfg.stands = { ...DEFAULTS.stands, ...(config.stands || {}) };
    cfg.serviceMeanMin = { ...DEFAULTS.serviceMeanMin, ...(config.serviceMeanMin || {}) };
    this.cfg = cfg;
    this.rng = makeRng(seed);
    this.seed = seed;
    this.t = 0;
    this.seq = 0;
    this.end = cfg.durationHours * 60;
    this.warm = cfg.warmupHours * 60;
    this.queue = new Heap();

    // ---- state ----
    this.buf = { urban: [], nt: [], prebook: [] };
    this.flexBuf = [];
    this.stand = { urban: [], nt: [], prebook: [] };
    this.pq = { urban: [], nt: [], prebook: [] };
    this.busy = { urban: 0, nt: 0, prebook: 0 };

    this.standsTotal = cfg.stands.urban + cfg.stands.nt + cfg.stands.prebook;

    // bay ownership, grouped (pooled urban/NT share one bank)
    this.bayOwner = {};
    for (const c of CLASSES) {
      const g = this.bayGroup(c);
      if (!this.bayOwner[g]) {
        const n = g === "pool" ? cfg.stands.urban + cfg.stands.nt : cfg.stands[c];
        this.bayOwner[g] = new Array(n).fill(null);
      }
    }

    // ---- rates ----
    this.buildRates();

    // ---- accumulators ----
    this.waits = [];
    this.waitsByClass = { urban: [], nt: [], prebook: [] };
    this.abandonWaits = [];
    this.paxArrived = 0;
    this.paxServed = 0;
    this.paxAbandoned = 0;
    this.taxiArrived = 0;
    this.taxiServed = 0;
    this.taxiLeftEmpty = 0;
    this.misroutes = 0;
    this.recirc = 0;
    this.taxiBufferWaits = [];
    this.taxiDwells = [];
    this.qSum = 0;
    this.qMax = 0;
    this.busySum = 0;
    this.bufSum = 0;
    this.waitSum = 0;
    this.bufSumUrban = 0;
    this.bufSumNt = 0;
    this.overflowUrban = 0;
    this.overflowNt = 0;
    this.bufMax = 0;
    this.urbanFullSamples = 0;
    this.nSamples = 0;

    // ---- animation ----
    this.frames = [];
    this.framesOn = !!cfg.anim;
    this.taxiSeq = 0;
    this.paxSeq = 0;

    this.schedule();
  }

  bayGroup(cls) {
    return this.cfg.pooledStands && POOL_CLASSES.includes(cls) ? "pool" : cls;
  }

  hour(t) {
    return Math.floor((this.cfg.startHour + t / 60) % 24);
  }

  windowHours() {
    const n = Math.ceil(this.cfg.durationHours);
    const out = [];
    for (let i = 0; i < n; i++) out.push(Math.floor(this.cfg.startHour + i) % 24);
    return out;
  }

  static norm(profile, hours) {
    let s = 0;
    for (const h of hours) s += profile[h];
    const m = s / hours.length;
    return profile.map((v) => v / m);
  }

  buildRates() {
    const cfg = this.cfg;
    const wh = this.windowHours();
    const rotated = (lag) => cfg.demandProfile.map((_, h) => cfg.demandProfile[(h - lag + 24) % 24]);

    this.demandMult = Simulation.norm(cfg.demandProfile, wh);
    this.ntMult = Simulation.norm(rotated(cfg.ntShiftHours), wh);
    const lagged = rotated(cfg.supplyLagHours);
    const flat = lagged.map((v, h) =>
      ((1 - cfg.supplyFlatness) * v + cfg.supplyFlatness) *
      (h < 6 ? (cfg.nightSupplyFactor ?? 0.35) : 1));
    this.supplyMult = Simulation.norm(flat, wh);

    const parties = cfg.paxPerHour / cfg.partySize;
    this.basePartyRate = {
      urban: parties * (1 - cfg.prebookShare) * cfg.urbanShare,
      nt: parties * (1 - cfg.prebookShare) * (1 - cfg.urbanShare),
      prebook: parties * cfg.prebookShare,
    };

    const supplyParties = cfg.taxiSupplyBasisPax / cfg.partySize;
    this.baseTaxiRate = {
      urban: supplyParties * (1 - cfg.prebookShare) * cfg.urbanShare,
      nt: supplyParties * (1 - cfg.prebookShare) * (1 - cfg.urbanShare),
      prebook: supplyParties * cfg.prebookShare,
    };
    // A port trip is worth less than a city trip while the return leg is a
    // gamble. These policies raise that value, so more drivers accept the run.
    let incentive =
      1 +
      0.6 * (cfg.backhaulMatch || 0) +
      0.45 * ((cfg.portSurchargeHkd || 0) / 50) +
      0.3 * ((cfg.waitAllowanceHkd || 0) / 4);

    // the ticket is driver time, not passenger time: it lengthens every visit
    const dwell = cfg.portDwellMin ?? 25.5;
    incentive *= dwell / Math.max(1, dwell + (cfg.ticketDelayMin || 0));

    this.supplyRatio = {
      urban: cfg.taxiSupplyRatioUrban * incentive,
      nt: cfg.taxiSupplyRatioNt * incentive,
      prebook: cfg.prebookSupplyRatio,
    };
  }

  paxRate(cls, hour) {
    const mult = cls === "nt" ? this.ntMult[hour] : this.demandMult[hour];
    return this.basePartyRate[cls] * mult;
  }

  taxiRate(cls, hour) {
    if (cls === "prebook") {
      return this.baseTaxiRate.prebook * this.supplyRatio.prebook * this.demandMult[hour];
    }
    let rate = this.baseTaxiRate[cls] * this.supplyRatio[cls] * this.supplyMult[hour];
    // a contracted overnight minimum keeps a few cars available all night
    if (hour < 6 && this.cfg.nightMinTaxis > 0) {
      rate = Math.max(rate, this.cfg.nightMinTaxis);
    }
    return rate;
  }

  /** Exact non-homogeneous Poisson sampling, piecewise constant per hour. */
  poissonTimes(rateFn) {
    const out = [];
    const rng = this.rng;
    let t = 0;
    const end = this.end;
    while (t < end) {
      const rate = rateFn(this.hour(t));
      let segEnd = (Math.floor(this.cfg.startHour + t / 60) + 1 - this.cfg.startHour) * 60;
      if (segEnd <= t) segEnd = t + 60;
      if (rate <= 0) {
        t = segEnd;
        continue;
      }
      const dt = expo(rng, rate / 60);
      if (t + dt >= segEnd) {
        t = segEnd;
        continue;
      }
      t += dt;
      if (t < end) out.push(t);
    }
    return out;
  }

  push(t, kind, a, b, c) {
    this.queue.push([t, this.seq++, kind, a, b, c]);
  }

  schedule() {
    const cfg = this.cfg;

    for (const cls of CLASSES) {
      for (const t of this.poissonTimes((h) => this.paxRate(cls, h))) {
        this.push(t, EV.PAX, cls, this.rng() < cfg.appShare ? 1 : 0, 0);
      }
      for (const t of this.poissonTimes((h) => this.taxiRate(cls, h))) {
        const flex = cls === "urban" && this.rng() < cfg.flexShare;
        this.push(t, EV.TAXI, cls, t, flex ? 1 : 0);
      }
    }

    if (cfg.dispatchIntervalMin > 0) {
      for (let t = cfg.dispatchDelayMin; t < this.end; t += cfg.dispatchIntervalMin) {
        this.push(t, EV.RELEASE, 0, 0, 0);
      }
    }

    for (let t = 0; t <= this.end; t += cfg.sampleIntervalMin) {
      this.push(t, EV.SAMPLE, 0, 0, 0);
    }

    if (cfg.anim) {
      const from = cfg.anim.from;
      const to = Math.min(cfg.anim.to, this.end);
      const step = cfg.anim.step;
      for (let t = from; t <= to; t += step) this.push(t, EV.FRAME, 0, 0, 0);
    }
  }

  /* ---------------- helpers ---------------- */
  bufferLen(cls) {
    return this.buf[cls].length;
  }

  bufferFull(cls, flex) {
    if (flex) return this.flexBuf.length >= this.cfg.flexBufferCapacity;
    return this.buf[cls].length >= this.cfg.bufferCapacity;
  }

  hasCapacity(cls) {
    if (this.cfg.pooledStands && POOL_CLASSES.includes(cls)) {
      return this.busy.urban + this.busy.nt < this.cfg.stands.urban + this.cfg.stands.nt;
    }
    return this.busy[cls] < this.cfg.stands[cls];
  }

  /** Oldest taxi able to serve `cls` (FIFO; flex taxis join at their own time). */
  popTaxiFor(cls) {
    const lane = this.buf[cls];
    if (!POOL_CLASSES.includes(cls)) return lane.length ? lane.shift() : null;
    if (!this.flexBuf.length) return lane.length ? lane.shift() : null;
    if (!lane.length) {
      const tx = this.flexBuf.shift();
      tx.cls = cls;
      return tx;
    }
    if (lane[0].tEnter <= this.flexBuf[0].tEnter) return lane.shift();
    const tx = this.flexBuf.shift();
    tx.cls = cls;
    return tx;
  }

  pickClass(cands) {
    if (cands.length === 1) return cands[0];
    let best = cands[0];
    let bestWait = -1;
    for (const c of cands) {
      const w = this.t - this.pq[c][0].tArr;
      if (w > bestWait) {
        best = c;
        bestWait = w;
      }
    }
    return best;
  }

  /* ---------------- transitions ---------------- */
  release(cls, budget) {
    const sq = this.stand[cls];
    let room = this.cfg.standQueueCapacity - sq.length;
    let n = 0;
    while (n < budget && room > 0) {
      const tx = this.popTaxiFor(cls);
      if (!tx) break;
      tx.state = 1;
      tx.tStand = this.t;
      sq.push(tx);
      room--;
      n++;
    }
  }

  releaseContinuous() {
    for (const cls of CLASSES) this.release(cls, 1e9);
  }

  serve() {
    for (;;) {
      const cands = [];
      for (const c of CLASSES) {
        if (this.pq[c].length && this.stand[c].length && this.hasCapacity(c)) cands.push(c);
      }
      if (!cands.length) return;
      this.startBoarding(this.pickClass(cands));
    }
  }

  startBoarding(cls) {
    const tx = this.stand[cls].shift();
    const pax = this.pq[cls].shift();
    pax.state = 2;
    pax.tServe = this.t;
    tx.state = 2;
    tx.tServe = this.t;
    this.busy[cls]++;

    const g = this.bayGroup(cls);
    const bays = this.bayOwner[g];
    const idx = bays.indexOf(null);
    tx.bayGroup = g;
    tx.bay = idx >= 0 ? idx : 0;
    bays[tx.bay] = tx;

    if (pax.tArr >= this.warm) {
      const w = this.t - pax.tArr;
      this.waits.push(w);
      this.waitsByClass[cls].push(w);
      this.paxServed++;
    }
    if (tx.tFirst >= this.warm) this.taxiBufferWaits.push(this.t - tx.tEnter);

    const dur = this.serviceTime(cls, pax);
    this.push(this.t + dur, EV.SERVICE, tx, cls, 0);
  }

  serviceTime(cls, pax) {
    let m = this.cfg.serviceMeanMin[cls];
    if (pax.app && this.cfg.fastCheckinFactor !== 1) m *= this.cfg.fastCheckinFactor;
    if (this.cfg.serviceDist === "exp") return expo(this.rng, 1 / m);
    return Math.min(lognormal(this.rng, m, this.cfg.serviceCv), 8 * m);
  }

  enterBuffer(cls, tFirst, flex) {
    const cfg = this.cfg;
    // only the walk-up lanes have a physical buffer limit; the pre-booked
    // area is a separate yard, exactly as in the Python model
    if ((POOL_CLASSES.includes(cls) || flex) && this.bufferFull(cls, flex)) {
      if (cls === "urban" && !flex) this.overflowUrban++;
      if (cls === "nt" && !flex) this.overflowNt++;
      this.recirc++;
      this.scheduleRecirc(cls, tFirst, flex);
      return;
    }
    const tx = {
      id: ++this.taxiSeq,
      tFirst,
      tEnter: this.t,
      tStand: 0,
      tServe: -1,
      cls: flex ? "flex" : cls,
      flex,
      state: 0,
      bay: -1,
      bayGroup: null,
    };
    if (flex) this.flexBuf.push(tx);
    else this.buf[cls].push(tx);
    if (tFirst >= this.warm) this.taxiArrived++;

    if (cfg.taxiPatienceMeanMin < Infinity) {
      const pat = lognormal(this.rng, cfg.taxiPatienceMeanMin, cfg.taxiPatienceCv);
      this.push(this.t + pat, EV.GIVEUP, tx, 0, 0);
    }
  }

  scheduleRecirc(cls, tFirst, flex) {
    const d = uniform(this.rng, this.cfg.recircMin, this.cfg.recircMax);
    this.push(this.t + d, EV.RECIRC, cls, tFirst, flex ? 1 : 0);
  }

  /* ---------------- main loop ---------------- */
  run() {
    const cfg = this.cfg;

    while (this.queue.size) {
      const [t, , kind, a, b, c] = this.queue.pop();
      if (t > this.end) break;
      this.t = t;

      switch (kind) {
        case EV.PAX: {
          const cls = a;
          const pax = { id: ++this.paxSeq, tArr: t, cls, app: b === 1, state: 0, tServe: -1 };
          this.pq[cls].push(pax);
          if (t >= this.warm) this.paxArrived++;
          if (cfg.patienceMeanMin < Infinity) {
            const pat = lognormal(this.rng, cfg.patienceMeanMin, cfg.patienceCv);
            this.push(t + pat, EV.ABANDON, pax, 0, 0);
          }
          if (cfg.dispatchIntervalMin <= 0) this.releaseContinuous();
          this.serve();
          break;
        }
        case EV.TAXI: {
          const cls = a;
          const tFirst = b;
          const flex = c === 1;
          if (cfg.infoShare > 0 && this.pq[cls].length < 6 && this.rng() < cfg.infoShare) {
            this.diverted = (this.diverted || 0) + 1;
            break;
          }
          if (
            POOL_CLASSES.includes(cls) && !flex &&
            cfg.misrouteProb > 0 && this.rng() < cfg.misrouteProb
          ) {
            this.misroutes++;
            this.recirc++;
            this.scheduleRecirc(cls, tFirst, false);
            break;
          }
          this.enterBuffer(cls, tFirst, flex);
          if (cfg.dispatchIntervalMin <= 0) this.releaseContinuous();
          this.serve();
          break;
        }
        case EV.RECIRC: {
          this.enterBuffer(a, b, c === 1);
          if (cfg.dispatchIntervalMin <= 0) this.releaseContinuous();
          this.serve();
          break;
        }
        case EV.RELEASE: {
          for (const cls of CLASSES) this.release(cls, cfg.dispatchBatch);
          this.serve();
          break;
        }
        case EV.SERVICE: {
          const tx = a;
          const cls = b;
          this.busy[cls]--;
          if (tx.tFirst >= this.warm) {
            this.taxiServed++;
            this.taxiDwells.push(t - tx.tFirst);
          }
          if (tx.bay >= 0 && this.bayOwner[tx.bayGroup]) {
            this.bayOwner[tx.bayGroup][tx.bay] = null;
          }
          tx.state = 4;
          if (cfg.dispatchIntervalMin <= 0) this.releaseContinuous();
          this.serve();
          break;
        }
        case EV.ABANDON: {
          const pax = a;
          if (pax.state === 0) {
            pax.state = 3;
            const q = this.pq[pax.cls];
            const i = q.indexOf(pax);
            if (i >= 0) q.splice(i, 1);
            if (t >= this.warm) {
              this.paxAbandoned++;
              this.abandonWaits.push(t - pax.tArr);
            }
          }
          break;
        }
        case EV.GIVEUP: {
          const tx = a;
          if (tx.state === 0 || tx.state === 1) {
            tx.state = 5;
            const lane = tx.flex ? this.flexBuf : this.buf[tx.cls];
            let i = lane.indexOf(tx);
            if (i >= 0) lane.splice(i, 1);
            const sq = this.stand[tx.cls];
            i = sq.indexOf(tx);
            if (i >= 0) sq.splice(i, 1);
            if (tx.tFirst >= this.warm) this.taxiLeftEmpty++;
          }
          break;
        }
        case EV.SAMPLE: {
          if (t >= this.warm) {
            const q = this.pq.urban.length + this.pq.nt.length + this.pq.prebook.length;
            this.qSum += q;
            if (q > this.qMax) this.qMax = q;
            const busy = this.busy.urban + this.busy.nt + this.busy.prebook;
            this.busySum += busy;
            const bl = this.bufferVisualLen();
            this.bufSum += bl;
            this.waitSum += bl + this.buf.prebook.length + this.stand.urban.length +
              this.stand.nt.length + this.stand.prebook.length;
            this.bufSumUrban += this.buf.urban.length;
            if (this.buf.urban.length >= this.cfg.bufferCapacity) this.urbanFullSamples++;
            this.bufSumNt += this.buf.nt.length;
            if (bl > this.bufMax) this.bufMax = bl;
            this.nSamples++;
          }
          break;
        }
        case EV.FRAME: {
          this.captureFrame();
          break;
        }
      }
    }

    return this.result();
  }

  /** Empty taxis waiting in the walk-up buffer zone (pre-booked yard excluded,
   *  matching the Python model's buffer_avg metric). */
  bufferVisualLen() {
    return this.buf.urban.length + this.buf.nt.length + this.flexBuf.length;
  }

  /* ---------------- animation frames ---------------- */
  captureFrame() {
    const taxis = [];
    for (const cls of CLASSES) {
      const lane = this.buf[cls];
      for (let i = 0; i < lane.length; i++) {
        taxis.push([lane[i].id, CLS[cls], 0, i, -1, -1]);
      }
      const st = this.stand[cls];
      for (let i = 0; i < st.length; i++) {
        taxis.push([st[i].id, CLS[cls], 1, i, -1, -1]);
      }
      const g = this.bayGroup(cls);
      const bays = this.bayOwner[g];
      for (let i = 0; i < bays.length; i++) {
        if (bays[i]) taxis.push([bays[i].id, CLS[bays[i].cls], 2, i, CLS[g] ?? 3, i]);
      }
    }
    for (let i = 0; i < this.flexBuf.length; i++) {
      taxis.push([this.flexBuf[i].id, CLS.flex, 0, i, -1, -1]);
    }

    const px = [];
    for (let c = 0; c < 3; c++) {
      const q = this.pq[CLASSES[c]];
      for (let i = 0; i < q.length; i++) px.push([q[i].id, c, i]);
    }

    this.frames.push({
      t: this.t,
      q: [this.pq.urban.length, this.pq.nt.length, this.pq.prebook.length],
      px,
      busy: this.busy.urban + this.busy.nt + this.busy.prebook,
      buf: this.bufferVisualLen(),
      tx: taxis,
    });
  }

  /* ---------------- results ---------------- */
  result() {
    const windowH = Math.max((this.end - this.warm) / 60, 1e-9);
    const sum = (a) => (a.length ? a.reduce((x, y) => x + y, 0) : 0);
    const mean = (a) => (a.length ? sum(a) / a.length : NaN);
    const qAvg = this.nSamples ? this.qSum / this.nSamples : NaN;
    const servedH = this.paxServed / windowH;
    const measured = this.paxServed + this.paxAbandoned;

    const sorted = [...this.waits].sort((x, y) => x - y);
    const pct = (p) => {
      if (!sorted.length) return NaN;
      const k = (sorted.length - 1) * p;
      const f = Math.floor(k);
      const c = Math.ceil(k);
      return f === c ? sorted[f] : sorted[f] * (c - k) + sorted[c] * (k - f);
    };

    const lLaw =
      (this.paxServed * mean(this.waits) +
        this.paxAbandoned * mean(this.abandonWaits)) /
      (60 * windowH);

    const metrics = {
      partyArrived: this.paxArrived,
      partyServed: this.paxServed,
      partyAbandoned: this.paxAbandoned,
      abandonRatePct: (100 * this.paxAbandoned) / Math.max(this.paxArrived, 1),
      waitMean: mean(this.waits),
      // Mean wait over *everyone* who arrived, including those who gave up.
      // waitMean only covers passengers who were served, so a policy that
      // serves more people can look better simply because the longest waiters
      // are now counted as abandonments. Use this one to rank policies.
      waitMeanInclAbandon:
        (safeMean(this.waits) * this.paxServed +
          safeMean(this.abandonWaits) * this.paxAbandoned) /
        Math.max(1, this.paxServed + this.paxAbandoned),
      waitMedian: pct(0.5),
      waitP90: pct(0.9),
      waitP95: pct(0.95),
      waitMax: sorted.length ? sorted[sorted.length - 1] : NaN,
      waitMeanUrban: mean(this.waitsByClass.urban),
      waitMeanNt: mean(this.waitsByClass.nt),
      waitMeanPrebook: mean(this.waitsByClass.prebook),
      queueAvg: qAvg,
      queueMax: this.qMax,
      littleGapPct: (100 * (qAvg - lLaw)) / Math.max(lLaw, 1e-9),
      taxiArrived: this.taxiArrived,
      taxiServed: this.taxiServed,
      taxiLeftEmpty: this.taxiLeftEmpty,
      taxiWastePct: (100 * this.taxiLeftEmpty) / Math.max(this.taxiArrived, 1),
      bufferAvg: this.nSamples ? this.bufSum / this.nSamples : NaN,
      taxiWaitingAvg: this.nSamples ? this.waitSum / this.nSamples : NaN,
      bufferAvgUrban: this.nSamples ? this.bufSumUrban / this.nSamples : NaN,
      bufferAvgNt: this.nSamples ? this.bufSumNt / this.nSamples : NaN,
      overflowUrban: this.overflowUrban,
      urbanFullPct: this.nSamples ? (100 * this.urbanFullSamples) / this.nSamples : NaN,
      overflowNt: this.overflowNt,
      bufferMax: this.bufMax,
      taxiDwellMean: mean(this.taxiDwells),
      misroutes: this.misroutes,
      recirculations: this.recirc,
      standUtilPct: (100 * (this.busySum / Math.max(this.nSamples, 1))) / this.standsTotal,
      throughputPaxH: servedH * this.cfg.partySize,
      windowH,
    };

    return {
      metrics,
      frames: this.frames,
      meta: {
        seed: this.seed,
        stands: this.cfg.stands,
        pooled: this.cfg.pooledStands,
        flex: this.cfg.flexShare > 0,
        groups: Object.keys(this.bayOwner),
        startHour: this.cfg.startHour,
        durationHours: this.cfg.durationHours,
      },
    };
  }
}

export function runSimulation(config, seed = 1) {
  return new Simulation(config, seed).run();
}

/* Convenience presets used by the website ---------------------------- */
export const SMART = {
  dispatchIntervalMin: 0,
  pooledStands: true,
  appShare: 0.85,
  fastCheckinFactor: 0.75,
  flexShare: 0.35,
  misrouteProb: 0.01,
};
