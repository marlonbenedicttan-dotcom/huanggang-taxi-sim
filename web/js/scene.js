/**
 * 3D view of the taxi hall.
 *
 * Deliberately dependency-free apart from three.js itself: the camera controls,
 * the taxi lerp between recorded frames and the bay highlighting are all here,
 * so there is no CDN, no build step and no framework.
 *
 * The simulation records discrete snapshots (default: one every 15 simulated
 * seconds).  This class turns them into smooth motion by giving every taxi a
 * persistent mesh and interpolating towards its target slot, which looks far
 * better than teleporting between frames.
 */

import * as THREE from "../vendor/three.module.js";
import {
  CLS, CLS_COLOR, LANES, EXIT_X, MAX_QUEUE_SHOWN, TAXI,
  bufferPos, standPos, bayPos, queuePos,
  bufferSlots, standSlots, baySlots,
} from "./layout.js";

const TAXI_GEO = new THREE.BoxGeometry(TAXI.length, TAXI.height, TAXI.width);
const PAX_GEO = new THREE.SphereGeometry(0.17, 7, 5);

export class Scene3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b1018);
    this.scene.fog = new THREE.Fog(0x0b1018, 95, 165);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    // camera sits south of the hall, slightly off-axis, looking north-east
    this.target = new THREE.Vector3(23, 0, 9);
    this.orbit = { theta: Math.PI / 2 + 0.18, phi: 0.98, radius: 58 };

    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x0b1018, 1.15));
    const sun = new THREE.DirectionalLight(0xffffff, 1.35);
    sun.position.set(18, 42, 22);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.45);
    rim.position.set(-20, 16, -16);
    this.scene.add(rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.taxiMats = CLS_COLOR.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.45, metalness: 0.15 })
    );
    this.taxis = new Map();
    this.bayMeshes = [];
    this.passengerMeshes = [];
    this.time = 0;

    this._bindControls();
    this.resize();
  }

  /* ------------------------------------------------------------------ */
  /* camera                                                              */
  /* ------------------------------------------------------------------ */
  _bindControls() {
    let dragging = false;
    let lx = 0;
    let ly = 0;
    this.autoRotate = true;

    this.canvas.addEventListener("pointerdown", (e) => {
      dragging = true;
      lx = e.clientX;
      ly = e.clientY;
      this.autoRotate = false;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointerup", () => (dragging = false));
    this.canvas.addEventListener("pointercancel", () => (dragging = false));
    this.canvas.addEventListener("pointermove", (e) => {
      if (!dragging) return;
      this.orbit.theta -= (e.clientX - lx) * 0.006;
      this.orbit.phi = Math.min(1.35, Math.max(0.18, this.orbit.phi - (e.clientY - ly) * 0.005));
      lx = e.clientX;
      ly = e.clientY;
    });
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.orbit.radius = Math.min(130, Math.max(26, this.orbit.radius + e.deltaY * 0.05));
      },
      { passive: false }
    );
  }

  _updateCamera(dt) {
    if (this.autoRotate) this.orbit.theta += dt * 0.035;
    const { theta, phi, radius } = this.orbit;
    const t = this.target;
    this.camera.position.set(
      t.x + radius * Math.sin(phi) * Math.cos(theta),
      t.y + radius * Math.cos(phi),
      t.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(t);
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /* ------------------------------------------------------------------ */
  /* static geometry                                                     */
  /* ------------------------------------------------------------------ */
  label(text, color = "#c8d4e6", size = 0.9) {
    const c = document.createElement("canvas");
    c.width = 512;
    c.height = 128;
    const g = c.getContext("2d");
    g.fillStyle = "rgba(0,0,0,0)";
    g.fillRect(0, 0, c.width, c.height);
    g.font = "600 64px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    g.fillStyle = color;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.fillText(text, 256, 68);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
    const s = new THREE.Sprite(mat);
    s.scale.set(size * 8, size * 2, 1);
    return s;
  }

  /** Painted rectangles on the tarmac (buffer bays / holding lane). */
  paintedLine(points) {
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    return new THREE.LineSegments(
      geo,
      new THREE.LineBasicMaterial({ color: 0x2c3a52, transparent: true, opacity: 0.9 })
    );
  }

  setScene(meta) {
    this.root.clear();
    this.taxis.clear();
    this.bayMeshes = [];
    this.passengerMeshes = [];

    const lanes = ["urban", "nt", "prebook"];
    if (meta.pooled) lanes.push("pool");
    this.visibleLanes = lanes;

    // ---- ground ----
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(66, 38),
      new THREE.MeshStandardMaterial({ color: 0x151d2b, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(24, -0.02, 8);
    this.root.add(ground);

    const grid = new THREE.GridHelper(76, 38, 0x24324a, 0x1b2436);
    grid.position.set(24, 0, 8);
    this.root.add(grid);

    // ---- lane bands ----
    const laneIds = meta.pooled ? [0, 1, 2] : [0, 1, 2];
    for (const id of laneIds) {
      const y = LANES[CLS[id]];
      const band = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 5.2),
        new THREE.MeshBasicMaterial({
          color: CLS_COLOR[id],
          transparent: true,
          opacity: 0.07,
          depthWrite: false,
        })
      );
      band.rotation.x = -Math.PI / 2;
      band.position.set(23, 0.005, y);
      this.root.add(band);

      const tag = this.label(CLS[id].toUpperCase(), "#9fb3cc", 0.62);
      tag.position.set(1.6, 1.6, y);
      this.root.add(tag);
    }

    // ---- painted buffer bays + holding lane ----
    const paint = [];
    for (const id of [0, 1, 2]) {
      for (const [x, y] of bufferSlots(id)) {
        const w = 0.42;
        const h = 0.52;
        paint.push(
          new THREE.Vector3(x - w, 0, y - h), new THREE.Vector3(x + w, 0, y - h),
          new THREE.Vector3(x + w, 0, y - h), new THREE.Vector3(x + w, 0, y + h),
          new THREE.Vector3(x + w, 0, y + h), new THREE.Vector3(x - w, 0, y + h),
          new THREE.Vector3(x - w, 0, y + h), new THREE.Vector3(x - w, 0, y - h)
        );
      }
      for (const [x, y] of standSlots(id)) {
        const w = 0.34;
        const h = 0.5;
        paint.push(
          new THREE.Vector3(x - w, 0, y - h), new THREE.Vector3(x + w, 0, y - h),
          new THREE.Vector3(x + w, 0, y - h), new THREE.Vector3(x + w, 0, y + h)
        );
      }
    }
    this.root.add(this.paintedLine(paint));

    // ---- pickup bay platforms ----
    for (const gid of meta.groups) {
      const id = ["urban", "nt", "prebook", "pool"].indexOf(gid);
      if (id < 0) continue;
      const slots = baySlots(id);
      for (let idx = 0; idx < slots.length; idx++) {
        const [x, y] = slots[idx];
        const mat = new THREE.MeshStandardMaterial({
          color: 0x22304a,
          emissive: new THREE.Color(CLS_COLOR[id]),
          emissiveIntensity: 0.06,
          roughness: 0.8,
        });
        const m = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.12, 1.05), mat);
        m.position.set(x, 0.07, y);
        m.userData.baseEmissive = 0.06;
        this.root.add(m);
        this.bayMeshes.push({ mesh: m, group: gid, id, idx });
      }
    }

    const bayTag = this.label("PICKUP BAYS", "#9fb3cc", 0.62);
    bayTag.position.set(40, 2.4, -1.0);
    this.root.add(bayTag);

    const bufTag = this.label("BUFFER ZONE", "#9fb3cc", 0.62);
    bufTag.position.set(6.9, 2.4, -2.6);
    this.root.add(bufTag);

    const qTag = this.label("QUEUES", "#9fb3cc", 0.62);
    qTag.position.set(18.5, 2.4, -2.6);
    this.root.add(qTag);

    // ---- passengers (one instanced mesh per class) ----
    for (const id of [0, 1, 2]) {
      const mesh = new THREE.InstancedMesh(
        PAX_GEO,
        new THREE.MeshStandardMaterial({
          color: CLS_COLOR[id],
          emissive: new THREE.Color(CLS_COLOR[id]),
          emissiveIntensity: 0.35,
          roughness: 0.6,
        }),
        MAX_QUEUE_SHOWN
      );
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.count = 0;
      mesh.frustumCulled = false;
      this.root.add(mesh);
      this.passengerMeshes.push(mesh);
    }
  }

  /* ------------------------------------------------------------------ */
  /* taxis                                                               */
  /* ------------------------------------------------------------------ */
  _makeTaxi(clsId) {
    const mesh = new THREE.Mesh(TAXI_GEO, this.taxiMats[clsId] || this.taxiMats[0]);
    mesh.castShadow = false;
    mesh.userData.target = new THREE.Vector3();
    mesh.userData.cls = clsId;
    mesh.userData.exiting = false;
    mesh.scale.setScalar(0.01);
    this.root.add(mesh);
    return mesh;
  }

  _positionFor(clsId, state, slot, group, bay) {
    if (state === 2) {
      const [x, y] = bayPos(group, bay);
      return [x, y];
    }
    if (state === 1) return standPos(clsId, slot);
    return bufferPos(clsId, slot);
  }

  /** Apply one recorded frame: set targets, spawn/retire taxis, set queue lengths. */
  sync(frame) {
    const seen = new Set();

    for (let i = 0; i < frame.tx.length; i++) {
      const [id, clsId, state, slot, group, bay] = frame.tx[i];
      seen.add(id);
      const [x, y] = this._positionFor(clsId, state, slot, group, bay);
      let m = this.taxis.get(id);
      if (!m) {
        m = this._makeTaxi(clsId);
        m.position.set(x, TAXI.height / 2 + 0.02, y);
        this.taxis.set(id, m);
      }
      m.userData.target.set(x, TAXI.height / 2 + 0.02, y);
      m.userData.exiting = false;
    }

    // taxis that vanished from the snapshot have left with a passenger
    for (const [id, m] of this.taxis) {
      if (seen.has(id)) continue;
      if (!m.userData.exiting) {
        m.userData.exiting = true;
        m.userData.target.set(EXIT_X + 6, TAXI.height / 2 + 0.02, m.position.z);
      }
    }

    // bay glow
    const occupied = new Set();
    for (const row of frame.tx) {
      if (row[2] === 2) occupied.add(`${row[4]}:${row[5]}`);
    }
    for (const b of this.bayMeshes) {
      const on = occupied.has(`${b.id}:${b.idx}`);
      b.mesh.material.emissiveIntensity = on ? 0.9 : 0.06;
    }

    // queues
    const m4 = new THREE.Matrix4();
    for (let c = 0; c < 3; c++) {
      const n = Math.min(frame.q[c], MAX_QUEUE_SHOWN);
      const mesh = this.passengerMeshes[c];
      for (let i = 0; i < n; i++) {
        const [x, y] = queuePos(c, i);
        const bob = 0.02 * Math.sin(this.time * 3 + i * 0.7);
        m4.makeTranslation(x, 0.28 + bob, y);
        mesh.setMatrixAt(i, m4);
      }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    }
  }

  /* ------------------------------------------------------------------ */
  tick(dt) {
    this.time += dt;
    const k = 1 - Math.exp(-dt * 9);

    for (const [id, m] of this.taxis) {
      const t = m.userData.target;
      m.position.lerp(t, k);
      const dx = t.x - m.position.x;
      const dz = t.z - m.position.z;
      if (Math.abs(dx) + Math.abs(dz) > 0.05) {
        m.rotation.y = Math.atan2(dz, dx);
      }
      const s = Math.max(0.01, Math.min(1, m.scale.x + dt * 6));
      m.scale.setScalar(m.userData.exiting ? Math.max(0.01, m.scale.x - dt * 1.4) : s);

      const arrived = m.position.distanceTo(t) < 0.25;
      if (m.userData.exiting && (arrived || m.scale.x <= 0.02)) {
        this.root.remove(m);
        this.taxis.delete(id);
      }
    }
  }

  render(dt) {
    this._updateCamera(dt || 0.016);
    this.renderer.render(this.scene, this.camera);
  }
}
