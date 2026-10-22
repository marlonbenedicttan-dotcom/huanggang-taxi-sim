/**
 * 2.5D pixel renderer.
 *
 * Ground is drawn in plan (slightly foreshortened); everything that stands on
 * it is a billboard sprite anchored at its feet and sorted by depth. This is
 * the "Stardew" arrangement: you see the whole rank at once, but the taxis and
 * people still have silhouettes.
 *
 * Everything renders into a 640x360 buffer at 1:1 and is then blitted with
 * nearest-neighbour scaling, so the pixel size is constant regardless of the
 * window.
 *
 * The public surface mirrors the old three.js Scene3D so app.js does not care
 * which renderer is behind it.
 */
import {
  CLS, CLS_COLOR, LANES, TERMINAL, DOORS, EXIT_X,
  bufferPos, standPos, bayPos, queuePos, baySlots, doorPos,
} from "../layout.js";
import { PAL, LIVERY, SPR, drawText, textWidth } from "./sprites.js";

/* ---------------- projection ---------------- */
let W = 640;
let H = 360;
let U = 12.6;   // pixels per world unit along the hall (x)
let V = 6.9;    // pixels per world unit into the screen (z) — foreshortened
let OX = 16;
let OY = 118;   // screen y of z = 0

const LANDSCAPE = { W: 640, H: 360, U: 12.6, V: 6.9, OX: 16, OY: 118 };
const PORTRAIT = { W: 420, H: 520, U: 12.0, V: 10.5, OX: -86, OY: 150 };

// The apron, lanes and terminal are drawn wider than the visible world so the
// frame never shows the edge of the building against bare grass.
const X0 = -6;
const X1 = 54;

const X = (x) => OX + x * U;
const Z = (z) => OY + z * V;

const CLS_NAME = ["urban", "nt", "prebook", "flex"];

/** Pre-render a sprite rotated 90°, so bay taxis face the terminal. */
function rotated(src) {
  const cv = document.createElement("canvas");
  cv.width = src.height;
  cv.height = src.width;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  g.translate(cv.width / 2, cv.height / 2);
  g.rotate(Math.PI / 2);
  g.drawImage(src, -src.width / 2, -src.height / 2);
  return cv;
}

/**
 * Boarding positions. layout.js packs every group into one vertical column,
 * which was invisible in perspective and is not in plan: urban, NT and
 * pre-booked bays end up stacked on the same pixels. Each lane gets its own
 * boarding kerb at the east end instead.
 */
const BAY_X = 35.4;
const BAY_DX = 1.06;
function baySlot(groupId, idx) {
  const lane = groupId === 3 ? LANES.flex : LANES[CLS[groupId]] ?? LANES.urban;
  return [BAY_X + Math.min(idx, 8) * BAY_DX, lane];
}

const TAXI_SIDE = SPR.taxi;
const TAXI_BAY = Object.fromEntries(
  Object.entries(SPR.taxi).map(([k, v]) => [k, rotated(v)])
);

export class PixelScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.ctx.imageSmoothingEnabled = false;

    this.buf = document.createElement("canvas");
    this.buf.width = W;
    this.buf.height = H;
    this.g = this.buf.getContext("2d");
    this.g.imageSmoothingEnabled = false;

    this.taxis = new Map();
    this.people = new Map();
    this.time = 0;
    this.hour = 9;
    this.quality = "high";
    this.dprScale = 1;
    this.portrait = false;
    this.assets = null;

    // stubs so the old diagnostics in app.js do not explode
    this.renderer = { info: { render: { calls: 0, triangles: 0 } } };
    this.camera = { position: { toArray: () => [0, 0, 0] } };
    this.target = { toArray: () => [0, 0, 0] };
    this.root = { children: [] };
    this.orbit = { theta: 0, phi: 0, radius: 0 };
    this.labelEls = null;
    this.metaFrame = null;
    this.meta = null;
    this.bays = [];

    // viewport camera over the finished buffer: pan and zoom are pure blits,
    // so the world keeps its authored pixel size at every zoom level
    this.cam = this._defaultCam();
    this._bindCamera();

    this.resize();
  }

  /* ---------------- sizing ---------------- */
  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const cw = Math.max(1, Math.round(rect.width * dpr));
    const ch = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.width = cw;
    this.canvas.height = ch;
    this.dpr = dpr;
    this.portrait = rect.height > rect.width * 1.2;

    // a tall screen gets its own framing: a narrower slice of the hall and a
    // more top-down ground, so the scene fills the panel instead of sitting in
    // a letterboxed strip with acres of grass above and below
    this.view = this.portrait ? PORTRAIT : LANDSCAPE;
    this._applyView();
    // fit the 16:9 buffer, letterboxing with grass so the frame never jumps
    this.scale = Math.min(cw / W, ch / H);
    this.offX = Math.round((cw - W * this.scale) / 2);
    // portrait: anchor to the top so the spare height falls behind the sheet
    this.offY = this.portrait
      ? Math.round(48 * dpr)
      : Math.round((ch - H * this.scale) / 2);
    this.ctx.imageSmoothingEnabled = false;
  }

  /* ---------------- camera ---------------- */
  _bindCamera() {
    const c = this.canvas;
    const pts = new Map();
    let drag = null;
    let pinch = null;

    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    this._clamp = clamp;

    const toBuffer = (clientX, clientY) => {
      const rect = c.getBoundingClientRect();
      const px = (clientX - rect.left) * (c.width / rect.width);
      const py = (clientY - rect.top) * (c.height / rect.height);
      const r = this._viewRect();
      const k = this.scale * this.cam.zoom;
      return { x: r.x + (px - this.offX) / k, y: r.y + (py - this.offY) / k };
    };

    c.style.cursor = "grab";
    c.style.touchAction = "none";

    this._screenToBuffer = (px, py) => {
      const r = this._viewRect();
      const k = this.scale * this.cam.zoom;
      return { x: r.x + (px - this.offX) / k, y: r.y + (py - this.offY) / k };
    };
    this._zoomAt = (clientX, clientY, factor, animate = false) => {
      const rect = c.getBoundingClientRect();
      const px = (clientX - rect.left) * (c.width / rect.width);
      const py = (clientY - rect.top) * (c.height / rect.height);
      const before = this._screenToBuffer(px, py);
      const z0 = this.cam.zoom;
      const z1 = clamp(z0 * factor, 1, 4);
      if (Math.abs(z1 - z0) < 0.001) return;

      // move the camera so the point under the cursor stays put
      this.cam.zoom = z1;
      const after = this._screenToBuffer(px, py);
      const to = { x: this.cam.x + (before.x - after.x), y: this.cam.y + (before.y - after.y) };

      if (animate) {
        this.cam.zoom = z0;
        this._anim = {
          t: 0, dur: 0.26, z0, z1,
          c0: { x: this.cam.x, y: this.cam.y }, c1: to,
        };
      } else {
        this.cam.x = to.x;
        this.cam.y = to.y;
        this._clampCam();
      }
    };

    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      this._zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });

    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture?.(e.pointerId);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        this._dragging = true;
        this.vel = null;
        this._lastMove = 0;
        drag = { x: e.clientX, y: e.clientY };
        c.style.cursor = "grabbing";
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), zoom: this.cam.zoom };
        drag = null;
      }
    });

    c.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size >= 2 && pinch) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch.d > 10) {
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const before = toBuffer(mid.x, mid.y);
          this.cam.zoom = clamp(pinch.zoom * (d / pinch.d), 1, 4);
          const after = toBuffer(mid.x, mid.y);
          this.cam.x += before.x - after.x;
          this.cam.y += before.y - after.y;
          this._clampCam();
        }
        return;
      }

      if (!drag) return;

      // the hand wins over any easing: finish the dive rather than freeze
      // halfway through it
      if (this._anim) {
        this.cam.zoom = this._anim.z1;
        this._anim = null;
      }

      const rect = c.getBoundingClientRect();
      const k = this.scale * this.cam.zoom * (c.width / rect.width);
      const dx = (e.clientX - drag.x) / k;
      const dy = (e.clientY - drag.y) / k;
      this.cam.x -= dx;
      this.cam.y -= dy;
      drag = { x: e.clientX, y: e.clientY };
      this._clampCam();

      // remember the throw so the pan keeps drifting after release
      const now = performance.now();
      const span = Math.max(8, now - (this._lastMove || now));
      this._lastMove = now;
      const vx = -dx / (span / 1000);
      const vy = -dy / (span / 1000);
      const speed = Math.hypot(vx, vy);
      const cap = 520;                   // buffer px per second
      const f = speed > cap ? cap / speed : 1;
      this.vel = { x: vx * f, y: vy * f };
    });

    const end = (e) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) pinch = null;
      if (pts.size === 0) {
        drag = null;
        this._dragging = false;
        this._lastMove = 0;
        c.style.cursor = "grab";
      }
    };
    c.addEventListener("pointerup", end);
    c.addEventListener("pointercancel", end);

    // double-click dives into the point you clicked; the ⟲ button resets
    c.addEventListener("dblclick", (e) => {
      this._zoomAt(e.clientX, e.clientY, e.shiftKey ? 1 / 1.6 : 1.6);
    });
  }

  /** Visible window into the buffer, centred on the camera. */
  _viewRect() {
    const z = this.cam.zoom;
    const w = W / z;
    const h = H / z;
    return {
      x: this._clamp(this.cam.x - w / 2, 0, W - w),
      y: this._clamp(this.cam.y - h / 2, 0, H - h),
      w, h,
    };
  }

  _clampCam() {
    const z = this.cam.zoom;
    const wx = W / (2 * z);
    const hy = H / (2 * z);
    this.cam.x = this._clamp(this.cam.x, wx, W - wx);
    this.cam.y = this._clamp(this.cam.y, hy, H - hy);
  }

  /** Zoom about the middle of the canvas (what the +/− buttons call). */
  zoomBy(factor) {
    const r = this.canvas.getBoundingClientRect();
    this._zoomAt?.(r.left + r.width / 2, r.top + r.height / 2, factor, true);
  }

  /**
   * The opening view: framed on the hall itself (not on the buffer), slightly
   * closer than "fit" so there is room to drag without ever auto-zooming.
   */
  _defaultCam() {
    return { x: X(24), y: Z(5.5), zoom: 1.25 };
  }

  resetView() {
    this.cam = this._defaultCam();
    this.vel = null;
    this._anim = null;
  }

  _applyView() {
    const v = this.view;
    if (!v) return;
    const key = `${v.W}x${v.H}`;
    if (this._viewKey && this._viewKey !== key) this.resetView();
    this._viewKey = key;
    if (W !== v.W || H !== v.H) {
      W = v.W; H = v.H;
      this.buf.width = W;
      this.buf.height = H;
      this.g = this.buf.getContext("2d");
      this.g.imageSmoothingEnabled = false;
    }
    U = v.U; V = v.V; OX = v.OX; OY = v.OY;
    this.scale = Math.min(this.canvas.width / W, this.canvas.height / H);
    this.offX = Math.round((this.canvas.width - W * this.scale) / 2);
    this.offY = this.portrait
      ? Math.round(48 * (this.dpr || 1))
      : Math.round((this.canvas.height - H * this.scale) / 2);
  }

  setQuality(q) {
    this.quality = q;
  }

  setDprScale(v) {
    this.dprScale = v;
  }

  setHour(h) {
    this.hour = h;
  }

  /* ---------------- world building ---------------- */
  setScene(meta) {
    this.meta = meta;
    this.bays = [];
    for (const gid of meta?.groups || []) {
      const id = CLS.indexOf(gid);
      if (id < 0) continue;
      const n = id === 0 ? 8 : id === 1 ? 3 : id === 2 ? 2 : 11;
      for (let i = 0; i < n; i++) {
        const [x, z] = baySlot(id, i);
        this.bays.push({ id, x, z, i });
      }
    }
  }

  /** CSS pixels for a world point — used by the HTML zone counters. */
  project(x, y, z) {
    const s = this.scale / (this.dpr || 1);
    const r = this._viewRect();
    const bx = (X(x) - r.x) * this.cam.zoom;
    const by = (Z(z) - (y || 0) * 13 - r.y) * this.cam.zoom;
    // the floating counters live in the stage, not the canvas, so add the
    // canvas's own offset — in the split view that is half the stage
    const cr = this.canvas.getBoundingClientRect();
    const host = this.canvas.parentElement?.getBoundingClientRect() || { left: 0, top: 0 };
    return {
      x: cr.left - host.left + this.offX / (this.dpr || 1) + bx * s,
      y: cr.top - host.top + this.offY / (this.dpr || 1) + by * s,
      z: 0,
    };
  }

  attachLabels(host) {
    if (!host) {
      this.labelEls = null;
      return;
    }
    host.innerHTML = "";
    this.labelEls = [0, 1, 2].map((c) => {
      const el = document.createElement("div");
      el.className = "zone-label";
      el.style.setProperty("--c", ["#f2685c", "#2ec4a6", "#4a9eff"][c]);
      host.appendChild(el);
      return el;
    });
    const buf = document.createElement("div");
    buf.className = "zone-label buffer";
    host.appendChild(buf);
    this.labelEls.push(buf);
  }

  /* ---------------- per-frame state ---------------- */
  sync(frame) {
    this.metaFrame = frame;
    if (!frame) return;

    // A scrubbed playhead (or the first frame) is not a moment in continuous
    // time: entities must appear where they belong, not walk in from the door.
    const jump = this._lastT == null || Math.abs(frame.t - this._lastT) > 0.75;
    this._lastT = frame.t;
    const seenT = new Set();
    const seenP = new Set();

    for (const row of frame.tx) {
      const [id, clsId, state, slot, group, bay] = row;
      seenT.add(id);
      const [x, z] = state === 2 ? baySlot(group, bay)
        : state === 1 ? standPos(clsId, slot)
        : bufferPos(clsId, slot);
      let e = this.taxis.get(id);
      if (!e) {
        e = { x: -14, z: 25.4, tx: x, tz: z, v: 0, cls: clsId, face: 1, exiting: false,
              wp: { x: -3.0, z: 22.6 } };
        this.taxis.set(id, e);
      }
      e.tx = x;
      e.tz = z;
      e.parked = state === 2;
      e.exiting = false;
    }

    for (const [id, clsId, slot] of frame.px) {
      seenP.add(id);
      // queuePos wraps after 48 people, which stacked everyone on top of
      // everyone once a lane got busy. Offset each extra layer instead.
      const layer = Math.floor(slot / 48);
      const k = slot % 48;
      const col = k % 12, row = Math.floor(k / 12);
      // brick pattern: every other row is offset half a slot, so the queue
      // reads as a loose crowd instead of a grid of identical figures
      const stagger = row % 2 ? 0.4 : 0;
      const qx = 13.4 + col * 0.8 + stagger + layer * 0.42;
      const qz = LANES[CLS[clsId]] + [-2.05, -0.68, 0.68, 2.05][row] - layer * 0.5;
      const jx = (((id * 37) % 17) / 17 - 0.5) * 0.16;
      const jz = (((id * 53) % 19) / 19 - 0.5) * 0.16;
      let e = this.people.get(id);
      if (!e) {
        const [dx, dz] = doorPos(clsId);
        // golden-ratio hash: continuous, so two people rarely share a line
        const h1 = (id * 0.6180339887) % 1;
        const h2 = (id * 0.7548776662) % 1;
        const across = (h1 - 0.5) * 1.9;                          // fan out of the doors
        const behind = h2 * 0.5;                                   // some are a step further back
        e = {
          x: dx + across,
          z: dz + behind,
          tx: qx, tz: qz, cls: clsId, leaving: false,
          wait: ((id * 11) % 9) * 0.055,                         // leave in a trickle
          speed: 1.55 + h2 * 0.85,                                // ... and spread on the way
          seed: id,
          // walk straight out of the doors, then fan toward their own column
          // instead of everyone gathering on one aisle line first
          path: [
            [dx + across, dz + behind + 0.9],
            [qx + (h2 - 0.5) * 0.7, LANES[CLS[clsId]] - 3.2 + (h1 - 0.5) * 0.8],
          ],
        };
        this.people.set(id, e);
      }
      e.tx = qx + jx;
      e.tz = qz + jz;
      e.layer = layer;
    }

    for (const [id, e] of this.people) {
      if (seenP.has(id)) continue;
      if (!e.leaving) {
        e.leaving = true;
        e.tx = 38.2 - (e.seed % 3) * 0.5;
        e.tz = LANES[CLS[e.cls]] + ((e.seed % 5) - 2) * 0.22;
        e.wait = 0.35;
        e.path = [[e.x, LANES[CLS[e.cls]] - 3.0]];
      }
    }

    for (const [id, e] of this.taxis) {
      if (seenT.has(id)) continue;
      if (e.exiting !== "exit") {
        e.exiting = "exit";
        e.tx = EXIT_X + 8;
        e.tz = LANES[CLS[e.cls]];
        e.parked = false;
      }
    }

    if (jump) {
      for (const [, e] of this.taxis) {
        if (e.exiting === "exit") { e.x = e.tx; continue; }
        e.x = e.tx; e.z = e.tz; e.v = 0; e.wp = null;
      }
      for (const [id, e] of this.people) {
        if (e.leaving) { this.people.delete(id); continue; }
        e.x = e.tx; e.z = e.tz;
        e.path = null;
        e.wait = 0;
      }
    }
  }

  /** Queue slot (same wrapping rule as sync) so labels land on the crowd. */
  _queueSlot(clsId, slot) {
    const layer = Math.floor(slot / 48);
    const k = slot % 48;
    const col = k % 12, row = Math.floor(k / 12);
    return [
      13.4 + col * 0.8 + (row % 2 ? 0.4 : 0) + layer * 0.42,
      LANES[CLS[clsId]] + [-2.05, -0.68, 0.68, 2.05][row] - layer * 0.5,
    ];
  }

  /* ---------------- motion ---------------- */
  tick(dt, hour) {
    this.time += dt;
    if (hour != null) this.setHour(hour);
    const step = Math.min(dt, 0.1);

    for (const [id, e] of this.taxis) {
      let gx = e.tx, gz = e.tz;
      if (e.wp) {
        if (Math.hypot(e.wp.x - e.x, e.wp.z - e.z) < 1.4) e.wp = null;
        else { gx = e.wp.x; gz = e.wp.z; }
      }
      const dx = gx - e.x, dz = gz - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 9) {
        e.x = e.tx; e.z = e.tz; e.v = 0;
      } else if (d > 0.02) {
        const want = Math.min(e.exiting ? 9 : 7, Math.max(0.5, d * 2.6));
        e.v += (want - e.v) * Math.min(1, step * 6);
        const len = Math.min(d, e.v * step);
        e.x += (dx / d) * len;
        e.z += (dz / d) * len;
        if (Math.abs(dx) > 0.05) e.face = dx > 0 ? 1 : -1;
      } else {
        e.v = 0;
      }
      if (e.exiting === "exit" && d < 0.4) this.taxis.delete(id);
    }

    for (const [id, e] of this.people) {
      if (e.wait > 0) { e.wait -= step; continue; }

      // follow waypoints first (the aisle), then head for the slot
      let gx = e.tx, gz = e.tz;
      if (e.path && e.path.length) {
        const [wx, wz] = e.path[0];
        if (Math.hypot(wx - e.x, wz - e.z) < 0.18) {
          e.path.shift();
          if (e.path.length) { gx = e.path[0][0]; gz = e.path[0][1]; }
        } else {
          gx = wx; gz = wz;
        }
      }

      const dx = gx - e.x, dz = gz - e.z;
      const d = Math.hypot(dx, dz);
      if (d > 6) {
        e.x = e.tx; e.z = e.tz;
      } else if (d > 0.03) {
        const sp = e.leaving ? 2.6 : (e.speed || 2.1);
        const len = Math.min(d, sp * step);
        e.x += (dx / d) * len;
        e.z += (dz / d) * len;
        e.moving = true;
        e.face = dx >= 0 ? 1 : -1;
      } else {
        e.moving = false;
      }
      if (e.boarded) {
        e.fade = (e.fade ?? 1) - step * 2.2;
        if (e.fade <= 0) this.people.delete(id);
        continue;
      }
      if (e.leaving && d < 0.25) {
        e.boarded = true;
        e.moving = false;
      }
    }

    this._updateLabels();
  }

  _updateLabels() {
    if (!this.labelEls || !this.metaFrame) return;
    const f = this.metaFrame;
    const r = this._viewRect();

    // a counter anchored to something the camera has panned off-screen must
    // disappear, otherwise it floats over the sidebar in stage coordinates
    const inView = (wx, wz) => {
      const bx = X(wx);
      const by = Z(wz) - 1.7 * 13;
      return bx > r.x - 12 && bx < r.x + r.w + 12 && by > r.y - 12 && by < r.y + r.h + 12;
    };

    let worst = 0;
    for (let c = 1; c < 3; c++) if (f.q[c] > f.q[worst]) worst = c;

    for (let c = 0; c < 3; c++) {
      const el = this.labelEls[c];
      const [wx, wz] = this._queueSlot(c, Math.min(6, Math.max(0, f.q[c] - 1)));
      const p = this.project(wx, 1.7, wz);
      const n = f.q[c];
      // a pill whose anchor is near the edge would hang off the stage
      const w = this.canvas.parentElement?.clientWidth || W;
      const nearEdge = p.x < 40 || p.x > w - 40;
      el.classList.toggle("hidden", n === 0 || !inView(wx, wz) || nearEdge);
      el.classList.toggle("worst", c === worst && n > 6);
      el.innerHTML = `<b>${n}</b> waiting`;
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }

    const buf = this.labelEls[3];
    const [bx, bz] = bufferPos(0, 5);
    const pb = this.project(bx, 1.7, bz);
    buf.innerHTML = `<b>${f.buf}</b> taxis`;
    buf.style.transform = `translate(${pb.x}px, ${pb.y}px) translate(-50%, -100%)`;
    buf.classList.toggle("hidden", !inView(bx, bz));
  }

  /* ================================================================== *
   * drawing
   * ================================================================== */
  /** Momentum and eased zoom, so a throw glides and a dive is not a jump cut. */
  _stepCamera(dt) {
    const d = Math.min(dt || 0.016, 0.05);
    const ez = (k) => 1 - Math.pow(1 - k, 3);

    if (this._anim) {
      const a = this._anim;
      a.t += d;
      const k = Math.min(1, a.t / a.dur);
      const e = ez(k);
      this.cam.zoom = a.z0 + (a.z1 - a.z0) * e;
      this.cam.x = a.c0.x + (a.c1.x - a.c0.x) * e;
      this.cam.y = a.c0.y + (a.c1.y - a.c0.y) * e;
      this._clampCam();
      if (k >= 1) this._anim = null;
      return;
    }

    if (!this._dragging && this.vel) {
      const v = this.vel;
      if (Math.hypot(v.x, v.y) < 6) {
        this.vel = null;
        return;
      }
      this.cam.x += v.x * d;
      this.cam.y += v.y * d;
      const damp = Math.pow(0.0009, d);
      v.x *= damp;
      v.y *= damp;
      this._clampCam();
    }
  }

  /**
   * Everything that never changes is painted once into an offscreen layer.
   * Redrawing the grass dither and the terminal every frame was ~60k fillRect
   * calls, which is what made phones crawl.
   */
  _ensureStatic() {
    const key = `${W}x${H}`;
    if (this._static && this._staticKey === key) return;
    if (!this._static) this._static = document.createElement("canvas");
    this._static.width = W;
    this._static.height = H;
    const g = this._static.getContext("2d");
    g.imageSmoothingEnabled = false;
    const real = this.g;
    this.g = g;
    this._drawGrass();
    this._drawGround();
    this._drawLanes();
    this._drawMarkings();
    this._drawRoad();
    this._drawBackdrop();
    this._drawTerminal();
    this.g = real;
    this._staticKey = key;
  }

  render(dt) {
    this._stepCamera(dt);
    this._applyView();          // compare view: panels have different sizes
    if (this.canvas.id === "scene") {
      const ctl = document.getElementById("camCtl");
      if (ctl && ctl.hidden) ctl.hidden = false;
      const lvl = document.getElementById("camLvl");
      if (lvl) lvl.textContent = `${Math.round(this.cam.zoom * 100)}%`;
    }
    const g = this.g;
    g.clearRect(0, 0, W, H);

    this._ensureStatic();
    g.drawImage(this._static, 0, 0);
    this._drawTraffic();
    this._drawPropsAndPeople();
    this._drawWeather();
    this._drawFrame();

    const c = this.ctx;
    // fill the letterbox with a continuation of the lawn, so a tall phone
    // panel reads as more ground rather than as empty page
    const grad = c.createLinearGradient(0, 0, 0, this.canvas.height);
    grad.addColorStop(0, "#63904f");
    grad.addColorStop(0.55, PAL.grass);
    grad.addColorStop(1, "#5b8547");
    c.fillStyle = grad;
    c.fillRect(0, 0, this.canvas.width, this.canvas.height);
    c.imageSmoothingEnabled = false;
    const r = this._viewRect();
    c.drawImage(this.buf, r.x, r.y, r.w, r.h,
      this.offX, this.offY, Math.round(W * this.scale), Math.round(H * this.scale));
  }

  _drawGrass() {
    const g = this.g;
    g.fillStyle = PAL.grass;
    g.fillRect(0, 0, W, H);

    // dither so the lawn is not a flat block of colour
    g.fillStyle = PAL.grassDark;
    for (let y = 0; y < H; y += 2) {
      for (let x = (y % 4 === 0 ? 0 : 1); x < W; x += 2) g.fillRect(x, y, 1, 1);
    }

    // tufts
    g.fillStyle = PAL.grassLight;
    for (let i = 0; i < 90; i++) {
      const x = (i * 71 + 23) % W;
      const y = (i * 137 + 41) % H;
      if (y > 44 && y < 344 && x > 6 && x < 634) continue;
      g.fillRect(x, y, 1, 2);
      g.fillRect(x + 1, y + 1, 1, 1);
    }
  }

  _drawGround() {
    const g = this.g;
    const x0 = X(X0), x1 = X(X1);
    const y0 = Z(-3.4), y1 = Z(24.6);

    // apron
    g.fillStyle = PAL.stone;
    g.fillRect(x0, y0, x1 - x0, y1 - y0);

    // expansion joints every 4 units
    g.fillStyle = "#cbc2b0";
    for (let x = 0; x <= 48; x += 4) g.fillRect(Math.round(X(x)), y0, 1, y1 - y0);
    for (let z = -3; z <= 24; z += 4) g.fillRect(x0, Math.round(Z(z)), x1 - x0, 1);

    // kerb ring with a lit top edge
    g.fillStyle = "#efe8d8";
    g.fillRect(x0, y0 - 3, x1 - x0, 3);
    g.fillStyle = "#b7ae9c";
    g.fillRect(x0, y0 - 1, x1 - x0, 1);
  }

  _drawLanes() {
    const g = this.g;
    for (let id = 0; id < 3; id++) {
      const z = LANES[CLS[id]];
      const top = Z(z - 1.9);
      const bot = Z(z + 1.9);
      const h = bot - top;

      // asphalt
      g.fillStyle = PAL.road;
      g.fillRect(X(X0), top, X(X1) - X(X0), h);

      // far edge falls into shade, near edge catches the light
      g.fillStyle = "rgba(30,34,40,0.16)";
      g.fillRect(X(X0), top, X(X1) - X(X0), 3);

      // wear: two darker tyre tracks
      g.fillStyle = PAL.roadDark;
      g.fillRect(X(X0), top + 6, X(X1) - X(X0), 3);
      g.fillRect(X(X0), bot - 9, X(X1) - X(X0), 3);

      // coloured kerb on the terminal side
      g.fillStyle = LIVERY[CLS[id]];
      g.fillRect(X(X0), top - 2, X(X1) - X(X0), 2);
      g.fillStyle = "#cbc2b0";
      g.fillRect(X(X0), bot, X(X1) - X(X0), 2);
      g.fillStyle = "#efe8d8";
      g.fillRect(X(X0), bot + 2, X(X1) - X(X0), 1);

      // lane name painted on the asphalt
      drawText(g, ["URBAN", "NEW TERRITORIES", "PRE-BOOKED"][id],
        X(5.6), Math.round(top + h / 2) - 2, "rgba(248,244,232,0.78)", 1);

      // chevrons pointing to the bays
      g.fillStyle = "rgba(240,236,222,0.35)";
      for (let i = 0; i < 3; i++) {
        const cx = Math.round(X(30 + i * 2.4));
        const cy = Math.round(top + h / 2);
        g.fillRect(cx, cy - 3, 1, 7);
        g.fillRect(cx + 1, cy - 2, 1, 5);
        g.fillRect(cx + 2, cy - 1, 1, 3);
      }
    }
  }

  _drawMarkings() {
    const g = this.g;

    // queue ladder: four rows of stand-here ticks per lane
    for (let id = 0; id < 3; id++) {
      const z = LANES[CLS[id]];
      g.fillStyle = "rgba(250,246,232,0.28)";
      for (let i = 0; i < 12; i++) {
        const x = Math.round(X(13.4 + i * 0.8));
        for (const dz of [-2.05, -0.68, 0.68, 2.05]) {
          g.fillRect(x, Math.round(Z(z + dz) - 2), 1, 4);
        }
      }
      // the queue pad itself is a shade lighter than the lane
      g.fillStyle = "rgba(255,255,255,0.05)";
      g.fillRect(X(13.2), Z(z - 2.7), X(23.6) - X(13.2), Z(z + 2.3) - Z(z - 2.7));
    }

    // bay pads + numbers
    for (const b of this.bays) {
      const x = X(b.x);
      const y = Z(b.z);
      const w = 1.6 * U;
      const h = 1.25 * V;
      g.fillStyle = "rgba(250,246,232,0.35)";
      g.fillRect(Math.round(x - w / 2), Math.round(y - h / 2), Math.round(w), 1);
      g.fillRect(Math.round(x - w / 2), Math.round(y + h / 2) - 1, Math.round(w), 1);
      g.fillStyle = LIVERY[CLS[b.id]];
      g.fillRect(Math.round(x - w / 2), Math.round(y - h / 2) - 1, Math.round(w), 1);
    }

  }

  _drawRoad() {
    const g = this.g;
    const top = Z(26.2);
    const bot = Z(31);
    g.fillStyle = "#63676d";
    g.fillRect(0, top, W, bot - top);
    g.fillStyle = "#efe8d8";
    g.fillRect(0, top, W, 1);
    g.fillRect(0, bot - 1, W, 1);
    g.fillStyle = "#d8d2bf";
    for (let x = 8; x < W; x += 26) g.fillRect(x, Math.round(top + (bot - top) / 2), 12, 1);

    drawText(g, "TAXI APPROACH", 12, Math.round(top + 4), "rgba(240,236,222,0.5)", 1);
  }

  /** Only the moving cars on the approach road. */
  _drawTraffic() {
    const g = this.g;
    const top = Z(26.2);
    const lanes = [top + 7, top + 17];
    for (let i = 0; i < 3; i++) {
      const dir = i % 2 === 0 ? 1 : -1;
      const speed = 26 + i * 9;
      const span = W + 40;
      let x = ((this.time * speed + i * 210) % span) - 20;
      if (dir < 0) x = W - x;
      const y = lanes[i % 2];
      const spr = TAXI_SIDE[["urban", "nt", "prebook"][i]];
      g.save();
      if (dir < 0) {
        g.translate(Math.round(x), Math.round(y));
        g.scale(-1, 1);
        g.drawImage(spr, -7, -8);
      } else {
        g.drawImage(spr, Math.round(x - 7), Math.round(y - 8));
      }
      g.restore();
    }
  }

  /** Far lawn behind the terminal: a second rank of trees and a little haze. */
  _drawBackdrop() {
    const g = this.g;
    const horizon = Z(TERMINAL.y) - 66;
    const base = horizon - 34;
    const row = [[-6, 1.05], [1, 0.9], [8, 1.1], [16, 0.95], [23, 1.05],
                 [31, 0.9], [38, 1.1], [46, 0.95], [53, 1.0]];
    for (const [x, sc] of row) {
      const spr = SPR.tree;
      const w = Math.round(spr.width * sc);
      const h = Math.round(spr.height * sc);
      const px = Math.round(X(x) - w / 2);
      if (px > W || px + w < 0) continue;
      g.drawImage(spr, px, Math.round(base - h), w, h);
    }

    // haze pushes the back row away instead of letting it compete
    for (let i = 0; i < 4; i++) {
      g.fillStyle = `rgba(168,190,205,${0.10 - i * 0.02})`;
      g.fillRect(0, 0, W, Math.round(base) + i * 12);
    }
  }

  _drawTerminal() {
    const g = this.g;

    // treeline on the far lawn: this grass is *above* the building, so it is
    // further away — trees here stand on ground the viewer can see.
    const horizon = Z(TERMINAL.y) - 66;   // top edge of the terminal wall
    for (const [x, scale] of [[-2, 0.9], [4, 1.05], [11, 0.85], [25, 0.95],
                              [31, 1.1], [38, 0.9], [45, 1.0], [50, 0.85]]) {
      const spr = SPR.tree;
      const w = Math.round(spr.width * scale);
      const h = Math.round(spr.height * scale);
      g.drawImage(spr, Math.round(X(x) - w / 2), Math.round(horizon - h + 2), w, h);
    }
    const left = X(X0);
    const right = X(X1);
    const base = Z(TERMINAL.y + TERMINAL.depth / 2);   // front wall meets the pavement
    const wallH = 66;
    const top = base - wallH;

    // facade
    g.fillStyle = PAL.wall;
    g.fillRect(left, top, right - left, wallH);
    g.fillStyle = PAL.wallShade;
    g.fillRect(left, base - 4, right - left, 4);

    // windows: irregular bays and the odd solid pier, so the frontage is not
    // a repeating strip of identical rectangles
    const BAYS = [2.5, 3.3, 2.1, 3.0, 2.6, 3.5, 2.2, 2.8];
    let bx = 0.8;
    let bi = 0;
    while (bx < 47) {
      const wUnits = BAYS[bi % BAYS.length];
      const wx = Math.round(X(bx));
      const wpx = Math.round(wUnits * U) - 3;
      const pier = bi % 7 === 3;

      g.fillStyle = "#d9c6a4";
      g.fillRect(wx, top, Math.round(wUnits * U), wallH);

      if (!pier && wpx > 5) {
        for (const row of [0, 1]) {
          const wy = Math.round(top + 8 + row * 12);
          g.fillStyle = "#8a6f52";
          g.fillRect(wx + 1, wy - 1, wpx + 2, 9);
          g.fillStyle = PAL.window;
          g.fillRect(wx + 2, wy, wpx, 7);
          g.fillStyle = PAL.windowLit;
          g.fillRect(wx + 3, wy + 1, Math.max(2, (wpx / 2) | 0), 2);
        }
      }
      bx += wUnits;
      bi++;
    }

    // ground floor: a darker plinth, shopfronts and columns
    g.fillStyle = "#e2cfae";
    g.fillRect(left, base - 26, right - left, 26);
    const SHOP = [3.0, 3.8, 2.4, 3.2, 2.6];
    let sx2 = 1;
    let si = 0;
    while (sx2 < 46) {
      const wUnits = SHOP[si % SHOP.length];
      const wx = Math.round(X(sx2));
      const wpx = Math.round(wUnits * U) - 4;
      const lit = si % 3 === 0;
      if (wpx > 6) {
        g.fillStyle = lit ? "#6c5a3f" : "#3f5561";
        g.fillRect(wx, base - 22, wpx, 16);
        g.fillStyle = lit ? "#f2d79a" : "#e9c887";
        g.fillRect(wx + 1, base - 21, wpx - 2, 2);
        g.fillStyle = lit ? "rgba(255,225,160,0.35)" : "rgba(255,255,255,0.10)";
        g.fillRect(wx + 1, base - 19, lit ? wpx - 2 : Math.max(3, (wpx / 3) | 0), 13);
      }
      sx2 += wUnits;
      si++;
    }
    g.fillStyle = "#c9b494";
    for (let x = 0; x < 48; x += 6.4) g.fillRect(Math.round(X(x)), base - 26, 2, 26);
    g.fillStyle = "#b9a385";
    g.fillRect(left, base - 4, right - left, 4);

    // shadow cast by the eave across the upper wall
    g.fillStyle = "rgba(40,30,20,0.10)";
    g.fillRect(left, top, right - left, 5);

    // the building's own shadow falling onto the pavement
    for (let i = 0; i < 6; i++) {
      g.fillStyle = `rgba(40,32,22,${0.10 - i * 0.015})`;
      g.fillRect(left, base + i, right - left, 1);
    }

    // doors, lit from inside
    for (const [dx] of DOORS) {
      const wx = Math.round(X(dx) - 6);
      g.fillStyle = PAL.door;
      g.fillRect(wx, base - 16, 12, 16);
      g.fillStyle = "#e8c27a";
      g.fillRect(wx + 1, base - 15, 4, 14);
      g.fillStyle = "#f6dfae";
      g.fillRect(wx + 1, base - 15, 4, 2);
    }

    // roof: eave slab with a lit ridge
    g.fillStyle = PAL.roofDark;
    g.fillRect(left - 3, top - 7, right - left + 6, 8);
    g.fillStyle = PAL.roof;
    g.fillRect(left - 3, top - 6, right - left + 6, 5);
    g.fillStyle = PAL.roofLight;
    g.fillRect(left - 3, top - 6, right - left + 6, 1);

    // a shallow stone awning over the entrance, no colour slab
    const cLeft = X(12.5), cRight = X(23.5);
    g.fillStyle = "rgba(30,26,20,0.16)";
    g.fillRect(cLeft, base - 3, cRight - cLeft, 3);
    g.fillStyle = "#d9c6a4";
    g.fillRect(cLeft, base - 6, cRight - cLeft, 3);
    g.fillStyle = "#efe0c6";
    g.fillRect(cLeft, base - 6, cRight - cLeft, 1);

    // floor band and pilasters between the window rows and the shopfronts
    const bandY = Math.round(top + 29);
    g.fillStyle = "#e3cfae";
    g.fillRect(left, bandY, right - left, 11);
    g.fillStyle = "#cdb894";
    g.fillRect(left, bandY, right - left, 1);
    g.fillRect(left, bandY + 10, right - left, 1);
    for (let x = 0; x < 48; x += 6.4) {
      g.fillStyle = "#d3bd9a";
      g.fillRect(Math.round(X(x)), bandY, 1, 11);
    }

    // sign plate sits on the roof band, not floating in the grass
    const sw = textWidth("HUANGGANG PORT", 2) + 12;
    const sx = Math.round(X(20) - sw / 2);
    const sy = top - 6;
    g.fillStyle = "#22303c";
    g.fillRect(sx, sy - 9, sw, 14);
    g.fillStyle = "#31505f";
    g.fillRect(sx, sy - 9, sw, 1);
    drawText(g, "HUANGGANG PORT", sx + 6, sy - 6, "#f6f1e4", 2);
  }

  _drawPropsAndPeople() {
    const items = [];

    // static props
    const props = [
      // benches along the waiting hall
      { kind: "bench", x: 6, z: 1.2 }, { kind: "bench", x: 10, z: 1.2 },
      { kind: "bench", x: 26, z: 9.2 }, { kind: "bench", x: 30, z: 9.2 },
      { kind: "bin", x: 12.5, z: 1.0 }, { kind: "bin", x: 33, z: 9.0 },
      // lamp posts down the hall
      { kind: "lamp", x: 8, z: 7.4 }, { kind: "lamp", x: 20, z: 7.4 },
      { kind: "lamp", x: 32, z: 7.4 }, { kind: "lamp", x: 20, z: 15.4 },
      { kind: "lamp", x: 32, z: 15.4 }, { kind: "lamp", x: 20, z: 23.4 },
      // lane signs
      { kind: "sign", x: 11.5, z: 2.4 },
      { kind: "sign", x: 11.5, z: 10.4 },
      { kind: "sign", x: 11.5, z: 18.4 },
      // planting at the edges
      // island planting between the lanes
      { kind: "planter", x: 6, z: 8 }, { kind: "planter", x: 18, z: 8 },
      { kind: "planter", x: 30, z: 8 }, { kind: "planter", x: 42, z: 8 },
      { kind: "planter", x: 6, z: 16 }, { kind: "planter", x: 18, z: 16 },
      { kind: "planter", x: 30, z: 16 }, { kind: "planter", x: 42, z: 16 },
      { kind: "bin", x: 12, z: 8 }, { kind: "bin", x: 24, z: 16 },
      { kind: "planter", x: 3, z: -2.4 }, { kind: "planter", x: 25, z: -2.4 },
      { kind: "planter", x: 36, z: -2.4 }, { kind: "planter", x: 46, z: -2.4 },
    ];
    for (const p of props) items.push({ z: p.z, kind: p.kind, prop: p });

    for (const [, e] of this.taxis) items.push({ z: e.z, kind: "taxi", e });
    for (const [, e] of this.people) items.push({ z: e.z, kind: "person", e });

    items.sort((a, b) => a.z - b.z || a.kind.localeCompare(b.kind));

    for (const it of items) {
      if (it.kind === "taxi") this._taxi(it.e);
      else if (it.kind === "person") this._person(it.e);
      else this._prop(it.prop);
    }
  }

  _shadow(x, y, w, alpha = 0.20) {
    const g = this.g;
    g.fillStyle = `rgba(32,26,20,${alpha})`;
    g.beginPath();
    g.ellipse(Math.round(x), Math.round(y), w, Math.max(1, Math.round(w * 0.42)), 0, 0, Math.PI * 2);
    g.fill();
  }

  _taxi(e) {
    const g = this.g;
    const x = X(e.x);
    const y = Z(e.z);
    this._shadow(x, y + 1, 8);

    const spr = TAXI_SIDE[CLS[e.cls]] || TAXI_SIDE.urban;
    const shrink = e.parked ? 0.86 : 1;
    const w = Math.round(spr.width * shrink);
    const h = Math.round(spr.height * shrink);
    g.save();
    if (!e.parked && e.face < 0) {
      g.translate(Math.round(x), Math.round(y));
      g.scale(-1, 1);
      g.drawImage(spr, -Math.round(w / 2), -h, w, h);
    } else {
      g.drawImage(spr, Math.round(x - w / 2), Math.round(y - h), w, h);
    }
    g.restore();

    // roof sign — the only bright mark at this zoom
    if (!e.parked) {
      g.fillStyle = "#fbf7ec";
      g.fillRect(Math.round(x - 3), Math.round(y - h - 3), 6, 2);
      g.fillStyle = LIVERY[CLS[e.cls]];
      g.fillRect(Math.round(x - 2), Math.round(y - h - 3), 4, 1);
    }
  }

  _person(e) {
    const g = this.g;
    const x = X(e.x);
    const y = Z(e.z);
    // one in four wears the lane colour; the rest are just people
    const wearLane = (e.seed % 7) === 0;
    const frames = wearLane
      ? (SPR.person[CLS[e.cls]] || SPR.person.urban)
      : SPR.crowd[e.seed % SPR.crowd.length];
    const moving = e.moving || (e.leaving && e.wait <= 0);
    const f = moving ? 1 + (Math.floor(this.time * 7 + (e.seed || 0)) % 2) : 0;
    const spr = frames[Math.min(f, frames.length - 1)];

    this._shadow(x, y + 1, 3, 0.11);
    g.save();
    if (e.fade != null) g.globalAlpha = Math.max(0, e.fade);
    else if (e.layer) g.globalAlpha = Math.max(0.55, 1 - e.layer * 0.14);
    if (e.face < 0) {
      g.translate(Math.round(x), Math.round(y));
      g.scale(-1, 1);
      g.drawImage(spr, -2, -spr.height);
    } else {
      g.drawImage(spr, Math.round(x - 2), Math.round(y - spr.height));
    }
    g.restore();
    g.globalAlpha = 1;
  }

  _prop(p) {
    const g = this.g;
    const x = X(p.x);
    const y = Z(p.z);
    if (p.kind === "planter") {
      this._shadow(x, y + 1, 8);
      g.fillStyle = "#b9ae99";
      g.fillRect(Math.round(x - 8), Math.round(y - 6), 16, 7);
      g.fillStyle = "#cfc4ae";
      g.fillRect(Math.round(x - 8), Math.round(y - 6), 16, 1);
      g.fillStyle = PAL.leafDark;
      g.fillRect(Math.round(x - 7), Math.round(y - 7), 14, 3);
      g.fillStyle = PAL.leaf;
      g.fillRect(Math.round(x - 6), Math.round(y - 11), 12, 5);
      g.fillStyle = PAL.leafLight;
      g.fillRect(Math.round(x - 5), Math.round(y - 11), 5, 2);
      return;
    }
    let spr = SPR[p.kind];
    if (!spr) return;
    if (p.kind === "lamp") {
      g.fillStyle = "#8f8778";
      g.fillRect(Math.round(x - 2), Math.round(y - 2), 5, 3);
      const lit = this.hour > 17.2 || this.hour < 8.4;
      if (lit) {
        const ly = Math.round(y - spr.height + 1);
        for (let r = 9; r > 0; r -= 3) {
          g.fillStyle = `rgba(255,214,140,${0.10 + (9 - r) * 0.02})`;
          g.beginPath();
          g.ellipse(x, ly, r, r * 0.8, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.fillStyle = "#ffe9b0";
        g.fillRect(Math.round(x - 1), ly - 1, 3, 3);
      }
    }
    this._shadow(x, y + 1, p.kind === "tree" ? 7 : 4);
    g.drawImage(spr, Math.round(x - spr.width / 2), Math.round(y - spr.height));

  }

  _drawWeather() {
    const g = this.g;
    if (this.quality === "low") return;

    // slow cloud shadows drifting across the rank
    g.save();
    g.beginPath();
    g.rect(0, Z(-3), W, Z(31) - Z(-3));
    g.clip();
    g.globalAlpha = 0.035;
    g.fillStyle = "#26313a";
    for (let i = 0; i < 3; i++) {
      const cx = ((this.time * 6 + i * 260) % (W + 300)) - 150;
      const cy = Z(-1) + i * 90;
      g.beginPath();
      g.ellipse(cx, cy, 130, 46, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();

    // hour tint: warm early, neutral at midday, deep blue at close
    const t = Math.min(1, Math.max(0, (this.hour - 8) / 12));
    if (t < 0.45) {
      g.globalAlpha = 0.16 * (1 - t / 0.45);
      g.fillStyle = "#ffa45c";
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    } else if (t > 0.5) {
      const k = (t - 0.5) / 0.5;
      g.globalAlpha = 0.30 * k;
      g.fillStyle = "#27406e";
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 0.16 * k;
      g.fillStyle = "#0f1c33";
      g.fillRect(0, 0, W, H);
      g.globalAlpha = 1;
    }
  }

  _drawFrame() {
    const g = this.g;
    // 1px vignette so the edges settle into the page
    g.fillStyle = "rgba(24,20,16,0.10)";
    g.fillRect(0, 0, W, 1);
    g.fillRect(0, H - 1, W, 1);
    g.fillRect(0, 0, 1, H);
    g.fillRect(W - 1, 0, 1, H);
  }
}
