/**
 * UI shell: controls -> simulation -> 3D playback.
 *
 * Everything runs in the browser, so the site is a static bundle: no API, no
 * server, no cold start.  A 12-hour day simulates in ~50 ms.
 */

import { runSimulation, DEFAULTS, SMART } from "./sim.js";
import { Scene3D } from "./scene.js";
import { prepare } from "./assets.js";
import { CSS_COLOR, CLS_LABEL, CLS_SHORT } from "./layout.js";

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * Control definitions
 * ------------------------------------------------------------------ */
const GROUPS = [
  {
    name: "The essentials",
    items: [
      { key: "paxPerHour", label: "Passengers arriving", min: 300, max: 850, step: 10, unit: "pax/h",
        hint: "Walk-up passengers per hour, averaged over the shift. Count arrivals at the taxi hall for 2-3 days." },
      { key: "taxiSupplyRatioUrban", label: "Urban (red) taxis arriving", min: 0.7, max: 1.4, step: 0.05, unit: "× demand",
        hint: "Empty urban taxis entering the buffer, relative to passenger demand. 1.0 means supply matches demand on average." },
      { key: "taxiSupplyRatioNt", label: "NT (green) taxis arriving", min: 0.7, max: 1.4, step: 0.05, unit: "× demand",
        hint: "Same for New Territories taxis. Below 1.0 the NT lane is structurally short of taxis." },
      { key: "stands.urban", label: "Urban pickup bays", min: 3, max: 14, step: 1, int: true,
        hint: "Physical bays serving the urban queue. Each bay boards roughly one taxi every 1.5 minutes." },
    ],
  },
  {
    name: "Demand mix",
    items: [
      { key: "urbanShare", label: "Urban vs New Territories", min: 0.5, max: 0.95, step: 0.05, pct: true,
        hint: "Share of walk-up passengers heading to urban destinations. The rest join the NT queue." },
      { key: "prebookShare", label: "Booked in advance", min: 0, max: 0.35, step: 0.05, pct: true,
        hint: "Share using fleet / pre-booked taxis instead of the walk-up hall." },
    ],
  },
  {
    name: "Taxi mix",
    items: [
      { key: "flexShare", label: "Taxis taking either queue", min: 0, max: 0.6, step: 0.05, pct: true,
        hint: "Share of taxis allowed to serve either destination. A regulation question, not a software one." },
    ],
  },
  {
    name: "Pickup hall",
    items: [
      { key: "stands.nt", label: "New Territories bays", min: 1, max: 8, step: 1, int: true,
        hint: "Bays serving the New Territories queue." },
      { key: "service", label: "Boarding time per taxi", min: 0.8, max: 3.5, step: 0.1, unit: "min",
        hint: "Registration, luggage and payment. Stopwatch ~50 boardings; app pre-registration shortens it by 25%." },
      { key: "bufferCapacity", label: "Waiting spaces per lane", min: 10, max: 60, step: 5, int: true,
        hint: "How many empty taxis each lane can hold. When full, taxis circle and come back later." },
      { key: "dispatchBatch", label: "Taxis per release", min: 2, max: 14, step: 1, int: true,
        hint: "Taxis waved forward each time staff release a platoon." },
    ],
  },
  {
    name: "Staffing and behaviour",
    items: [
      { key: "dispatchIntervalMin", label: "How often staff release taxis", min: 0, max: 5, step: 0.25, unit: "min",
        zeroLabel: "continuous", hint: "The manual dispatch cycle. Zero means taxis are released the moment they arrive." },
      { key: "misrouteProb", label: "Taxis sent to the wrong queue", min: 0, max: 0.2, step: 0.01, pct: true,
        hint: "Share of taxis that take the wrong lane and must circle back." },
      { key: "appShare", label: "Passengers pre-registered", min: 0, max: 1, step: 0.05, pct: true,
        hint: "Share whose details are already in the system, which shortens boarding." },
      { key: "patienceMeanMin", label: "How long people wait before leaving", min: 10, max: 80, step: 5, unit: "min",
        hint: "Average tolerance before a passenger gives up and leaves the queue." },
    ],
  },
  {
    name: "Display",
    items: [{ key: "highQuality", label: "High-quality graphics", type: "toggle",
        hint: "Turn off on older laptops or to save battery." }],
  },
];

/* Settings that describe the *process* rather than demand: the reference run
   resets these so the KPI deltas answer "what did the policies change?". */
const POLICY_KEYS = [
  "dispatchIntervalMin", "dispatchBatch", "pooledStands", "appShare",
  "flexShare", "misrouteProb", "stands.urban", "stands.nt", "taxiSupplyRatioNt",
];

const IS_PHONE =
  window.matchMedia("(max-width: 820px)").matches ||
  (navigator.maxTouchPoints > 1 && window.innerWidth < 1100);

const WINDOWS = [
  { label: "Peak 08:30–09:15", from: 30, to: 75 },   // default: a watchable slice
  { label: "Morning 08–11", from: 0, to: 180 },
  { label: "Midday 11–14", from: 180, to: 360 },
  { label: "Evening 16–19", from: 480, to: 660 },
  { label: "Whole shift 08–20", from: 0, to: 720 },
];

const PRESETS = {
  baseline: {
    paxPerHour: 550, urbanShare: 0.75, prebookShare: 0.1,
    taxiSupplyRatioUrban: 1.05, taxiSupplyRatioNt: 0.95, flexShare: 0,
    "stands.urban": 8, "stands.nt": 3, service: 1.5, bufferCapacity: 40,
    dispatchIntervalMin: 1, dispatchBatch: 8, misrouteProb: 0.06,
    appShare: 0, pooledStands: false, patienceMeanMin: 35,
  },
  smart: {
    paxPerHour: 550, urbanShare: 0.75, prebookShare: 0.1,
    taxiSupplyRatioUrban: 1.05, taxiSupplyRatioNt: 1.05, flexShare: 0.35,
    "stands.urban": 10, "stands.nt": 4, service: 1.5, bufferCapacity: 40,
    dispatchIntervalMin: 0, dispatchBatch: 8, misrouteProb: 0.01,
    appShare: 0.85, pooledStands: true, patienceMeanMin: 35,
  },
};

/* ------------------------------------------------------------------ *
 * State
 * ------------------------------------------------------------------ */
const state = {
  values: { ...PRESETS.baseline, highQuality: !IS_PHONE },
  window: 0,
  speed: 3,          // simulated minutes per real second
  seed: 1,
  frames: [],
  from: 0,
  step: 0.25,
  playT: 0,
  playing: true,
  baseline: null,
  meta: null,
};

const scene = new Scene3D($("#scene"));

/* Auto-apply: a run costs 25-50 ms, so waiting for a button is friction.
   Debounced so dragging a slider does not queue dozens of runs. */
let runTimer = null;
function scheduleRun(delay = 220) {
  clearTimeout(runTimer);
  runTimer = setTimeout(run, delay);
}

/** Current values with every *policy* reset to the current process, so the
 *  KPI deltas answer "what did the policies change?" at the same demand. */
function referenceValues() {
  const v = { ...state.values };
  for (const k of POLICY_KEYS) {
    if (PRESETS.baseline[k] !== undefined) v[k] = PRESETS.baseline[k];
  }
  return v;
}

/* ------------------------------------------------------------------ *
 * Controls
 * ------------------------------------------------------------------ */
function valueOf(key) {
  return state.values[key] ?? DEFAULTS[key] ?? 0;
}

function fmt(item, v) {
  if (item.pct) return `${Math.round(v * 100)}%`;
  if (item.int) return `${Math.round(v)}`;
  if (item.zeroLabel && v === 0) return item.zeroLabel;
  return `${v.toFixed(item.step < 1 ? 2 : 0)}${item.unit ? " " + item.unit : ""}`;
}

function buildControls() {
  const host = $("#controls");
  host.innerHTML = "";
  let advanced = null;
  let index = 0;
  for (const group of GROUPS) {
    const section = document.createElement("section");
    section.className = "group";
    // everything after the first group is folded away by default
    if (index === 1 && !advanced) {
      const toggle = document.createElement("button");
      toggle.type = "button";
      toggle.id = "advancedToggle";
      const paint = (open) => {
        toggle.classList.toggle("open", open);
        toggle.innerHTML = `<span class="chev">›</span> ${open ? "Fewer settings" : "More settings"}`;
      };
      paint(false);
      advanced = document.createElement("div");
      advanced.id = "advanced";
      advanced.hidden = true;
      toggle.addEventListener("click", () => {
        paint(advanced.hidden);
        advanced.hidden = !advanced.hidden;
      });
      host.appendChild(toggle);
      host.appendChild(advanced);
    }
    index++;

    section.innerHTML = `<h2>${group.name}</h2>`;
    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "row";
      if (item.hint) row.title = item.hint;
      if (item.type === "toggle") {
        row.innerHTML = `
          <label for="c-${item.key}">${item.label}</label>
          <button id="c-${item.key}" class="toggle" role="switch" aria-checked="false">
            <span></span>
          </button>`;
        const btn = row.querySelector("button");
        const paint = () => {
          const on = !!valueOf(item.key);
          btn.setAttribute("aria-checked", String(on));
          btn.classList.toggle("on", on);
        };
        btn.addEventListener("click", () => {
          state.values[item.key] = !valueOf(item.key);
          paint();
          setPreset(null);
          if (item.key === "highQuality") {
            scene.setQuality(state.values.highQuality ? "high" : "low");
          }
        });
        paint();
        section.appendChild(row);
        continue;
      }
      row.innerHTML = `
        <div class="lab"><label for="c-${item.key}">${item.label}</label>
          <output id="o-${item.key}">${fmt(item, valueOf(item.key))}</output></div>
        <input id="c-${item.key}" type="range" min="${item.min}" max="${item.max}"
               step="${item.step}" value="${valueOf(item.key)}" />`;
      const input = row.querySelector("input");
      const out = row.querySelector("output");
      input.addEventListener("input", () => {
        state.values[item.key] = Number(input.value);
        out.textContent = fmt(item, Number(input.value));
        setPreset(null);
        scheduleRun();
      });
      section.appendChild(row);
    }
    (advanced || host).appendChild(section);
  }
}

function syncControls() {
  for (const group of GROUPS) {
    for (const item of group.items) {
      const el = $(`#c-${item.key}`);
      if (!el) continue;
      if (item.type === "toggle") {
        el.setAttribute("aria-checked", String(!!valueOf(item.key)));
        el.classList.toggle("on", !!valueOf(item.key));
      } else {
        el.value = valueOf(item.key);
        const out = $(`#o-${item.key}`);
        if (out) out.textContent = fmt(item, Number(valueOf(item.key)));
      }
    }
  }
}

function setPreset(name) {
  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.classList.toggle("active", b.dataset.preset === name);
  });
}

/* ------------------------------------------------------------------ *
 * Config + run
 * ------------------------------------------------------------------ */
function buildConfig(vals = state.values) {
  const valueOf = (k) => (vals[k] !== undefined ? vals[k] : DEFAULTS[k] !== undefined ? DEFAULTS[k] : 0);
  const w = WINDOWS[state.window];
  const from = w.from;
  const to = w.to;
  const step = Math.max(0.25, (to - from) / 900);
  return {
    ...DEFAULTS,
    paxPerHour: valueOf("paxPerHour"),
    urbanShare: valueOf("urbanShare"),
    prebookShare: valueOf("prebookShare"),
    taxiSupplyRatioUrban: valueOf("taxiSupplyRatioUrban"),
    taxiSupplyRatioNt: valueOf("taxiSupplyRatioNt"),
    flexShare: valueOf("flexShare"),
    stands: {
      urban: Math.round(valueOf("stands.urban")),
      nt: Math.round(valueOf("stands.nt")),
      prebook: 2,
    },
    serviceMeanMin: {
      urban: valueOf("service"),
      nt: valueOf("service"),
      prebook: valueOf("service"),
    },
    bufferCapacity: Math.round(valueOf("bufferCapacity")),
    dispatchIntervalMin: valueOf("dispatchIntervalMin"),
    dispatchBatch: Math.round(valueOf("dispatchBatch")),
    misrouteProb: valueOf("misrouteProb"),
    appShare: valueOf("appShare"),
    fastCheckinFactor: valueOf("appShare") > 0 ? 0.75 : 1,
    pooledStands: !!valueOf("pooledStands"),
    patienceMeanMin: valueOf("patienceMeanMin"),
    anim: { from, to, step },
  };
}

function syncWindowSelect() {
  const sel = $("#windowSel");
  if (sel) sel.value = String(state.window);
}

function run() {
  const cfg = buildConfig();
  syncWindowSelect();
  state.from = cfg.anim.from;
  state.step = cfg.anim.step;

  const t0 = performance.now();
  const res = runSimulation(cfg, state.seed);
  const ms = performance.now() - t0;
  state.baseline = runSimulation(buildConfig(referenceValues()), state.seed).metrics;

  state.frames = res.frames;
  state.meta = res.meta;
  scene.setScene(res.meta);
  scene.attachLabels($("#zoneLabels"));
  if (!state.started) {
    state.playT = state.from + 20;   // skip the empty first minutes
    state.started = true;
  } else {
    state.playT = state.from;
  }
  state.playing = true;

  renderKpis(res.metrics, ms);
  drawChart();

  // paint the first frame immediately so the canvas is never blank
  scene.sync(state.frames[0]);
  scene.tick(0.016);
  scene.render(0.016);
  updateHud(state.frames[0]);
  $("#hint").textContent =
    `${res.frames.length} frames · ${Math.round(ms)} ms to simulate ${cfg.durationHours} h`;
  renderCards();
  if (state.compare) updateVerdict();
  $("#playBtn").textContent = "Pause";
}

/* The reference is re-run with every change, so the deltas always compare
   like with like (same demand, same infrastructure, policy reset). */
function computeBaseline() {
  state.baseline = runSimulation(buildConfig(referenceValues()), state.seed).metrics;
}

/* ------------------------------------------------------------------ *
 * KPI cards
 * ------------------------------------------------------------------ */
const KPI = [
  { key: "waitMean", label: "Mean wait", unit: "min", digits: 1, lowerBetter: true },
  { key: "waitP90", label: "90th percentile", unit: "min", digits: 1, lowerBetter: true },
  { key: "abandonRatePct", label: "Gave up", unit: "%", digits: 1, lowerBetter: true },
  { key: "queueAvg", label: "Avg waiting", unit: "parties", digits: 0, lowerBetter: true },
  { key: "standUtilPct", label: "Avg bays busy", unit: "%", digits: 0, lowerBetter: false },
  { key: "bufferAvg", label: "Avg taxis waiting", unit: "", digits: 0, lowerBetter: false },
];

function renderKpis(m, ms) {
  const host = $("#kpis");
  host.innerHTML = "";
  for (const k of KPI) {
    const v = m[k.key];
    const base = state.baseline ? state.baseline[k.key] : null;
    let delta = "";
    if (base && Math.abs(base) > 1e-6 && k.key in state.baseline) {
      const d = ((v - base) / base) * 100;
      if (Math.abs(d) >= 1.5) {
        const good = k.lowerBetter ? d < 0 : d > 0;
        delta = `<span class="delta ${good ? "good" : "bad"}">${d > 0 ? "+" : ""}${d.toFixed(0)}%</span>`;
      }
    }
    host.insertAdjacentHTML(
      "beforeend",
      `<div class="kpi">
         <div class="kpi-top">${k.label}${delta}</div>
         <div class="kpi-val">${v.toFixed(k.digits)}<span>${k.unit}</span></div>
       </div>`
    );
  }
}

/* ------------------------------------------------------------------ *
 * Queue chart + playhead
 * ------------------------------------------------------------------ */
const chart = $("#chart");
const cctx = chart.getContext("2d");
let chartCache = null;

function drawChart() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = chart.clientWidth;
  const h = chart.clientHeight;
  chart.width = w * dpr;
  chart.height = h * dpr;
  cctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  cctx.clearRect(0, 0, w, h);

  const frames = state.frames;
  if (!frames.length) return;

  const pad = { l: 34, r: 8, t: 12, b: 18 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  let maxQ = 1;
  for (const f of frames) maxQ = Math.max(maxQ, f.q[0] + f.q[1] + f.q[2]);

  const X = (i) => pad.l + (i / (frames.length - 1)) * iw;
  const Y = (v) => pad.t + ih - (v / maxQ) * ih;

  // gridlines
  cctx.strokeStyle = "rgba(70,80,95,0.13)";
  cctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (ih * g) / 4;
    cctx.beginPath();
    cctx.moveTo(pad.l, y);
    cctx.lineTo(w - pad.r, y);
    cctx.stroke();
  }
  cctx.fillStyle = "rgba(70,80,95,0.68)";
  cctx.font = "10px ui-monospace, SFMono-Regular, Menlo, monospace";
  cctx.fillText(String(Math.round(maxQ)), 4, pad.t + 8);
  cctx.fillText("0", 4, pad.t + ih);

  // stacked queue by class
  const cols = CSS_COLOR;
  for (let c = 0; c < 3; c++) {
    cctx.beginPath();
    cctx.moveTo(X(0), Y(0));
    for (let i = 0; i < frames.length; i++) {
      let base = 0;
      for (let k = 0; k < c; k++) base += frames[i].q[k];
      cctx.lineTo(X(i), Y(base + frames[i].q[c]));
    }
    for (let i = frames.length - 1; i >= 0; i--) {
      let base = 0;
      for (let k = 0; k < c; k++) base += frames[i].q[k];
      cctx.lineTo(X(i), Y(base));
    }
    cctx.closePath();
    cctx.fillStyle = cols[c] + "55";
    cctx.fill();
  }

  // total queue line
  cctx.beginPath();
  for (let i = 0; i < frames.length; i++) {
    const q = frames[i].q[0] + frames[i].q[1] + frames[i].q[2];
    if (i === 0) cctx.moveTo(X(i), Y(q));
    else cctx.lineTo(X(i), Y(q));
  }
  cctx.strokeStyle = "#46505c";
  cctx.lineWidth = 1.4;
  cctx.stroke();

  // hour ticks
  cctx.fillStyle = "rgba(70,80,95,0.55)";
  const startHour = state.meta ? state.meta.startHour : 8;
  const h0 = startHour + state.from / 60;
  for (let hh = 0; hh <= 6; hh += 2) {
    const idx = Math.round(((hh * 60) / (state.step * frames.length)) * (frames.length - 1));
    if (idx < 0 || idx >= frames.length) continue;
    cctx.fillText(`${Math.floor(h0 + hh)}:00`, X(idx) - 12, h - 4);
  }

  chartCache = { pad, iw, ih, maxQ };
}

function drawPlayhead() {
  if (!chartCache || !state.frames.length) return;
  const { pad, ih } = chartCache;
  const i = Math.min(
    state.frames.length - 1,
    Math.max(0, Math.round((state.playT - state.from) / state.step))
  );
  const x = pad.l + (i / (state.frames.length - 1)) * chartCache.iw;
  cctx.save();
  cctx.strokeStyle = "rgba(50,60,75,0.45)";
  cctx.lineWidth = 1;
  cctx.beginPath();
  cctx.moveTo(x, pad.t);
  cctx.lineTo(x, pad.t + ih);
  cctx.stroke();
  cctx.restore();
}

/* ------------------------------------------------------------------ *
 * Playback loop
 * ------------------------------------------------------------------ */
let last = performance.now();
let frameCount = 0;
let frameAcc = 0;
const FPS_METER = new URLSearchParams(location.search).get("fps") === "1";
const fpsEl = (() => {
  if (!FPS_METER) return { textContent: "" };
  const el = document.createElement("div");
  el.id = "fpsMeter";
  el.style.cssText =
    "position:fixed;right:10px;bottom:10px;z-index:99;background:#000;color:#7dffb0;" +
    "font:11px ui-monospace,monospace;padding:4px 8px;border-radius:6px;opacity:.85";
  document.body.appendChild(el);
  return el;
})();

/* Automated screenshots (and low-power devices) can ask the page to render a
   fixed number of frames and then stop: ?still=90 */
const STILL = Number(new URLSearchParams(location.search).get("still") || 0);
let stillLeft = STILL;
const DIAG = new URLSearchParams(location.search).get("diag") === "1";

function dumpDiag() {
  let pre = document.getElementById("diag");
  if (!pre) {
    pre = document.createElement("pre");
    pre.id = "diag";
    document.body.appendChild(pre);
  }
  const c = $("#scene");
  const r = scene.renderer;
  pre.textContent = JSON.stringify({
    canvas: [c.width, c.height, c.clientWidth, c.clientHeight],
    dpr: window.devicePixelRatio,
    camera: scene.camera.position.toArray().map((v) => +v.toFixed(1)),
    target: scene.target.toArray(),
    children: scene.root.children.length,
    taxis: scene.taxis.size,
    calls: r.info.render.calls,
    tris: r.info.render.triangles,
    frames: state.frames.length,
  });
}

function loop(now) {
  // clamp: a negative or huge delta (first frame, tab wake-up) must never be
  // fed into the animation maths — it used to mirror and explode the meshes
  const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
  last = now;

  if (state.frames.length) {
    if (state.playing) {
      state.playT += dt * state.speed;
      const endT = state.from + state.step * (state.frames.length - 1);
      if (state.playT > endT) state.playT = state.from;
    }
    const i = Math.min(
      state.frames.length - 1,
      Math.max(0, Math.round((state.playT - state.from) / state.step))
    );
    scene.sync(state.frames[i]);
    updateHud(state.frames[i]);

    // redraw chart + playhead (cheap: a few hundred points)
    drawChart();
    drawPlayhead();
  }

  const hour = (state.meta ? state.meta.startHour : 8) + state.playT / 60;
  scene.tick(dt, hour);
  scene.render(dt);

  // --- frame budget guard: keep it smooth rather than pretty -------------
  frameCount++;
  frameAcc += dt;
  if (frameAcc >= 1.0) {
    const fps = frameCount / frameAcc;
    if (FPS_METER) {
      const info = scene.renderer.info.render;
      fpsEl.textContent =
        `${fps.toFixed(0)} fps · ${info.calls} calls · ${(info.triangles / 1000).toFixed(0)}k tris`;
    }
    if (fps < 50 && scene.dprScale > 0.62) scene.setDprScale(scene.dprScale * 0.85);
    else if (fps > 58 && scene.dprScale < 1) scene.setDprScale(scene.dprScale * 1.05);
    frameCount = 0;
    frameAcc = 0;
  }

  if (state.compare && state.runA) {
    const sb = ensureSceneB();
    const key = `${state.window}-${state.runA.frames.length}`;
    if (bKey !== key) {
      sb.setScene(state.runA.meta);
      sb.attachLabels(null);
      sb.setQuality(valueOf("highQuality") ? "high" : "low");
      bKey = key;
    }
    const j = Math.min(state.runA.frames.length - 1,
      Math.max(0, Math.round((state.playT - state.from) / state.step)));
    sb.sync(state.runA.frames[j]);
    sb.orbit = { ...scene.orbit };
    sb.portrait = scene.portrait;
    sb.tick(dt, hour);
    sb.render(dt);
  }
  if (DIAG) dumpDiag();
  if (STILL && --stillLeft <= 0) return;   // freeze for screenshot / tests
  requestAnimationFrame(loop);
}

function updateHud(frame) {
  const startHour = state.meta ? state.meta.startHour : 8;
  const minutes = startHour * 60 + state.from + (frame.t - state.from);
  const hh = Math.floor((minutes / 60) % 24);
  const mm = Math.floor(minutes % 60);
  $("#clock").textContent = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;

  const chips = [
    [0, frame.q[0]],
    [1, frame.q[1]],
    [2, frame.q[2]],
  ]
    .filter(([, n]) => n > 0)
    .map(([c, n]) => `<span class="chip"><i style="background:${CSS_COLOR[c]}"></i>${n} ${CLS_SHORT[c]}</span>`)
    .join("");
  const bufLabel = IS_PHONE ? `${frame.buf} taxis` : `${frame.buf} taxis in buffer`;
  $("#counts").innerHTML = chips + `<span class="chip"><i class="buf"></i>${bufLabel}</span>`;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */

/* ================================================================== *
 * Scenario cards + A/B comparison
 * ================================================================== */

const CARDS = [
  {
    label: "Continuous dispatch",
    on: { dispatchIntervalMin: 0 },
    off: { dispatchIntervalMin: 1 },
    isOn: (v) => Number(v.dispatchIntervalMin) === 0,
  },
  {
    label: "Pooled pickup bays",
    on: { pooledStands: true },
    off: { pooledStands: false },
    isOn: (v) => !!v.pooledStands,
  },
  {
    label: "App pre-registration",
    on: { appShare: 0.85 },
    off: { appShare: 0 },
    isOn: (v) => Number(v.appShare) > 0,
  },
  {
    label: "Flexible taxis",
    on: { flexShare: 0.35 },
    off: { flexShare: 0 },
    isOn: (v) => Number(v.flexShare) > 0,
  },
  {
    label: "Two extra bays",
    on: { "stands.urban": 10, "stands.nt": 4 },
    off: { "stands.urban": 8, "stands.nt": 3 },
    isOn: (v) => Number(v["stands.urban"]) > 8 || Number(v["stands.nt"]) > 3,
  },
  {
    label: "Balance NT supply",
    on: { taxiSupplyRatioNt: 1.05 },
    off: { taxiSupplyRatioNt: 0.95 },
    isOn: (v) => Number(v.taxiSupplyRatioNt) > 1,
  },
];

const DIFF_KEYS = [
  ["paxPerHour", "Demand", (v) => `${Math.round(v)}/h`],
  ["stands.urban", "Urban bays", (v) => Math.round(v)],
  ["stands.nt", "NT bays", (v) => Math.round(v)],
  ["service", "Boarding", (v) => `${Number(v).toFixed(1)} min`],
  ["dispatchIntervalMin", "Dispatch", (v) => (Number(v) === 0 ? "continuous" : `${v} min`)],
  ["appShare", "App check-in", (v) => `${Math.round(v * 100)}%`],
  ["flexShare", "Flexible taxis", (v) => `${Math.round(v * 100)}%`],
  ["pooledStands", "Pooled bays", (v) => (v ? "on" : "off")],
  ["misrouteProb", "Wrong lane", (v) => `${Math.round(Number(v) * 100)}%`],
  ["taxiSupplyRatioUrban", "Urban supply", (v) => `${Number(v).toFixed(2)}×`],
  ["taxiSupplyRatioNt", "NT supply", (v) => `${Number(v).toFixed(2)}×`],
  ["bufferCapacity", "Buffer", (v) => Math.round(v)],
  ["patienceMeanMin", "Patience", (v) => `${Math.round(v)} min`],
];

function baselineValues() {
  return { ...PRESETS.baseline };
}

function renderCards() {
  const host = $("#policyCards");
  if (!host) return;
  host.innerHTML = "";
  for (const card of CARDS) {
    const on = card.isOn(state.values);
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card" + (on ? " on" : "");
    btn.setAttribute("aria-pressed", String(on));
    const eff =
      card.effect == null
        ? "…"
        : `${card.effect >= 0 ? "+" : ""}${card.effect.toFixed(1)} min`;
    const zero = card.effect != null && Math.abs(card.effect) < 0.08;
    const bad = card.effect != null && card.effect >= 0.08;
    btn.innerHTML =
      `<span class="dot"></span><span class="t">${card.label}</span>` +
      `<span class="eff${zero ? " zero" : bad ? " bad" : ""}" title="effect on mean wait when applied alone (this window)">${eff}</span>`;
    btn.addEventListener("click", () => {
      Object.assign(state.values, on ? card.off : card.on);
      syncControls();
      renderCards();
      setPreset(null);
      run();
    });
    host.appendChild(btn);
  }
}

/** Mean wait with a card applied on its own, one card per tick so the main
 *  thread is never blocked for more than a single simulation. */
function computeEffects() {
  let base = null;
  let i = 0;
  const seeds = [11, 12];
  const avg = (cfg) =>
    seeds.reduce((a, s) => a + runSimulation(cfg, s).metrics.waitMean, 0) / seeds.length;

  const step = () => {
    try {
      if (base === null) {
        base = avg(buildConfig(referenceValues()));
      } else if (i < CARDS.length) {
        const card = CARDS[i++];
        card.effect = avg(buildConfig({ ...referenceValues(), ...card.on })) - base;
        renderCards();
      } else {
        return;
      }
    } catch {}
    setTimeout(step, 30);
  };
  setTimeout(step, 30);
}

/* ---------------- A/B state ---------------- */
let sceneB = null;
let bKey = null;

function ensureSceneB() {
  if (sceneB) return sceneB;
  sceneB = new Scene3D($("#sceneB"));
  sceneB.setQuality(valueOf("highQuality") ? "high" : "low");
  return sceneB;
}

function ensureRunA() {
  if (state.runA && state.runA.key === String(state.window)) return;
  const res = runSimulation(buildConfig(referenceValues()), state.seed);
  state.runA = { ...res, key: String(state.window) };
  bKey = null;
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function ci95(vals) {
  if (vals.length < 2) return 0;
  const m = mean(vals);
  const sd = Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / (vals.length - 1));
  return (1.96 * sd) / Math.sqrt(vals.length);
}

function updateVerdict() {
  const trials = Number($("#trialsSel").value) || 1;
  const aCfg = buildConfig(referenceValues());
  const bCfg = buildConfig();
  const A = [];
  const B = [];
  for (let i = 0; i < trials; i++) {
    const seed = 700 + i;
    A.push(runSimulation(aCfg, seed).metrics);
    B.push(runSimulation(bCfg, seed).metrics);
  }

  const aW = A.map((r) => r.waitMean);
  const bW = B.map((r) => r.waitMean);
  const aM = mean(aW);
  const bM = mean(bW);
  const aC = ci95(aW);
  const bC = ci95(bW);
  const rel = aM ? ((bM - aM) / aM) * 100 : 0;
  const overlap = trials > 1 ? !(aM + aC < bM - bC || bM + bC < aM - aC) : false;

  const aP = mean(A.map((r) => r.waitP90));
  const bP = mean(B.map((r) => r.waitP90));
  const aX = mean(A.map((r) => r.abandonRatePct));
  const bX = mean(B.map((r) => r.abandonRatePct));
  const aQ = mean(A.map((r) => r.queueAvg));
  const bQ = mean(B.map((r) => r.queueAvg));

  let verdict;
  if (trials === 1) {
    verdict = `<b>${rel >= 0 ? "+" : ""}${rel.toFixed(0)}%</b> mean wait · A ${aM.toFixed(1)} → B ${bM.toFixed(1)} min
      <span style="opacity:.6">· single trial, switch trials to 10 for a significance check</span>`;
  } else if (overlap) {
    verdict = `<span class="none">No measurable difference</span> — the 95% intervals overlap
      (A ${aM.toFixed(1)}±${aC.toFixed(1)}, B ${bM.toFixed(1)}±${bC.toFixed(1)} min)`;
  } else {
    verdict = `<b>${rel >= 0 ? "+" : ""}${rel.toFixed(0)}%</b> mean wait · A ${aM.toFixed(1)} → B ${bM.toFixed(1)} min
      <span style="opacity:.7">· 95% CI of B [${(bM - bC).toFixed(1)}, ${(bM + bC).toFixed(1)}] does not overlap A</span>`;
  }
  $("#cmpVerdict").innerHTML = verdict;

  const chip = (label, a, b, unit, digits = 1) =>
    `<span class="chipdiff">${label} <b>${a.toFixed(digits)}${unit}</b> → <b>${b.toFixed(digits)}${unit}</b></span>`;
  $("#cmpDiff").innerHTML = [
    chip("90th pct", aP, bP, " min"),
    chip("gave up", aX, bX, "%"),
    chip("queue", aQ, bQ, "", 0),
  ].join("");

  // what actually differs between A and B
  const base = referenceValues();
  const diffs = [];
  for (const [key, label, fmt] of DIFF_KEYS) {
    const av = base[key] !== undefined ? base[key] : DEFAULTS[key];
    const bv = state.values[key] !== undefined ? state.values[key] : DEFAULTS[key];
    if (av === undefined || bv === undefined) continue;
    if (String(av) === String(bv)) continue;
    diffs.push(`<span class="chipdiff">${label} <b>${fmt(av)}</b> → <b>${fmt(bv)}</b></span>`);
  }
  $("#cmpDiff").innerHTML += diffs.length
    ? diffs.join("")
    : `<span class="chipdiff">identical settings — change a policy or a slider</span>`;
}

function refreshStage() {
  const cmp = state.compare;
  const stage = $("#stage");
  stage.classList.toggle("split", cmp && !IS_PHONE);
  stage.classList.toggle("swap", cmp && IS_PHONE);
  document.body.classList.toggle("comparing", cmp);
  $("#compareBar").hidden = !cmp;
  $("#tagA").hidden = !cmp;
  $("#tagB").hidden = !cmp;

  const showA = cmp && IS_PHONE && state.showA;
  $("#scene").hidden = !!showA;
  $("#sceneB").hidden = !cmp || showA;
  $("#tagA").hidden = !cmp || (IS_PHONE && !showA);
  $("#tagB").hidden = !cmp || (IS_PHONE && showA);
  const swap = $("#swapBtn");
  if (swap) {
    swap.hidden = !(cmp && IS_PHONE);
    swap.textContent = state.showA ? "Show B" : "Show A";
  }

  requestAnimationFrame(() => {
    scene.resize();
    if (sceneB) sceneB.resize();
  });
}

function setCompare(on) {
  state.compare = on;
  state.showA = false;
  if (on) {
    ensureRunA();
    refreshStage();
    updateVerdict();
  } else {
    refreshStage();
  }
  $("#cmpBtn").classList.toggle("active", on);
  $("#cmpBtn").textContent = on ? "Comparing" : "Compare";
}


/* ================================================================== *
 * CC0 kit assets (Kenney city / car / nature)
 * ================================================================== */
async function loadKitAssets() {
  try {
    const base = "./models/";
    const [b1, b2, b3, tree, bush, taxi, pa, pb, pc] = await Promise.all([
      prepare(base + "city/building-l.glb", { targetHeight: 5.2 }),
      prepare(base + "city/building-e.glb", { targetHeight: 3.4 }),
      prepare(base + "city/building-a.glb", { targetHeight: 4.4 }),
      prepare(base + "nature/tree_cone.glb", { targetHeight: 1.9 }),
      prepare(base + "nature/plant_bush.glb", { targetHeight: 0.55 }),
      prepare(base + "car/taxi.glb", { targetLength: 1.2, rotateY: -Math.PI / 2 }),
      prepare(base + "chars/character-a.glb", { targetHeight: 0.62 }),
      prepare(base + "chars/character-b.glb", { targetHeight: 0.62 }),
      prepare(base + "chars/character-c.glb", { targetHeight: 0.62 }),
    ]);
    scene.assets = {
      buildings: [b1, b2, b3], trees: [tree], bushes: [bush],
      taxi: taxi, people: [pa, pb, pc],
    };
    // rebuild the static world with the models in place
    if (state.meta) {
      scene.setScene(state.meta);
      scene.attachLabels($("#zoneLabels"));
      bKey = null;
    }
  } catch (err) {
    console.warn("model assets unavailable, keeping the procedural world", err);
  }
}

/* ================================================================== *
 * Guided tour + shareable links
 * ================================================================== */

const TOUR = [
  {
    title: "This is the taxi hall",
    text:
      "Empty taxis queue in the buffer on the left, passengers wait in three lanes, " +
      "and the pickup bays are at the far end. Drag to orbit, pinch or scroll to zoom.",
    target: "#stage",
    sheet: false,
  },
  {
    title: "Switch on a policy",
    text:
      "Each card is one measure a port could adopt. The number on the right is its " +
      "effect on mean wait when applied on its own — so you can see which idea matters.",
    target: "#policyCards",
    sheet: true,
  },
  {
    title: "Prove something changed",
    text:
      "Compare runs the current process (A) and your proposal (B) on the same seed, " +
      "then checks whether the confidence intervals overlap before claiming an effect.",
    target: "#cmpBtn",
    sheet: false,
  },
];

let tourIndex = 0;

function paintTour() {
  const step = TOUR[tourIndex];
  $("#tourStep").textContent = `${tourIndex + 1} / ${TOUR.length}`;
  $("#tourTitle").textContent = step.title;
  $("#tourText").textContent = step.text;
  $("#tourNext").textContent = tourIndex === TOUR.length - 1 ? "Got it" : "Next";
  document.querySelectorAll(".tour-highlight").forEach((el) => el.classList.remove("tour-highlight"));
  // on a phone the cards live inside the bottom sheet: open it so the step
  // actually points at something visible
  if (IS_PHONE) document.body.classList.toggle("sheet-open", !!step.sheet);
  const target = document.querySelector(step.target);
  if (target) {
    target.classList.add("tour-highlight");
    if (target.scrollIntoView) target.scrollIntoView({ block: "nearest" });
  }
}

function startTour() {
  tourIndex = 0;
  $("#tour").hidden = false;
  paintTour();
}

function endTour() {
  $("#tour").hidden = true;
  document.querySelectorAll(".tour-highlight").forEach((el) => el.classList.remove("tour-highlight"));
  if (IS_PHONE) document.body.classList.remove("sheet-open");
  try { localStorage.setItem("hg_tour_done", "1"); } catch {}
  // the effect chips are the first thing worth computing; do it now that the
  // tour is out of the way, one card at a time so the UI never stalls
  setTimeout(computeEffects, 150);
}

function encodeScenario() {
  const payload = { v: state.values, w: state.window, seed: state.seed };
  return btoa(unescape(encodeURIComponent(JSON.stringify(payload))));
}

async function copyLink() {
  const url = `${location.origin}${location.pathname}?s=${encodeScenario()}`;
  const btn = $("#shareBtn");
  try {
    await navigator.clipboard.writeText(url);
    btn.textContent = "copied!";
  } catch {
    window.prompt("Copy this link", url);
    btn.textContent = "link ready";
  }
  setTimeout(() => (btn.textContent = "copy link"), 1600);
}

function loadSharedLink(param) {
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(param))));
    if (data.v) state.values = { ...PRESETS.baseline, ...data.v };
    if (data.w != null) state.window = Number(data.w);
    if (data.seed) state.seed = Number(data.seed);
    const seedOut = $("#seedOut");
    if (seedOut) seedOut.textContent = String(state.seed);
    syncControls();
    return true;
  } catch {
    return false;
  }
}

function init() {
  buildControls();
  syncControls();
  computeBaseline();

  document.querySelectorAll("[data-preset]").forEach((b) => {
    b.addEventListener("click", () => {
      state.values = { ...PRESETS[b.dataset.preset] };
      syncControls();
      setPreset(b.dataset.preset);
      run();
    });
  });

  scene.setQuality(valueOf("highQuality") ? "high" : "low");

  const sheet = $("#sheetToggle");
  const setSheet = (open) => {
    document.body.classList.toggle("sheet-open", open);
    sheet?.setAttribute("aria-expanded", String(open));
  };
  sheet?.addEventListener("click", () =>
    setSheet(!document.body.classList.contains("sheet-open"))
  );

  $("#runBtn").addEventListener("click", () => {
    run();
    // on a phone, get out of the way so the result is visible immediately
    if (IS_PHONE) setSheet(false);
  });

  renderCards();

  $("#tourNext").addEventListener("click", () => {
    if (tourIndex >= TOUR.length - 1) endTour();
    else { tourIndex++; paintTour(); }
  });
  $("#tourSkip").addEventListener("click", endTour);
  $("#shareBtn").addEventListener("click", copyLink);

  let seenTour = false;
  try { seenTour = localStorage.getItem("hg_tour_done") === "1"; } catch {}
  const qq = new URLSearchParams(location.search);
  const tourWanted = qq.get("tour") === "1" ||
    (qq.get("tour") !== "0" && !seenTour && qq.get("compare") !== "1" && !qq.get("s"));
  if (tourWanted) {
    setTimeout(startTour, 400);
  } else {
    setTimeout(computeEffects, 400);
  }

  // Esc dismisses the tour at any point
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#tour").hidden) endTour();
  });

  $("#cmpBtn").addEventListener("click", () => setCompare(!state.compare));
  $("#cmpClose").addEventListener("click", () => setCompare(false));
  $("#trialsSel").addEventListener("change", () => {
    if (state.compare) updateVerdict();
  });

  // drag the chart to scrub through the simulation
  const scrub = (e) => {
    if (!state.frames.length) return;
    const r = chart.getBoundingClientRect();
    const pad = 34;
    const frac = Math.min(1, Math.max(0, (e.clientX - r.left - pad) / (r.width - pad - 8)));
    const i = Math.round(frac * (state.frames.length - 1));
    state.playT = state.from + state.step * i;
    state.playing = false;
    $("#playBtn").textContent = "Play";
  };
  let scrubbing = false;
  chart.addEventListener("pointerdown", (e) => {
    scrubbing = true;
    chart.setPointerCapture(e.pointerId);
    scrub(e);
  });
  chart.addEventListener("pointermove", (e) => scrubbing && scrub(e));
  chart.addEventListener("pointerup", () => (scrubbing = false));
  chart.addEventListener("pointercancel", () => (scrubbing = false));

  // mobile: flip between the two scenes
  const swapBtn = document.createElement("button");
  swapBtn.id = "swapBtn";
  swapBtn.className = "ghost small";
  swapBtn.hidden = true;
  swapBtn.textContent = "Show A";
  swapBtn.addEventListener("click", () => {
    state.showA = !state.showA;
    refreshStage();
  });
  document.querySelector(".cmp-actions").prepend(swapBtn);
  $("#playBtn").addEventListener("click", () => {
    state.playing = !state.playing;
    $("#playBtn").textContent = state.playing ? "Pause" : "Play";
  });
  $("#speed").addEventListener("input", (e) => {
    state.speed = Number(e.target.value);
    $("#speedOut").textContent = `${state.speed}×`;
  });
  $("#windowSel").addEventListener("change", (e) => {
    state.window = Number(e.target.value);
    state.runA = null;
    run();
    if (state.compare) {
      ensureRunA();
      updateVerdict();
    }
  });
  $("#seedBtn").addEventListener("click", () => {
    state.seed = 1 + Math.floor(Math.random() * 9999);
    $("#seedOut").textContent = String(state.seed);
    run();
  });

  const onResize = () => {
    scene.resize();
    drawChart();
  };
  window.addEventListener("resize", onResize);
  window.addEventListener("orientationchange", () => setTimeout(onResize, 250));

  // stop burning battery when the tab is in the background
  let hidden = false;
  document.addEventListener("visibilitychange", () => {
    hidden = document.hidden;
    last = performance.now();
  });

  // deep links: ?preset=smart&pax=650&t=120&window=2
  const q = new URLSearchParams(location.search);
  if (q.get("preset") && PRESETS[q.get("preset")]) {
    state.values = { ...PRESETS[q.get("preset")] };
    setPreset(q.get("preset"));
    syncControls();
  }
  if (q.get("pax")) {
    state.values.paxPerHour = Number(q.get("pax"));
    syncControls();
  }
  if (q.get("window")) state.window = Number(q.get("window"));
  if (q.get("s")) loadSharedLink(q.get("s"));

  run();
  if (q.get("compare") === "1") setCompare(true);

  if (q.get("t")) {
    state.playT = state.from + Number(q.get("t"));
    state.playing = false;
  }
  if (q.get("play") === "0") state.playing = false;

  // Kits load after the first paint so startup is never blocked by the network.
  loadKitAssets();

  // handle for tests, screenshots and video recording
  window.__sim = {
    scene,
    state,
    setCompare,
    getSceneB: () => sceneB,
    /** Let the walkers reach their targets (used for stills and video). */
    settle(seconds = 3) {
      const hour = (state.meta ? state.meta.startHour : 8) + state.playT / 60;
      const n = Math.ceil(seconds * 30);
      for (let i = 0; i < n; i++) scene.tick(1 / 30, hour);
      scene.render(1 / 30);
    },
    /** Advance the playhead by `dMin` simulated minutes and draw one frame. */
    step(dMin) {
      state.playT += dMin;
      const endT = state.from + state.step * (state.frames.length - 1);
      if (state.playT > endT) state.playT = state.from;
      const i = Math.min(state.frames.length - 1,
        Math.max(0, Math.round((state.playT - state.from) / state.step)));
      scene.sync(state.frames[i]);
      scene.tick(1 / 30);
      scene.render(1 / 30);
      updateHud(state.frames[i]);
    },
  };
  requestAnimationFrame(loop);
}

init();
