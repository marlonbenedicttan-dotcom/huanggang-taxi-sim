/**
 * UI shell: controls -> simulation -> 3D playback.
 *
 * Everything runs in the browser, so the site is a static bundle: no API, no
 * server, no cold start.  A 12-hour day simulates in ~50 ms.
 */

import { runSimulation, DEFAULTS, SMART } from "./sim.js";
import { Scene3D } from "./scene.js";
import { CSS_COLOR, CLS_LABEL } from "./layout.js";

const $ = (sel) => document.querySelector(sel);

/* ------------------------------------------------------------------ *
 * Control definitions
 * ------------------------------------------------------------------ */
const GROUPS = [
  {
    name: "Demand",
    items: [
      { key: "paxPerHour", label: "Passengers", min: 300, max: 850, step: 10, unit: "pax/h" },
      { key: "urbanShare", label: "Urban / NT split", min: 0.5, max: 0.95, step: 0.05, pct: true },
      { key: "prebookShare", label: "Pre-booked share", min: 0, max: 0.35, step: 0.05, pct: true },
    ],
  },
  {
    name: "Taxi supply",
    items: [
      { key: "taxiSupplyRatioUrban", label: "Urban taxis", min: 0.7, max: 1.4, step: 0.05, unit: "× demand" },
      { key: "taxiSupplyRatioNt", label: "NT taxis", min: 0.7, max: 1.4, step: 0.05, unit: "× demand" },
      { key: "flexShare", label: "Flexible taxis", min: 0, max: 0.6, step: 0.05, pct: true },
    ],
  },
  {
    name: "Pickup hall",
    items: [
      { key: "stands.urban", label: "Urban bays", min: 3, max: 14, step: 1, int: true },
      { key: "stands.nt", label: "NT bays", min: 1, max: 8, step: 1, int: true },
      { key: "service", label: "Boarding time", min: 0.8, max: 3.5, step: 0.1, unit: "min" },
      { key: "bufferCapacity", label: "Buffer spaces / lane", min: 10, max: 60, step: 5, int: true },
    ],
  },
  {
    name: "Dispatch policy",
    items: [
      { key: "dispatchIntervalMin", label: "Dispatch cycle", min: 0, max: 5, step: 0.25, unit: "min", zeroLabel: "continuous" },
      { key: "dispatchBatch", label: "Taxis per dispatch", min: 2, max: 14, step: 1, int: true },
      { key: "misrouteProb", label: "Wrong-lane rate", min: 0, max: 0.2, step: 0.01, pct: true },
      { key: "appShare", label: "App pre-registration", min: 0, max: 1, step: 0.05, pct: true },
      { key: "pooledStands", label: "Pool urban + NT bays", type: "toggle" },
    ],
  },
  {
    name: "Passengers",
    items: [
      { key: "patienceMeanMin", label: "Tolerance before leaving", min: 10, max: 80, step: 5, unit: "min" },
    ],
  },
];

const WINDOWS = [
  { label: "Morning peak 08–11", from: 0, to: 180 },
  { label: "Midday 11–14", from: 180, to: 360 },
  { label: "Evening peak 16–19", from: 480, to: 660 },
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
  values: { ...PRESETS.baseline },
  window: 0,
  speed: 8,          // simulated minutes per real second
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
  for (const group of GROUPS) {
    const section = document.createElement("section");
    section.className = "group";
    section.innerHTML = `<h2>${group.name}</h2>`;
    for (const item of group.items) {
      const row = document.createElement("div");
      row.className = "row";
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
      });
      section.appendChild(row);
    }
    host.appendChild(section);
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
function buildConfig() {
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

  state.frames = res.frames;
  state.meta = res.meta;
  scene.setScene(res.meta);
  state.playT = 0;
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
  $("#playBtn").textContent = "Pause";
}

/* Compute the baseline reference once so deltas are available on first load. */
function computeBaseline() {
  const cfg = { ...DEFAULTS, anim: { from: 0, to: 60, step: 60 } };
  state.baseline = runSimulation(cfg, 1).metrics;
}

/* ------------------------------------------------------------------ *
 * KPI cards
 * ------------------------------------------------------------------ */
const KPI = [
  { key: "waitMean", label: "Mean wait", unit: "min", digits: 1, lowerBetter: true },
  { key: "waitP90", label: "90th percentile", unit: "min", digits: 1, lowerBetter: true },
  { key: "abandonRatePct", label: "Gave up", unit: "%", digits: 1, lowerBetter: true },
  { key: "queueAvg", label: "Avg waiting", unit: "parties", digits: 0, lowerBetter: true },
  { key: "standUtilPct", label: "Bays busy", unit: "%", digits: 0, lowerBetter: false },
  { key: "bufferAvg", label: "Taxis waiting", unit: "", digits: 0, lowerBetter: false },
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
  cctx.strokeStyle = "rgba(120,140,170,0.14)";
  cctx.lineWidth = 1;
  for (let g = 0; g <= 4; g++) {
    const y = pad.t + (ih * g) / 4;
    cctx.beginPath();
    cctx.moveTo(pad.l, y);
    cctx.lineTo(w - pad.r, y);
    cctx.stroke();
  }
  cctx.fillStyle = "rgba(150,170,195,0.75)";
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
  cctx.strokeStyle = "#cfd9e8";
  cctx.lineWidth = 1.4;
  cctx.stroke();

  // hour ticks
  cctx.fillStyle = "rgba(150,170,195,0.65)";
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
  cctx.strokeStyle = "rgba(255,255,255,0.55)";
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

  scene.tick(dt);
  scene.render(dt);
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
    .map(([c, n]) => `<span class="chip"><i style="background:${CSS_COLOR[c]}"></i>${n} ${CLS_LABEL[c].split(" ")[0]}</span>`)
    .join("");
  $("#counts").innerHTML = chips + `<span class="chip"><i class="buf"></i>${frame.buf} taxis in buffer</span>`;
}

/* ------------------------------------------------------------------ *
 * Wiring
 * ------------------------------------------------------------------ */
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

  $("#runBtn").addEventListener("click", run);
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
    run();
  });
  $("#seedBtn").addEventListener("click", () => {
    state.seed = 1 + Math.floor(Math.random() * 9999);
    $("#seedOut").textContent = String(state.seed);
    run();
  });

  window.addEventListener("resize", () => {
    scene.resize();
    drawChart();
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

  run();

  if (q.get("t")) {
    state.playT = state.from + Number(q.get("t"));
    state.playing = false;
  }
  if (q.get("play") === "0") state.playing = false;

  // handle for tests, screenshots and video recording
  window.__sim = {
    scene,
    state,
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
