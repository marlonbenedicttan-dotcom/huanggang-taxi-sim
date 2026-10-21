/**
 * Crossy-Road-style scene.
 *
 * Deliberately primitive: every object is a box, a cylinder or a cone, with
 * flat colours, one soft light and an orthographic isometric camera. That is
 * the whole art direction — and it means no textures, no glTF and far fewer
 * things that can break.
 *
 * Data interface (unchanged):
 *   setScene(meta) · sync(frame) · tick(dt, hour) · render(dt) · resize()
 *   attachLabels(host) · setQuality(q) · setDprScale(s)
 */

import * as THREE from "../vendor/three.module.js";
import {
  CLS, CLS_COLOR, CLS_SHORT, LANE_TITLE, LANES, EXIT_X, TERMINAL,
  bufferPos, standPos, bayPos, queuePos, doorPos, baySlots,
} from "./layout.js";

const TAXI_CAP = 80;
const PAX_CAP = 90;

/* Crossy-Road palette: saturated, high contrast, no gradients. */
const C = {
  grass: 0x8ed36a,
  grassAlt: 0x84cc60,
  road: 0x66707c,
  roadAlt: 0x5f6974,
  pave: 0xd9d3c4,
  paveAlt: 0xd2ccbc,
  kerb: 0xf3efe4,
  white: 0xf7f7f2,
  glass: 0x2f3b4b,
  dark: 0x232a33,
  trunk: 0x7a5235,
  leaf: 0x3fa45a,
  leafAlt: 0x4fb96a,
  roofA: 0xe0533f,
  roofB: 0x3f7cbf,
  roofC: 0xd9a441,
  wall: 0xf1ece1,
};

/* ------------------------------------------------------------------ */
export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = "high";
    this.maxDpr = 1.75;
    this.dprScale = 1;
    this.portrait = false;
    this.assets = null;          // kit models are no longer used
    this.taxis = new Map();
    this.people = new Map();
    this.time = 0;
    this.labels = null;
    this.metaFrame = null;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xbfe3f5);

    // orthographic isometric camera — the Crossy Road look
    this.camera = new THREE.OrthographicCamera(-40, 40, 30, -30, -200, 400);
    this.target = new THREE.Vector3(25, 0, 7);
    this.viewOffset = { theta: Math.PI / 4, phi: 0.98, zoom: 1, size: 62 };

    this.scene.add(new THREE.AmbientLight(0xffffff, 1.55));
    const sun = new THREE.DirectionalLight(0xffffff, 1.05);
    sun.position.set(-18, 34, 16);
    this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcfe6ff, 0.35);
    fill.position.set(20, 18, -22);
    this.scene.add(fill);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this._bindControls();
    this.resize();
  }

  /* ---------------- camera controls ---------------- */
  _bindControls() {
    const pointers = new Map();
    let pinch = 0;
    let startZoom = 1;

    const dist = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY });
      if (pointers.size === 2) {
        pinch = dist();
        startZoom = this.viewOffset.zoom;
      }
    });
    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinch = 0;
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);

    this.canvas.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size >= 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        if (pinch > 0) {
          this.viewOffset.zoom = Math.min(2.6, Math.max(0.6, (startZoom * dist()) / pinch));
        }
        return;
      }
      // rotate the isometric angle in 90°-ish steps for a clean look
      this.viewOffset.theta -= (e.clientX - p.lx) * 0.006;
      this.viewOffset.phi = Math.min(1.25, Math.max(0.55, this.viewOffset.phi - (e.clientY - p.ly) * 0.004));
      p.lx = e.clientX;
      p.ly = e.clientY;
    }, { passive: true });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.viewOffset.zoom = Math.min(2.6, Math.max(0.6, this.viewOffset.zoom - e.deltaY * 0.0012));
    }, { passive: false });

    let lastTap = 0;
    this.canvas.addEventListener("pointerup", (e) => {
      if (e.pointerType !== "touch") return;
      const now = performance.now();
      if (now - lastTap < 320) this.resetCamera();
      lastTap = now;
    });
    this.canvas.addEventListener("dblclick", () => this.resetCamera());
  }

  resetCamera() {
    this.viewOffset = { theta: Math.PI / 4, phi: 0.98, zoom: 1, size: this.portrait ? 46 : 62 };
  }

  setQuality(q) {
    this.quality = q;
    this.maxDpr = q === "low" ? 1 : 1.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr * this.dprScale));
    this.resize();
  }

  setDprScale(scale) {
    this.dprScale = Math.max(0.6, Math.min(1, scale));
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr * this.dprScale));
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.portrait = h > w;
    const size = this.portrait ? 96 : 72;
    this.camera.left = -size / 2;
    this.camera.right = size / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- helpers ---------------- */
  box(w, h, d, color, opts = {}) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      new THREE.MeshLambertMaterial({ color, flatShading: true, ...opts })
    );
    return m;
  }

  /** Baked-looking contact shadow: a flat dark disc under an object. */
  shadowMesh(radius = 0.45, opacity = 0.18) {
    const m = new THREE.Mesh(
      new THREE.CircleGeometry(radius, 12),
      new THREE.MeshBasicMaterial({ color: 0x1d2a24, transparent: true, opacity, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    return m;
  }

  label(text, color = "#2f3a45", size = 0.5) {
    const font = "800 56px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 40;
    const h = 100;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.font = font;
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, w / 2, h / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    const height = size * 1.8;
    s.scale.set((height * w) / h, height, 1);
    return s;
  }

  /* ---------------- world ---------------- */
  setScene(meta) {
    this.root.clear();
    this.taxis.clear();
    this.people.clear();
    this.meta = meta;
    this.bayMeshes = [];

    this.root.add(this.plain(160, 160, C.grass, 0, -0.06, 10));

    // tarmac apron under the operational area
    this.root.add(this.plain(56, 28, C.road, 22.5, -0.02, 10.5));
    this.root.add(this.plain(56, 5.6, C.pave, 22.5, 0.0, -3.4));

    // three lanes: road strips with a coloured kerb stripe
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      this.root.add(this.plain(50, 4.9, C.roadAlt, 23, 0.01, y));
      for (const dz of [-2.5, 2.5]) {
        this.root.add(this.plain(50, 0.2, CLS_COLOR[id], 23, 0.02, y + dz));
      }
      const sign = this.label(LANE_TITLE[id], "#ffffff", 0.5);
      sign.position.set(4.5, 2.2, y - 3.1);
      this.root.add(sign);
      const shadow = this.shadowMesh(1.4, 0.1);
      shadow.position.set(4.5, 0.03, y - 3.1);
      this.root.add(shadow);
    }

    // approach road in front
    this.root.add(this.plain(64, 6, C.road, 21, 0.012, 25.4));
    for (let x = -8; x < 52; x += 4.4) {
      this.root.add(this.plain(2.2, 0.16, C.white, x, 0.022, 25.4));
    }

    this._buildBays();
    this._buildTerminal();
    this._buildTrees();
    this._buildFurniture();
    this._buildPools();

    const t = this.label("BUFFER ZONE", "#2f3a45", 0.42);
    t.position.set(7.5, 0.9, -2.6);
    this.root.add(t);
  }

  plain(w, d, color, x, y, z) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, d),
      new THREE.MeshLambertMaterial({ color })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    return m;
  }

  _buildBays() {
    for (const gid of this.meta.groups) {
      const id = ["urban", "nt", "prebook", "pool"].indexOf(gid);
      if (id < 0) continue;
      const slots = baySlots(id);
      slots.forEach(([x, z], i) => {
        const pad = this.box(1.9, 0.08, 1.0, 0xe8e3d6);
        pad.position.set(x, 0.04, z);
        this.root.add(pad);
        this.bayMeshes.push({ mesh: pad, id, idx: i, base: 0xe8e3d6 });
      });
    }
  }

  _buildTerminal() {
    const T = TERMINAL;

    // main hall: a long block with a coloured roof
    const hall = this.box(40, 5.2, 6, C.wall);
    hall.position.set(22, 2.6, T.y - 1.5);
    this.root.add(hall);

    const roof = this.box(41, 0.5, 7, C.roofA);
    roof.position.set(22, 5.45, T.y - 1.5);
    this.root.add(roof);

    // window bands
    for (const y of [1.5, 3.6]) {
      const band = this.box(38, 0.75, 0.1, C.glass);
      band.position.set(22, y, T.y + 1.55);
      this.root.add(band);
    }

    // entrance canopy
    const canopy = this.box(13, 0.3, 3.2, C.roofB);
    canopy.position.set(17.6, 3.3, T.y + 3.4);
    this.root.add(canopy);
    for (const x of [11.6, 23.6]) {
      const col = this.box(0.5, 3.3, 0.5, C.kerb);
      col.position.set(x, 1.65, T.y + 4.4);
      this.root.add(col);
    }

    // sign board above the entrance
    const board = this.box(11, 1.3, 0.25, C.white);
    board.position.set(17.6, 4.6, T.y + 1.7);
    this.root.add(board);
    const sign = this.label("HUANGGANG PORT", "#22303c", 0.62);
    sign.position.set(17.6, 4.6, T.y + 1.9);
    this.root.add(sign);

    // a second row of blocks for skyline depth
    const blocks = [
      [-6, 7, C.roofC], [4, 9, C.roofB], [14, 6, C.roofA],
      [30, 8, C.roofB], [42, 10, C.roofC], [52, 7, C.roofA],
    ];
    for (const [x, h, roofColor] of blocks) {
      const b = this.box(9, h, 8, C.wall);
      b.position.set(x, h / 2, -16);
      this.root.add(b);
      const r = this.box(9.6, 0.5, 8.6, roofColor);
      r.position.set(x, h + 0.25, -16);
      this.root.add(r);
      for (const wy of [h * 0.35, h * 0.7]) {
        const wb = this.box(8, 0.6, 0.1, C.glass);
        wb.position.set(x, wy, -11.95);
        this.root.add(wb);
      }
    }
  }

  _buildTrees() {
    const spots = [
      [-6, 4], [-6, 14], [-6, 24], [-6, 32],
      [50, 4], [50, 14], [50, 24], [50, 32],
      [-2, -10], [12, -10], [26, -10], [40, -10],
      [56, -10], [10, 34], [34, 34], [46, 34],
    ];
    for (const [x, z] of spots) {
      const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(0.16, 0.2, 1.0, 6),
        new THREE.MeshLambertMaterial({ color: C.trunk, flatShading: true })
      );
      trunk.position.set(x, 0.5, z);
      this.root.add(trunk);

      const c1 = new THREE.Mesh(
        new THREE.ConeGeometry(0.85, 1.5, 7),
        new THREE.MeshLambertMaterial({ color: C.leaf, flatShading: true })
      );
      c1.position.set(x, 1.6, z);
      this.root.add(c1);

      const c2 = new THREE.Mesh(
        new THREE.ConeGeometry(0.62, 1.1, 7),
        new THREE.MeshLambertMaterial({ color: C.leafAlt, flatShading: true })
      );
      c2.position.set(x, 2.3, z);
      this.root.add(c2);

      const sh = this.shadowMesh(0.95, 0.14);
      sh.position.set(x, 0.02, z);
      this.root.add(sh);
    }
  }

  _buildFurniture() {
    // benches, bins, lamps, railings along the terminal frontage
    for (let x = 4; x <= 44; x += 8) {
      const seat = this.box(1.7, 0.14, 0.55, 0xb98a5e);
      seat.position.set(x, 0.42, -1.4);
      this.root.add(seat);
      const back = this.box(1.7, 0.5, 0.12, 0xb98a5e);
      back.position.set(x, 0.72, -1.66);
      this.root.add(back);

      const bin = new THREE.Mesh(
        new THREE.CylinderGeometry(0.2, 0.18, 0.6, 8),
        new THREE.MeshLambertMaterial({ color: 0x3f8f5a, flatShading: true })
      );
      bin.position.set(x + 2.5, 0.3, -1.2);
      this.root.add(bin);
    }

    for (const x of [10, 22, 34]) {
      for (const z of [2.2, 12, 21]) {
        const post = this.box(0.12, 2.6, 0.12, 0x8d98a5);
        post.position.set(x, 1.3, z);
        this.root.add(post);
        const head = this.box(0.3, 0.18, 0.3, 0xfff3c4);
        head.position.set(x, 2.68, z);
        this.root.add(head);
      }
    }

    // queue railings
    const rail = [];
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      for (const dz of [-2.15, 2.15]) {
        for (let x = 12.8; x <= 24; x += 2.8) rail.push([x, y + dz]);
      }
    }
    for (const [x, z] of rail) {
      const p = this.box(0.07, 0.7, 0.07, 0x9aa6b2);
      p.position.set(x, 0.35, z);
      this.root.add(p);
    }
  }

  /* ---------------- instanced entities ---------------- */
  _pool(geo, mat, n, colored = false) {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false;
    m.count = 0;
    m.userData.entity = true;
    if (colored) {
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
      m.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    this.root.add(m);
    return m;
  }

  _buildPools() {
    const mat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

    // taxi: coloured body, white cabin, dark wheels
    this.taxiShell = this._pool(new THREE.BoxGeometry(1.0, 0.34, 0.56), mat(0xffffff), TAXI_CAP, true);
    this.taxiRoof = this._pool(new THREE.BoxGeometry(0.52, 0.3, 0.5), mat(C.white), TAXI_CAP);
    this.taxiDark = this._pool(new THREE.BoxGeometry(1.02, 0.12, 0.58), mat(C.dark), TAXI_CAP);
    this.taxiShadow = this._pool(new THREE.CircleGeometry(0.55, 12), new THREE.MeshBasicMaterial({
      color: 0x1d2a24, transparent: true, opacity: 0.18, depthWrite: false,
    }), TAXI_CAP);
    this.taxiShadow.geometry.rotateX(-Math.PI / 2);

    // person: coloured body + skin head
    this.paxMesh = [0, 1, 2].map((c) =>
      this._pool(new THREE.BoxGeometry(0.24, 0.3, 0.2), mat(CLS_COLOR[c]), PAX_CAP)
    );
    this.paxHead = this._pool(new THREE.BoxGeometry(0.18, 0.18, 0.18), mat(0xf0c39a), PAX_CAP);
    this.paxShadow = this._pool(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({
      color: 0x1d2a24, transparent: true, opacity: 0.16, depthWrite: false,
    }), PAX_CAP);
    this.paxShadow.geometry.rotateX(-Math.PI / 2);
  }

  attachLabels(host) {
    if (!host) return;
    host.innerHTML = "";
    this.labelEls = [0, 1, 2].map((c) => {
      const el = document.createElement("div");
      el.className = "zone-label";
      el.style.setProperty("--c", ["#e8503f", "#17a67c", "#2f7fd4"][c]);
      host.appendChild(el);
      return el;
    });
    const buf = document.createElement("div");
    buf.className = "zone-label buffer";
    host.appendChild(buf);
    this.labelEls.push(buf);
  }

  project(x, y, z) {
    const v = new THREE.Vector3(x, y, z).project(this.camera);
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, z: v.z };
  }

  _updateLabels() {
    if (!this.labelEls || !this.metaFrame) return;
    const f = this.metaFrame;
    let worst = 0;
    for (let c = 1; c < 3; c++) if (f.q[c] > f.q[worst]) worst = c;

    for (let c = 0; c < 3; c++) {
      const el = this.labelEls[c];
      const [wx, wz] = queuePos(c, Math.min(6, Math.max(0, f.q[c] - 1)));
      const p = this.project(wx, 1.6, wz - 2.2);
      el.classList.toggle("hidden", f.q[c] === 0 || p.z > 1);
      el.classList.toggle("worst", c === worst && f.q[c] > 6);
      el.innerHTML = `<b>${f.q[c]}</b> waiting`;
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const buf = this.labelEls[3];
    const [bx, bz] = bufferPos(0, 10);
    const pb = this.project(bx, 1.6, bz - 2);
    buf.innerHTML = `<b>${f.buf}</b> taxis`;
    buf.style.transform = `translate(${pb.x}px, ${pb.y}px) translate(-50%, -100%)`;
    buf.classList.toggle("hidden", pb.z > 1);
  }

  /* ---------------- state ---------------- */
  sync(frame) {
    this.metaFrame = frame;
    const seenT = new Set();
    const seenP = new Set();

    for (const row of frame.tx) {
      const [id, clsId, state, slot, group, bay] = row;
      seenT.add(id);
      const [x, z] = state === 2 ? bayPos(group, bay) : state === 1 ? standPos(clsId, slot) : bufferPos(clsId, slot);
      let e = this.taxis.get(id);
      if (!e) {
        e = { x: -12, z: 25.4, yaw: 0, v: 0, cls: clsId, exiting: false, wp: { x: -3, z: 22.6 } };
        this.taxis.set(id, e);
      }
      e.tx = x;
      e.tz = z;
      e.exiting = false;
    }

    for (const [id, clsId, slot] of frame.px) {
      seenP.add(id);
      const [qx, qz] = queuePos(clsId, slot);
      const jx = (((id * 37) % 13) / 13 - 0.5) * 0.18;
      const jz = (((id * 53) % 11) / 11 - 0.5) * 0.2;
      let e = this.people.get(id);
      if (!e) {
        const [dx, dz] = doorPos(clsId);
        e = { x: dx, z: dz, yaw: 0, v: 0, cls: clsId, leaving: false, fade: 0, wait: 0 };
        this.people.set(id, e);
      }
      e.tx = qx + jx;
      e.tz = qz + jz;
    }

    for (const [id, e] of this.people) {
      if (seenP.has(id)) continue;
      if (!e.leaving) {
        e.leaving = true;
        e.tx = 38.2;
        e.tz = LANES[CLS[e.cls]];
        e.wait = 0.3;
      }
    }

    for (const [id, e] of this.taxis) {
      if (seenT.has(id)) continue;
      if (e.exiting !== "exit") {
        e.exiting = "exit";
        e.tx = EXIT_X + 8;
      }
    }
  }

  /* ---------------- per-frame ---------------- */
  tick(dt, hour) {
    this.time += dt;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    let n = 0;
    for (const [id, e] of this.taxis) {
      let gx = e.tx;
      let gz = e.tz;
      if (e.wp) {
        if (Math.hypot(e.wp.x - e.x, e.wp.z - e.z) < 1.2) e.wp = null;
        else { gx = e.wp.x; gz = e.wp.z; }
      }
      const dx = gx - e.x;
      const dz = gz - e.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 25) { e.x = e.tx; e.z = e.tz; }
      else if (dist > 0.01) {
        const want = Math.min(e.exiting ? 8 : 6, Math.max(0.4, dist * 2.4));
        e.v += (want - e.v) * Math.min(1, dt * 7);
        const step = Math.min(dist, e.v * dt);
        e.x += (dx / dist) * step;
        e.z += (dz / dist) * step;
        const yaw = Math.atan2(dz, dx);
        let d = yaw - e.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        e.yaw += Math.max(-7 * dt, Math.min(7 * dt, d));
      } else e.v = 0;

      if (e.exiting === "exit" && dist < 0.4) { this.taxis.delete(id); continue; }
      if (n >= TAXI_CAP) break;

      q.setFromAxisAngle(up, e.yaw || 0);
      m.compose(new THREE.Vector3(e.x, 0.3, e.z), q, new THREE.Vector3(1, 1, 1));
      this.taxiShell.setMatrixAt(n, m);
      col.setHex(CLS_COLOR[e.cls] ?? 0xffffff);
      this.taxiShell.setColorAt(n, col);

      m.compose(new THREE.Vector3(e.x, 0.52, e.z), q, new THREE.Vector3(1, 1, 1));
      this.taxiRoof.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(e.x, 0.12, e.z), q, new THREE.Vector3(1, 1, 1));
      this.taxiDark.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(e.x, 0.03, e.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      this.taxiShadow.setMatrixAt(n, m);
      n++;
    }
    for (const mesh of [this.taxiShell, this.taxiRoof, this.taxiDark, this.taxiShadow]) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
    if (this.taxiShell.instanceColor) this.taxiShell.instanceColor.needsUpdate = true;

    /* people */
    const counts = [0, 0, 0];
    let total = 0;
    for (const [id, e] of this.people) {
      const dx = e.tx - e.x;
      const dz = e.tz - e.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 12) { e.x = e.tx; e.z = e.tz; }
      else if (dist > 0.02) {
        const want = Math.min(1.8, Math.max(0.3, dist * 2.2));
        e.v += (want - e.v) * Math.min(1, dt * 8);
        const step = Math.min(dist, e.v * dt);
        e.x += (dx / dist) * step;
        e.z += (dz / dist) * step;
        e.moving = true;
      } else { e.v = 0; e.moving = false; }

      if (e.leaving) {
        if (dist < 0.5) e.wait -= dt;
        if (e.wait <= 0) e.fade -= dt * 2.5;
        if (e.fade <= 0) { this.people.delete(id); continue; }
      } else {
        e.fade = Math.min(1, (e.fade ?? 1) + dt * 5);
      }

      const c = e.cls;
      if (counts[c] >= PAX_CAP || total >= PAX_CAP) continue;
      const bob = e.moving ? Math.abs(Math.sin(this.time * 9 + id)) * 0.04 : 0;
      const s = Math.max(0.05, Math.min(1, e.fade));
      const i = counts[c];

      m.compose(new THREE.Vector3(e.x, 0.15 + bob, e.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      this.paxMesh[c].setMatrixAt(i, m);
      m.compose(new THREE.Vector3(e.x, 0.36 + bob, e.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      this.paxHead.setMatrixAt(total, m);
      m.compose(new THREE.Vector3(e.x, 0.02, e.z), new THREE.Quaternion(), new THREE.Vector3(s, s, 1));
      this.paxShadow.setMatrixAt(total, m);

      counts[c]++;
      total++;
    }
    for (let c = 0; c < 3; c++) {
      this.paxMesh[c].count = counts[c];
      this.paxMesh[c].instanceMatrix.needsUpdate = true;
    }
    this.paxHead.count = total;
    this.paxHead.instanceMatrix.needsUpdate = true;
    this.paxShadow.count = total;
    this.paxShadow.instanceMatrix.needsUpdate = true;

    /* bay glow: occupied bays lift slightly */
    const occupied = new Set();
    for (const row of this.metaFrame?.tx || []) if (row[2] === 2) occupied.add(`${row[4]}:${row[5]}`);
    for (const b of this.bayMeshes) {
      b.mesh.material.color.setHex(occupied.has(`${b.id}:${b.idx}`) ? 0xfff0c2 : b.base);
    }
  }

  render(dt) {
    const { theta, phi, zoom } = this.viewOffset;
    const r = 70;
    this.camera.position.set(
      this.target.x + r * Math.sin(phi) * Math.cos(theta),
      this.target.y + r * Math.cos(phi),
      this.target.z + r * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(this.target);
    this.camera.zoom = zoom;
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
  }
}
