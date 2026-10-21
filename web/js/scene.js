/**
 * 3D view of the taxi hall.
 *
 * Depends only on three.js (vendored locally — no CDN, no build step).
 *
 * Performance notes, because this has to run on a phone:
 *   - every taxi is drawn with two InstancedMeshes (body + details), so 60
 *     taxis cost 2 draw calls, not 120;
 *   - passengers are one InstancedMesh per class;
 *   - the terminal is a single merged geometry;
 *   - `setQuality("low")` drops the pixel ratio and the fog.
 *
 * Motion: the simulation records snapshots (default one per 15 simulated
 * seconds).  Each entity keeps its own position and moves towards its new
 * target at a fixed speed, which gives walking passengers, shuffling queues
 * and taxis that actually drive — without any per-frame animation data.
 */

import * as THREE from "../vendor/three.module.js";
import {
  CLS, CLS_COLOR, LANES, EXIT_X, PERSON, TERMINAL, MAX_QUEUE_SHOWN,
  doorPos, bufferPos, standPos, bayPos, queuePos,
  bufferSlots, standSlots, baySlots,
} from "./layout.js";

const TAXI_CAP = 72;
const PAX_CAP = 64;

/* ------------------------------------------------------------------ *
 * geometry helpers
 * ------------------------------------------------------------------ */
function merge(parts) {
  const geos = parts.map((p) => {
    const g = p.geo.clone();
    g.applyMatrix4(
      new THREE.Matrix4().compose(
        new THREE.Vector3(p.x || 0, p.y || 0, p.z || 0),
        new THREE.Quaternion().setFromEuler(new THREE.Euler(p.rx || 0, p.ry || 0, p.rz || 0)),
        new THREE.Vector3(1, 1, 1)
      )
    );
    return g.index ? g.toNonIndexed() : g;
  });
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, off * 3);
    nor.set(g.attributes.normal.array, off * 3);
    off += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
  return out;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);

/** Coloured shell: body, cabin, roof sign, headlights. */
function taxiBodyGeo() {
  return merge([
    { geo: box(0.94, 0.17, 0.42), y: 0.17 },
    { geo: box(0.48, 0.15, 0.36), y: 0.31, x: -0.03 },
    { geo: box(0.15, 0.055, 0.17), y: 0.41, x: -0.03 },          // roof sign
    { geo: box(0.03, 0.05, 0.09), y: 0.19, x: 0.47 },             // headlights
  ]);
}

/** Dark parts: four wheels and a windscreen band. */
function taxiDetailGeo() {
  const wheel = new THREE.CylinderGeometry(0.075, 0.075, 0.055, 8);
  return merge([
    { geo: wheel, x: 0.28, y: 0.08, z: 0.2, rx: Math.PI / 2 },
    { geo: wheel, x: 0.28, y: 0.08, z: -0.2, rx: Math.PI / 2 },
    { geo: wheel, x: -0.28, y: 0.08, z: 0.2, rx: Math.PI / 2 },
    { geo: wheel, x: -0.28, y: 0.08, z: -0.2, rx: Math.PI / 2 },
    { geo: box(0.3, 0.09, 0.37), y: 0.31, x: 0.12 },              // windscreen
  ]);
}

function personGeo() {
  const body = new THREE.CapsuleGeometry(0.095, 0.1, 4, 8);
  const head = new THREE.SphereGeometry(0.07, 7, 5);
  return merge([
    { geo: body, y: 0.17 },
    { geo: head, y: 0.32 },
    { geo: box(0.06, 0.08, 0.035), x: 0.11, y: 0.09 },            // suitcase
  ]);
}

/* ------------------------------------------------------------------ *
 * Scene
 * ------------------------------------------------------------------ */
export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = "high";
    this.maxDpr = 1.75;
    this.portrait = false;

    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: window.devicePixelRatio < 2,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 95, 170);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.target = new THREE.Vector3(21.5, 1.4, 10);
    this.orbit = { theta: Math.PI / 2 + 0.18, phi: 0.98, radius: 58 };
    this.autoRotate = false;

    // lights
    this.hemi = new THREE.HemisphereLight(0xdfe9ff, 0x141b26, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.3);
    this.sun.position.set(18, 42, 24);
    this.scene.add(this.sun);
    this.rim = new THREE.DirectionalLight(0x88aaff, 0.35);
    this.rim.position.set(-24, 14, -18);
    this.scene.add(this.rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    // shared geometries / materials
    this.geo = {
      taxiBody: taxiBodyGeo(),
      taxiDetail: taxiDetailGeo(),
      person: personGeo(),
      ground: new THREE.PlaneGeometry(70, 40),
      shadow: new THREE.CircleGeometry(0.42, 12),
    };
    this.mat = {
      taxiBody: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.42, metalness: 0.18 }),
      taxiDetail: new THREE.MeshStandardMaterial({ color: 0x1a1e26, roughness: 0.65 }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }),
      person: CLS_COLOR.map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, emissive: new THREE.Color(c), emissiveIntensity: 0.12 })
      ),
    };

    this.taxis = new Map();     // id -> {x, z, tx, tz, cls, exiting, fade}
    this.people = new Map();    // id -> {x, z, tx, tz, cls, entered, leaving, fade}
    this.bayMeshes = [];
    this.time = 0;
    this.hour = 9;

    this._bindControls();
    this.resize();
  }

  /* ---------------- pools ---------------- */
  _buildPools() {
    const mk = (geo, mat, n, colored) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false;
      m.count = 0;
      if (colored) {
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
      }
      this.root.add(m);
      return m;
    };
    this.taxiBody = mk(this.geo.taxiBody, this.mat.taxiBody, TAXI_CAP, true);
    this.taxiDetail = mk(this.geo.taxiDetail, this.mat.taxiDetail, TAXI_CAP, false);
    this.taxiShadow = mk(this.geo.shadow, this.mat.shadow, TAXI_CAP, false);
    this.paxMesh = [0, 1, 2].map((c) => mk(this.geo.person, this.mat.person[c], PAX_CAP, false));
  }

  /* ---------------- camera ---------------- */
  _bindControls() {
    const pointers = new Map();
    let pinchStart = 0;
    let radiusStart = 0;
    const distance = () => {
      const [a, b] = [...pointers.values()];
      return Math.hypot(a.x - b.x, a.y - b.y);
    };

    this.canvas.addEventListener("pointerdown", (e) => {
      this.autoRotate = false;
      this.canvas.setPointerCapture(e.pointerId);
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY });
      if (pointers.size === 2) {
        pinchStart = distance();
        radiusStart = this.orbit.radius;
      }
    });

    const release = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = 0;
    };
    this.canvas.addEventListener("pointerup", release);
    this.canvas.addEventListener("pointercancel", release);

    this.canvas.addEventListener("pointermove", (e) => {
      const p = pointers.get(e.pointerId);
      if (!p) return;
      if (pointers.size >= 2) {
        p.x = e.clientX;
        p.y = e.clientY;
        if (pinchStart > 0) {
          const scale = pinchStart / Math.max(24, distance());
          this.orbit.radius = Math.min(140, Math.max(22, radiusStart * scale));
        }
        return;
      }
      this.orbit.theta -= (e.clientX - p.lx) * 0.007;
      this.orbit.phi = Math.min(1.36, Math.max(0.2, this.orbit.phi - (e.clientY - p.ly) * 0.006));
      p.lx = e.clientX;
      p.ly = e.clientY;
    }, { passive: true });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.orbit.radius = Math.min(140, Math.max(22, this.orbit.radius + e.deltaY * 0.05));
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
    this.orbit = { theta: Math.PI / 2 + 0.18, phi: 0.98, radius: 58 };
    this.autoRotate = false;
  }

  setQuality(q) {
    this.quality = q;
    this.maxDpr = q === "low" ? 1 : 1.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.scene.fog = q === "low" ? null : new THREE.Fog(0x0b1018, 95, 170);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    const portrait = h > w;
    this.portrait = portrait;
    this.camera.fov = portrait ? 52 : 40;
    this.camera.aspect = w / h;
    if (portrait) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.13), w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- static world ---------------- */
  label(text, color = "#c8d4e6", size = 0.62) {
    const font = "600 56px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 48;
    const h = 112;
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
    tex.anisotropy = 4;
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    // keep the text undistorted: height = size, width follows the canvas aspect
    const height = size * 1.9;
    s.scale.set((height * w) / h, height, 1);
    return s;
  }

  setScene(meta) {
    this.root.clear();
    this.taxis.clear();
    this.people.clear();
    this.bayMeshes = [];
    this.meta = meta;

    // ---- tarmac ----
    const ground = new THREE.Mesh(this.geo.ground, new THREE.MeshStandardMaterial({ color: 0x222c3b, roughness: 1 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(23, -0.02, 10);
    this.root.add(ground);

    const grid = new THREE.GridHelper(80, 40, 0x33465f, 0x232f42);
    grid.position.set(23, 0, 10);
    this.root.add(grid);

    // ---- lane bands + labels ----
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 5.4),
        new THREE.MeshBasicMaterial({ color: CLS_COLOR[id], transparent: true, opacity: 0.06, depthWrite: false })
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(23, 0.005, y);
      this.root.add(band);

      const tag = this.label(CLS[id].toUpperCase(), "#8fa6c2", 0.5);
      tag.position.set(2.2, 1.1, y - 1.9);
      this.root.add(tag);
    }

    // ---- painted bays ----
    const pts = [];
    const rect = (x, y, w, h) => {
      pts.push(
        new THREE.Vector3(x - w, 0, y - h), new THREE.Vector3(x + w, 0, y - h),
        new THREE.Vector3(x + w, 0, y - h), new THREE.Vector3(x + w, 0, y + h),
        new THREE.Vector3(x + w, 0, y + h), new THREE.Vector3(x - w, 0, y + h),
        new THREE.Vector3(x - w, 0, y + h), new THREE.Vector3(x - w, 0, y - h)
      );
    };
    for (const id of [0, 1, 2]) {
      for (const [x, y] of bufferSlots(id)) rect(x, y, 0.44, 0.28);
      for (const [x, y] of standSlots(id)) rect(x, y, 0.4, 0.26);
    }
    this.root.add(
      new THREE.LineSegments(
        new THREE.BufferGeometry().setFromPoints(pts),
        new THREE.LineBasicMaterial({ color: 0x33445f, transparent: true, opacity: 0.85 })
      )
    );

    // ---- pickup bays ----
    for (const gid of meta.groups) {
      const id = ["urban", "nt", "prebook", "pool"].indexOf(gid);
      if (id < 0) continue;
      const slots = baySlots(id);
      for (let idx = 0; idx < slots.length; idx++) {
        const [x, y] = slots[idx];
        const mat = new THREE.MeshStandardMaterial({
          color: 0x233149,
          emissive: new THREE.Color(CLS_COLOR[id]),
          emissiveIntensity: 0.05,
          roughness: 0.8,
        });
        const m = new THREE.Mesh(box(1.9, 0.12, 1.0), mat);
        m.position.set(x, 0.06, y);
        this.root.add(m);
        this.bayMeshes.push({ mesh: m, id, idx });
      }
    }

    // ---- terminal building ----
    this._buildTerminal();

    // instanced pools last: root.clear() above removed the previous ones
    this._buildPools();

    // ---- labels ----
    const t1 = this.label("BUFFER ZONE", "#8fa6c2", 0.5);
    t1.position.set(7, 1.2, -2.2);
    this.root.add(t1);
    const t2 = this.label("QUEUES", "#8fa6c2", 0.5);
    t2.position.set(18.5, 1.2, -2.2);
    this.root.add(t2);
    const t3 = this.label("PICKUP BAYS", "#8fa6c2", 0.5);
    t3.position.set(40, 1.2, -1.4);
    this.root.add(t3);
  }

  _buildTerminal() {
    const T = TERMINAL;
    const concrete = new THREE.MeshStandardMaterial({ color: 0x2b3545, roughness: 0.85 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0x2c3f57,
      emissive: new THREE.Color(0xffd9a0),
      emissiveIntensity: 0.35,
      roughness: 0.3,
      metalness: 0.1,
    });
    this.windowMat = glass;

    // walls between the three doors
    const doors = [[13.2, 15.0], [16.7, 18.5], [20.2, 22.0]];
    const segs = [];
    let x = T.x0;
    for (const [a, b] of doors) {
      if (a > x) segs.push([x, a]);
      x = b;
    }
    if (x < T.x1) segs.push([x, T.x1]);

    const parts = [];
    for (const [a, b] of segs) {
      parts.push({ geo: box(b - a, T.height, T.depth), x: (a + b) / 2, y: T.height / 2, z: T.y });
    }
    // lintels above the doors
    for (const [a, b] of doors) {
      parts.push({ geo: box(b - a, T.height - 2.7, T.depth), x: (a + b) / 2, y: (T.height + 2.7) / 2, z: T.y });
    }
    const wall = new THREE.Mesh(merge(parts), concrete);
    wall.position.z = 0;
    this.root.add(wall);

    // lit door openings
    for (let i = 0; i < doors.length; i++) {
      const [a, b] = doors[i];
      const d = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 2.7), glass);
      d.position.set((a + b) / 2, 1.35, T.y + T.depth / 2 + 0.02);
      this.root.add(d);
    }

    // window strip
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(T.x1 - T.x0 - 2, 0.55), glass);
    strip.position.set((T.x0 + T.x1) / 2, 3.45, T.y + T.depth / 2 + 0.02);
    this.root.add(strip);

    // signage + roof lip
    const sign = this.label("HUANGGANG PORT  ·  皇岗口岸", "#dbe7f7", 0.78);
    sign.position.set(17.6, 5.0, T.y + T.depth / 2 + 0.2);
    this.root.add(sign);

    const roof = new THREE.Mesh(box(T.x1 - T.x0, 0.28, T.depth + 1.2), new THREE.MeshStandardMaterial({ color: 0x151c27, roughness: 0.9 }));
    roof.position.set((T.x0 + T.x1) / 2, T.height + 0.14, T.y);
    this.root.add(roof);

    const taxiSign = this.label("TAXI  的士", "#ffd9a0", 0.7);
    taxiSign.position.set(40, 2.2, -1.0);
    this.root.add(taxiSign);

    // light poles
    const poleMat = new THREE.MeshStandardMaterial({ color: 0x3a4a63, roughness: 0.6 });
    for (const x of [12, 24, 36]) {
      for (const y of [2.2, 10.2, 18.2]) {
        const pole = new THREE.Mesh(box(0.08, 2.2, 0.08), poleMat);
        pole.position.set(x, 1.1, y);
        this.root.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.1, 6, 4),
          new THREE.MeshStandardMaterial({ color: 0xfff2cc, emissive: 0xffe6b0, emissiveIntensity: 0.9 })
        );
        lamp.position.set(x, 2.25, y);
        this.root.add(lamp);
      }
    }
  }

  /* ---------------- per-frame state ---------------- */
  sync(frame) {
    this.metaFrame = frame;
    const seenT = new Set();
    const seenP = new Set();

    for (const row of frame.tx) {
      const [id, clsId, state, slot, group, bay] = row;
      seenT.add(id);
      let [x, y] = state === 2 ? bayPos(group, bay) : state === 1 ? standPos(clsId, slot) : bufferPos(clsId, slot);
      let e = this.taxis.get(id);
      if (!e) {
        e = { x: -4, z: y, tx: x, tz: y, cls: clsId, exiting: false };
        this.taxis.set(id, e);
      }
      e.tx = x;
      e.tz = y;
      e.exiting = false;
    }

    for (const [id, clsId, slot] of frame.px) {
      seenP.add(id);
      const [qx, qy] = queuePos(clsId, slot);
      // deterministic jitter so the queue looks like people, not a grid
      const jx = (((id * 37) % 17) / 17 - 0.5) * 0.26;
      const jz = (((id * 53) % 19) / 19 - 0.5) * 0.3;
      let e = this.people.get(id);
      if (!e) {
        const [dx, dy] = doorPos(clsId);
        e = { x: dx, z: dy, tx: qx, tz: qy, cls: clsId, leaving: false, fade: 1 };
        this.people.set(id, e);
      }
      e.tx = qx + jx;
      e.tz = qy + jz;
    }

    // passengers that left the queue are boarding: walk to the bay and fade
    for (const [id, e] of this.people) {
      if (seenP.has(id)) continue;
      if (!e.leaving) {
        e.leaving = true;
        e.tx = 38.6;
        e.tz = LANES[CLS[e.cls]];
      }
    }

    // taxis that vanished have driven off
    for (const [id, e] of this.taxis) {
      if (seenT.has(id)) continue;
      if (e.exiting !== "exit") {
        e.exiting = "exit";
        e.tx = EXIT_X + 8;
      }
    }
  }

  /* ---------------- motion + draw ---------------- */
  tick(dt, hour) {
    this.time += dt;
    if (hour != null) this.setHour(hour);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    // ---- taxis ----
    let n = 0;
    for (const [id, e] of this.taxis) {
      const speed = e.exiting ? 7.5 : 6.0;
      const dx = e.tx - e.x;
      const dz = e.tz - e.z;
      const dist = Math.hypot(dx, dz);
      if (dist > 9) {                     // scrubbed: snap, don't crawl
        e.x = e.tx;
        e.z = e.tz;
      } else if (dist > 0.001) {
        const step = Math.min(dist, speed * dt);
        e.x += (dx / dist) * step;
        e.z += (dz / dist) * step;
        if (dist > 0.15) e.yaw = Math.atan2(dz, dx);
      }
      if (e.exiting === "exit" && dist < 0.3) {
        this.taxis.delete(id);
        continue;
      }
      if (n >= TAXI_CAP) break;

      q.setFromAxisAngle(up, e.yaw || 0);
      m.compose(new THREE.Vector3(e.x, 0.02, e.z), q, new THREE.Vector3(1, 1, 1));
      this.taxiBody.setMatrixAt(n, m);
      this.taxiDetail.setMatrixAt(n, m);
      col.setHex(CLS_COLOR[e.cls] || 0xffffff);
      this.taxiBody.setColorAt(n, col);
      m.compose(new THREE.Vector3(e.x, 0.012, e.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      this.taxiShadow.setMatrixAt(n, m);
      n++;
      e.drawn = true;
    }
    this.taxiBody.count = n;
    this.taxiDetail.count = n;
    this.taxiShadow.count = n;
    this.taxiBody.instanceMatrix.needsUpdate = true;
    this.taxiDetail.instanceMatrix.needsUpdate = true;
    this.taxiShadow.instanceMatrix.needsUpdate = true;
    if (this.taxiBody.instanceColor) this.taxiBody.instanceColor.needsUpdate = true;

    // ---- passengers ----
    const counts = [0, 0, 0];
    for (const [id, e] of this.people) {
      const dx = e.tx - e.x;
      const dz = e.tz - e.z;
      const dist = Math.hypot(dx, dz);
      const speed = 1.9;
      if (dist > 4.5) {                   // scrubbed / timelapse: catch up
        e.x = e.tx;
        e.z = e.tz;
        e.moving = false;
      } else if (dist > 0.02) {
        const step = Math.min(dist, speed * dt);
        e.x += (dx / dist) * step;
        e.z += (dz / dist) * step;
        e.moving = true;
      } else {
        e.moving = false;
      }
      if (e.leaving) {
        e.fade -= dt * 1.6;
        if (dist < 0.5 || e.fade <= 0) {
          this.people.delete(id);
          continue;
        }
      }
      const c = e.cls;
      const i = counts[c];
      if (i >= PAX_CAP) continue;
      const bob = e.moving ? Math.abs(Math.sin(this.time * 7 + id)) * 0.035 : 0;
      const variety = 0.92 + (((id * 13) % 7) / 7) * 0.22;
      const scale = Math.max(0.05, Math.min(1, e.fade)) * 1.3 * variety;
      q.setFromAxisAngle(up, Math.atan2(dz, dx) + Math.PI / 2);
      m.compose(
        new THREE.Vector3(e.x, 0.01 + bob, e.z),
        q,
        new THREE.Vector3(scale, scale, scale)
      );
      this.paxMesh[c].setMatrixAt(i, m);
      counts[c]++;
    }
    for (let c = 0; c < 3; c++) {
      this.paxMesh[c].count = counts[c];
      this.paxMesh[c].instanceMatrix.needsUpdate = true;
    }

    // ---- bay glow ----
    const occupied = new Set();
    for (const row of this.metaFrame?.tx || []) if (row[2] === 2) occupied.add(`${row[4]}:${row[5]}`);
    for (const b of this.bayMeshes) {
      b.mesh.material.emissiveIntensity = occupied.has(`${b.id}:${b.idx}`) ? 0.85 : 0.05;
    }
  }

  /** Time-of-day lighting: warm mornings, flat midday, golden evening. */
  setHour(h) {
    if (Math.abs(h - this.hour) < 0.15) return;
    this.hour = h;

    const t = Math.min(1, Math.max(0, (h - 8) / 12));          // 0 at 08:00, 1 at 20:00
    // daylight: bright by mid-morning, peaks at midday, dims after 18:00
    const day = Math.min(1, 0.58 + 0.72 * Math.sin(Math.PI * t));
    const dusk = t > 0.72 ? (t - 0.72) / 0.28 : 0;               // 0 -> 1 into the evening

    this.sun.intensity = 0.25 + 1.15 * day;
    this.sun.color.setHSL(0.09, 0.55 * (1 - day) + 0.05, 0.62 + 0.12 * day);
    this.hemi.intensity = 0.55 + 0.55 * day;
    this.rim.intensity = 0.25 + 0.25 * day;

    const bg = new THREE.Color(0x0b1018).lerp(new THREE.Color(0x1d2b44), day * 0.55);
    bg.lerp(new THREE.Color(0x05070c), dusk * 0.7);
    this.scene.background = bg;
    if (this.scene.fog) this.scene.fog.color = bg.clone();

    if (this.windowMat) {
      this.windowMat.emissiveIntensity = 0.25 + 0.75 * dusk;
    }
  }

  render(dt) {
    if (this.autoRotate) this.orbit.theta += (dt || 0.016) * 0.03;
    const { theta, phi } = this.orbit;
    const radius = this.orbit.radius * (this.portrait ? 1.33 : 1);
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.cos(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
  }
}
