/**
 * 3D view of the taxi hall.
 *
 * Design goals, in order:
 *   1. legible at a glance - chunky vehicles, bright lane markings, no clutter
 *   2. readable motion    - ease in/out, limited turn rate, a boarding beat
 *   3. explains the model - live counters over each zone, the starving lane is
 *                           highlighted, arrival ripples show the arrival rate
 *
 * Performance: taxis are 3 InstancedMeshes (body / white roof / dark parts),
 * passengers are 3+3, so ~60 taxis and ~150 people cost ~12 draw calls.
 */

import * as THREE from "../vendor/three.module.js";
import {
  CLS, CLS_COLOR, CLS_LABEL, LANE_TITLE, LANES, EXIT_X, TAXI, TERMINAL,
  bufferPos, standPos, bayPos, queuePos, baySlots, doorPos,
} from "./layout.js";
import { glowTexture, signTexture, daySkyTexture, cloudTexture } from "./textures.js";
import { instances } from "./assets.js";

const TAXI_CAP = 72;
const PAX_CAP = 80;
const TARMAC = 0x2b3543;
const MARK = 0x55637a;

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

/* Taxi: coloured shell, white roof, dark glass and wheels. */
function taxiShellGeo() {
  return merge([
    { geo: box(TAXI.length, 0.26, TAXI.width), y: 0.29 },              // lower body
    { geo: box(0.5, 0.19, TAXI.width - 0.06), y: 0.5, x: -0.08 },      // cabin
    { geo: box(0.1, 0.06, 0.16), y: 0.71, x: -0.08 },                  // roof sign
  ]);
}
function taxiRoofGeo() {
  return merge([{ geo: box(0.54, 0.04, TAXI.width - 0.02), y: 0.62, x: -0.08 }]);
}
function taxiDarkGeo() {
  const wheel = new THREE.CylinderGeometry(0.085, 0.085, 0.06, 8);
  return merge([
    { geo: wheel, x: 0.3, y: 0.09, z: 0.27, rx: Math.PI / 2 },
    { geo: wheel, x: 0.3, y: 0.09, z: -0.27, rx: Math.PI / 2 },
    { geo: wheel, x: -0.3, y: 0.09, z: 0.27, rx: Math.PI / 2 },
    { geo: wheel, x: -0.3, y: 0.09, z: -0.27, rx: Math.PI / 2 },
    { geo: box(0.36, 0.1, TAXI.width - 0.02), y: 0.47, x: 0.13 },      // windscreen
  ]);
}

/* Person: capsule body + head. */
function personGeo() {
  return merge([
    { geo: new THREE.CapsuleGeometry(0.1, 0.14, 4, 8), y: 0.22 },
    { geo: new THREE.SphereGeometry(0.085, 8, 6), y: 0.45 },
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
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;

    this.scene = new THREE.Scene();
    this.scene.background = daySkyTexture();
    this.scene.fog = new THREE.Fog(0xe3eef5, 190, 320);
    this.clouds = [];

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.1, 400);
    this.target = new THREE.Vector3(22, 1.2, 11);
    this.orbit = { theta: Math.PI / 2 + 0.09, phi: 0.95, radius: 48 };
    this.autoRotate = false;

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xa9b8b0, 1.05);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff6e6, 1.55);
    this.sun.position.set(22, 40, 18);
    this.scene.add(this.sun);
    this.rim = new THREE.DirectionalLight(0xdceaff, 0.45);
    this.rim.position.set(-24, 18, -22);
    this.scene.add(this.rim);

    this.root = new THREE.Group();
    this.scene.add(this.root);

    this.geo = {
      shell: taxiShellGeo(),
      roof: taxiRoofGeo(),
      dark: taxiDarkGeo(),
      person: personGeo(),
      ground: new THREE.PlaneGeometry(96, 76),
      shadow: new THREE.CircleGeometry(0.5, 14),
      blob: new THREE.CircleGeometry(0.22, 10),
      ripple: new THREE.RingGeometry(0.32, 0.4, 20),
    };

    this.mat = {
      shell: new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55, metalness: 0.05 }),
      roof: new THREE.MeshStandardMaterial({ color: 0xfbfcfd, roughness: 0.7 }),
      dark: new THREE.MeshStandardMaterial({ color: 0x2b313a, roughness: 0.75 }),
      shadow: new THREE.MeshBasicMaterial({ color: 0x1d2a24, transparent: true, opacity: 0.16, depthWrite: false }),
      person: CLS_COLOR.map(
        (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.78 })
      ),
    };

    this.taxis = new Map();
    this.people = new Map();
    this.ripples = [];
    this.bayMeshes = [];
    this.laneGlow = [];
    this.time = 0;
    this.hour = 9;
    this.assets = null;
    this.dprScale = 1;

    this._bindControls();
    this.resize();
  }

  /* ---------------- instanced pools ---------------- */
  _pool(geo, mat, n, colored = false) {
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
  }

  _buildPools() {
    const A = this.assets;
    // every mesh that represents a moving entity is tagged, so the visual
    // regression harness can hide them without knowing their structure
    const tag = (m) => { if (m) m.userData.entity = true; };
    // The procedural pools carry the class colour per instance and are proven
    // stable; the GLB taxi swap is parked until it can be debugged visually.
    this.taxiInst = null;
    if (this.taxiInst) this.taxiInst.forEach((inst) => inst.meshes.forEach(tag));
    this.paxInst = A?.people ? A.people.map((p) => instances(p, PAX_CAP, this.root)) : null;

    this.taxiShadow = this._pool(this.geo.shadow, this.mat.shadow, TAXI_CAP);
    // coloured roof sign: carries the class colour now that the taxi is a model
    this.signMesh = new THREE.InstancedMesh(
      new THREE.BoxGeometry(0.34, 0.11, 0.2),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.45, roughness: 0.5 }),
      TAXI_CAP
    );
    this.signMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.signMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(TAXI_CAP * 3), 3);
    this.signMesh.frustumCulled = false;
    this.signMesh.count = 0;
    this.root.add(this.signMesh);
    this.paxShadow = [0, 1, 2].map(() => this._pool(this.geo.blob, this.mat.shadow, PAX_CAP));

    if (this.taxiInst && this.paxInst) return;   // models cover everything

    this.taxiShell = this._pool(this.geo.shell, this.mat.shell, TAXI_CAP, true);
    this.taxiRoof = this._pool(this.geo.roof, this.mat.roof, TAXI_CAP);
    this.taxiDark = this._pool(this.geo.dark, this.mat.dark, TAXI_CAP);
    this.paxMesh = [0, 1, 2].map((c) => this._pool(this.geo.person, this.mat.person[c], PAX_CAP));
    [this.taxiShell, this.taxiRoof, this.taxiDark, ...this.paxMesh].forEach(tag);

    // arrival ripples
    this.rippleMeshes = [];
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(
        this.geo.ripple,
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false })
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.root.add(mesh);
      this.rippleMeshes.push({ mesh, life: 0 });
    }
    this.rippleIdx = 0;
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
      this.orbit.phi = Math.min(1.32, Math.max(0.22, this.orbit.phi - (e.clientY - p.ly) * 0.006));
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
    this.orbit = { theta: Math.PI / 2 + 0.09, phi: 0.95, radius: 48 };
    this.autoRotate = false;
  }

  /** Adaptive resolution: drop the pixel ratio when frames get expensive. */
  setDprScale(scale) {
    this.dprScale = Math.max(0.6, Math.min(1, scale));
    this.renderer.setPixelRatio(
      Math.min(window.devicePixelRatio || 1, this.maxDpr * this.dprScale)
    );
    this.resize();
  }

  setQuality(q) {
    this.quality = q;
    this.maxDpr = q === "low" ? 1 : 1.75;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxDpr));
    this.scene.fog = q === "low" ? null : new THREE.Fog(0xe3eef5, 190, 320);
    this.resize();
  }

  resize() {
    const w = this.canvas.clientWidth || 800;
    const h = this.canvas.clientHeight || 600;
    this.renderer.setSize(w, h, false);
    const portrait = h > w;
    // on a tall screen, look *along* the hall (west -> east) so its length runs
    // up the screen instead of being squeezed into a narrow strip
    if (this.wasPortrait !== portrait) {
      this.wasPortrait = portrait;
      this.orbit = portrait
        ? { theta: 2.72, phi: 0.82, radius: 68 }
        : { theta: Math.PI / 2 + 0.1, phi: 0.78, radius: 52 };
    }
    this.portrait = portrait;
    this.camera.fov = portrait ? 50 : 40;
    this.camera.aspect = w / h;
    if (portrait) this.camera.setViewOffset(w, h, 0, Math.round(h * 0.06), w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- text sprite ---------------- */
  label(text, color = "#c8d4e6", size = 0.6) {
    const font = "700 54px -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = font;
    const w = Math.ceil(probe.measureText(text).width) + 40;
    const h = 104;
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
    const height = size * 1.9;
    s.scale.set((height * w) / h, height, 1);
    return s;
  }

  /* ---------------- static world ---------------- */
  setScene(meta) {
    this.root.clear();
    this.taxis.clear();
    this.people.clear();
    this.bayMeshes = [];
    this.laneGlow = [];
    this.meta = meta;

    const ground = new THREE.Mesh(
      this.geo.ground,
      new THREE.MeshStandardMaterial({ color: 0xa9b8b0, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(23, -0.02, 12);
    this.root.add(ground);

    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];

      // lane asphalt, slightly lighter so the three lanes read as lanes
      const tint = new THREE.Color(CLS_COLOR[id]).lerp(new THREE.Color(0xffffff), 0.58);
      const strip = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 4.9),
        new THREE.MeshStandardMaterial({ color: tint, roughness: 1 })
      );
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(23, 0.005, y);
      this.root.add(strip);

      // painted edges
      for (const dy of [-2.42, 2.42]) {
        const edge = new THREE.Mesh(
          new THREE.PlaneGeometry(50, 0.09),
          new THREE.MeshBasicMaterial({
            color: new THREE.Color(CLS_COLOR[id]).lerp(new THREE.Color(0xffffff), 0.05),
            transparent: true,
            opacity: 0.9,
          })
        );
        edge.rotation.x = -Math.PI / 2;
        edge.position.set(23, 0.012, y + dy);
        this.root.add(edge);
      }

      // coloured glow used to mark the bottleneck
      const glow = new THREE.Mesh(
        new THREE.PlaneGeometry(50, 4.9),
        new THREE.MeshBasicMaterial({ color: CLS_COLOR[id], transparent: true, opacity: 0.03, depthWrite: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.set(23, 0.008, y);
      this.root.add(glow);
      this.laneGlow[id] = glow;

      const tag = this.label(
        LANE_TITLE[id],
        "#" + new THREE.Color(CLS_COLOR[id]).lerp(new THREE.Color(0x1d2a33), 0.45).getHexString(),
        0.42
      );
      tag.position.set(3.4, 1.0, y - 1.7);
      this.root.add(tag);
    }

    // pickup bays
    for (const gid of meta.groups) {
      const id = ["urban", "nt", "prebook", "pool"].indexOf(gid);
      if (id < 0) continue;
      const slots = baySlots(id);
      for (let idx = 0; idx < slots.length; idx++) {
        const [x, y] = slots[idx];
        const mat = new THREE.MeshStandardMaterial({
          color: 0xe3e9ee,
          emissive: new THREE.Color(CLS_COLOR[id]),
          emissiveIntensity: 0.06,
          roughness: 0.85,
        });
        const m = new THREE.Mesh(box(1.9, 0.1, 1.0), mat);
        m.position.set(x, 0.05, y);
        this.root.add(m);
        this.bayMeshes.push({ mesh: m, id, idx });
      }
    }

    this._buildTerminal();
    this._buildRoad();
    this._buildProps();
    this._buildSky();
    this._buildStreetFurniture();
    this._buildAssets();
    this._buildPools();

    const t1 = this.label("WAITING AREA", "#51606f", 0.44);
    t1.position.set(7.5, 1.0, -2.4);
    this.root.add(t1);
    const t2 = this.label("PICKUP BAYS", "#51606f", 0.44);
    t2.position.set(40, 1.0, -1.6);
    this.root.add(t2);
  }

  _buildTerminal() {
    const T = TERMINAL;
    const concrete = new THREE.MeshStandardMaterial({ color: 0xeef1f4, roughness: 0.85 });
    const glass = new THREE.MeshStandardMaterial({
      color: 0xfff0cc,
      emissive: new THREE.Color(0xffe6b0),
      emissiveIntensity: 0.55,
      roughness: 0.6,
    });
    this.windowMat = new THREE.MeshStandardMaterial({
      color: 0x8fc0dd,
      emissive: new THREE.Color(0xffe3ae),
      emissiveIntensity: 0.25,
      roughness: 0.4,
      metalness: 0.05,
    });

    const doors = [[13.2, 15.0], [16.7, 18.5], [20.2, 22.0]];

    // glass doors sit on the face of the kit buildings
    for (const [a, b] of doors) {
      const d = new THREE.Mesh(new THREE.PlaneGeometry(b - a, 2.6), glass);
      d.position.set((a + b) / 2, 1.3, T.y + T.depth / 2 + 2.6);
      this.root.add(d);
    }

    // ---- entrance: portal, canopy, steps, glass ----
    const face = T.y + T.depth / 2 + 2.6;
    const white = new THREE.MeshStandardMaterial({ color: 0xf4f6f8, roughness: 0.8 });
    const accent = new THREE.MeshStandardMaterial({ color: 0x2f8f7a, roughness: 0.75 });

    for (const x of [11.4, 23.8]) {
      const col = new THREE.Mesh(box(0.55, 3.5, 0.55), white);
      col.position.set(x, 1.75, face + 1.2);
      this.root.add(col);
    }
    const lintel = new THREE.Mesh(box(13.1, 0.5, 0.65), white);
    lintel.position.set(17.6, 3.65, face + 1.2);
    this.root.add(lintel);

    const canopy = new THREE.Mesh(box(12.2, 0.14, 2.4), accent);
    canopy.position.set(17.6, 3.42, face + 2.3);
    this.root.add(canopy);

    // glass curtain wall behind the doors
    const glassWall = new THREE.Mesh(new THREE.PlaneGeometry(12.2, 2.9), this.windowMat);
    glassWall.position.set(17.6, 1.45, face - 1.4);
    this.root.add(glassWall);

    // steps down to the pavement
    for (let i = 0; i < 2; i++) {
      const step = new THREE.Mesh(box(12.6 - i * 0.7, 0.11, 0.5), white);
      step.position.set(17.6, 0.055 + i * 0.11, face + 3.9 + i * 0.45);
      this.root.add(step);
    }

    // sign band on the lintel
    const band = new THREE.Mesh(box(8.6, 0.85, 0.12), accent);
    band.position.set(17.6, 4.5, face + 1.1);
    this.root.add(band);

    const sign = this.label("HUANGGANG PORT  ·  皇岗口岸", "#f4f8ff", 0.42);
    sign.position.set(17.6, 4.5, face + 1.18);
    this.root.add(sign);

    // kerb in front of the terminal
    const kerb = new THREE.Mesh(box(48, 0.16, 0.5), new THREE.MeshStandardMaterial({ color: 0xb9c3cd, roughness: 0.9 }));
    kerb.position.set(21, 0.08, T.y + T.depth / 2 + 3.2);
    this.root.add(kerb);

    const taxiSign = this.label("TAXI  的士", "#33404f", 0.6);
    taxiSign.position.set(40, 2.0, -1.1);
    this.root.add(taxiSign);

    const poleMat = new THREE.MeshStandardMaterial({ color: 0x46536a, roughness: 0.6 });
    for (const px of [12, 24, 36]) {
      for (const py of [2.2, 10.2, 18.2]) {
        const pole = new THREE.Mesh(box(0.09, 2.6, 0.09), poleMat);
        pole.position.set(px, 1.3, py);
        this.root.add(pole);
        const lamp = new THREE.Mesh(
          new THREE.SphereGeometry(0.12, 7, 5),
          new THREE.MeshStandardMaterial({ color: 0xfff4d6, emissive: 0xffe9b8, emissiveIntensity: 1.1 })
        );
        lamp.position.set(px, 2.66, py);
        this.root.add(lamp);
      }
    }
  }

  /** Drifting billboard clouds above the terminal. */
  _buildSky() {
    this.clouds.forEach((c) => this.root.remove(c.sprite));
    this.clouds = [];
    if (this.quality === "low") return;
    const tex = cloudTexture();
    const spots = [
      [-14, 13, -30, 16], [8, 16, -38, 20], [28, 12, -34, 15],
      [46, 17, -42, 22], [62, 14, -30, 17], [20, 19, -50, 24],
    ];
    for (const [x, y, z, scale] of spots) {
      const sprite = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false })
      );
      sprite.position.set(x, y, z);
      sprite.scale.set(scale, scale * 0.5, 1);
      this.root.add(sprite);
      this.clouds.push({ sprite, speed: 0.15 + Math.random() * 0.2 });
    }
  }

  /** Benches, bins, a shelter and a ticket machine — the street-level detail. */
  _buildStreetFurniture() {
    if (this.quality === "low") return;
    const wood = new THREE.MeshStandardMaterial({ color: 0xb98a5e, roughness: 0.85 });
    const metal = new THREE.MeshStandardMaterial({ color: 0x8d9aa8, roughness: 0.6, metalness: 0.25 });
    const green = new THREE.MeshStandardMaterial({ color: 0x2f8f7a, roughness: 0.8 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xbfe0ea, transparent: true, opacity: 0.45, roughness: 0.2 });

    const z0 = TERMINAL.y + TERMINAL.depth / 2 + 5.2;
    for (let x = 4; x <= 44; x += 8) {
      // bench
      const seat = new THREE.Mesh(box(1.6, 0.1, 0.5), wood);
      seat.position.set(x, 0.42, z0);
      this.root.add(seat);
      const back = new THREE.Mesh(box(1.6, 0.45, 0.09), wood);
      back.position.set(x, 0.66, z0 - 0.22);
      this.root.add(back);
      for (const dx of [-0.6, 0.6]) {
        const leg = new THREE.Mesh(box(0.1, 0.42, 0.1), metal);
        leg.position.set(x + dx, 0.21, z0);
        this.root.add(leg);
      }
      // bin
      const bin = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.16, 0.55, 10), green);
      bin.position.set(x + 2.4, 0.28, z0 + 0.2);
      this.root.add(bin);
    }

    // waiting shelter
    const sx = 26;
    for (const dx of [-1.6, 1.6]) {
      for (const dz of [-0.7, 0.7]) {
        const post = new THREE.Mesh(box(0.1, 2.1, 0.1), metal);
        post.position.set(sx + dx, 1.05, z0 + dz);
        this.root.add(post);
      }
    }
    const roof = new THREE.Mesh(box(3.8, 0.12, 2.0), green);
    roof.position.set(sx, 2.15, z0);
    this.root.add(roof);
    const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 1.6), glass);
    panel.position.set(sx, 1.3, z0 - 0.75);
    this.root.add(panel);

    // ticket machine
    const machine = new THREE.Mesh(box(0.7, 1.5, 0.45), metal);
    machine.position.set(33, 0.75, z0 + 0.4);
    this.root.add(machine);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.45, 0.3), new THREE.MeshBasicMaterial({ color: 0x9fd8ff }));
    screen.position.set(33, 1.15, z0 + 0.63);
    this.root.add(screen);
  }

  /** The taxi approach road: fills the foreground and explains the entry flow. */
  _buildRoad() {
    const road = new THREE.Mesh(
      new THREE.PlaneGeometry(64, 6),
      new THREE.MeshStandardMaterial({
        color: 0xb8c3c9,
        roughness: 0.95,
      })
    );
    road.rotation.x = -Math.PI / 2;
    road.position.set(21, 0.004, 25.4);
    this.root.add(road);

    // kerb lines
    for (const dz of [-3.5, 3.5]) {
      const line = new THREE.Mesh(
        new THREE.PlaneGeometry(64, 0.1),
        new THREE.MeshBasicMaterial({ color: 0x6d7d95, transparent: true, opacity: 0.7 })
      );
      line.rotation.x = -Math.PI / 2;
      line.position.set(21, 0.014, 25.4 + dz);
      this.root.add(line);
    }

    // dashed centre line
    for (let x = -9; x < 52; x += 4.4) {
      const dash = new THREE.Mesh(
        new THREE.PlaneGeometry(2.2, 0.13),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 })
      );
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(x, 0.014, 25.4);
      this.root.add(dash);
    }

    // direction chevrons pointing into the hall
    for (const x of [2, 14, 26]) {
      for (const dz of [-1.6, 1.6]) {
        const ch = new THREE.Mesh(
          new THREE.PlaneGeometry(0.9, 0.16),
          new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 })
        );
        ch.rotation.x = -Math.PI / 2;
        ch.rotation.z = 0.6;
        ch.position.set(x, 0.015, 25.4 + dz);
        this.root.add(ch);
      }
    }

    const sign = this.label("TAXI APPROACH", "#5b6b7a", 0.5);
    sign.position.set(3, 1.2, 31.2);
    this.root.add(sign);
  }

  /** Railings along the queues, hanging lane signs, bollards and lamp glow. */
  _buildProps() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x9aa8b6, roughness: 0.6, metalness: 0.2 });
    const parts = [];
    const post = () => box(0.05, 0.62, 0.05);

    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      for (const dz of [-2.15, 2.15]) {
        for (let x = 12.6; x <= 24.4; x += 2.95) parts.push({ geo: post(), x, y: 0.31, z: y + dz });
        // top rail
        parts.push({ geo: box(11.9, 0.045, 0.045), x: 18.45, y: 0.62, z: y + dz });
      }
    }
    this.root.add(new THREE.Mesh(merge(parts), metal));

    // hanging lane signs above the queue entrance
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      const laneHex = "#" + new THREE.Color(CLS_COLOR[id]).getHexString();
      const tex = signTexture(LANE_TITLE[id], laneHex, "#ffffff");
      const board = new THREE.Mesh(
        new THREE.PlaneGeometry(3.9, 1.16),
        new THREE.MeshStandardMaterial({
          map: tex, roughness: 0.5,
          emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.35,
        })
      );
      board.position.set(12.9, 2.6, y);
      this.root.add(board);
      for (const dx of [-1.3, 1.3]) {
        const rod = new THREE.Mesh(box(0.04, 1.0, 0.04), metal);
        rod.position.set(12.9 + dx, 3.15, y);
        this.root.add(rod);
      }
    }

    // bollards along the kerb
    const bollards = [];
    for (let x = 1; x <= 46; x += 2.6) bollards.push({ geo: box(0.09, 0.5, 0.09), x, y: 0.25, z: TERMINAL.y + TERMINAL.depth / 2 + 1.2 });
    this.root.add(new THREE.Mesh(merge(bollards), new THREE.MeshStandardMaterial({ color: 0x9aa8bb, roughness: 0.5, metalness: 0.35 })));

    // trees: cheap and they make the hall feel like a place
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x9c7550, roughness: 0.9 });
    const leafMats = [0x5fae6b, 0x4f9e63, 0x71bd77].map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.9 })
    );
    const spots = [[-7, 14], [-7, 21], [-7, 28], [55, 14], [55, 21], [55, 28], [7, 34], [37, 34]];
    spots.forEach(([x, z], i) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 1.0, 6), trunkMat);
      trunk.position.set(x, 0.5, z);
      this.root.add(trunk);
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(0.85, 0), leafMats[i % 3]);
      crown.position.set(x, 1.55, z);
      this.root.add(crown);
      const top = new THREE.Mesh(new THREE.IcosahedronGeometry(0.55, 0), leafMats[(i + 1) % 3]);
      top.position.set(x + 0.25, 2.2, z - 0.15);
      this.root.add(top);
    });

    // warm lamp glow (additive sprites, no extra lights)
    const glow = glowTexture();
    for (const px of [12, 24, 36]) {
      for (const py of [2.2, 10.2, 18.2]) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
          map: glow, color: 0xffe8c0, transparent: true, opacity: 0.35,
          blending: THREE.AdditiveBlending, depthWrite: false,
        }));
        sprite.scale.set(2.4, 2.4, 1);
        sprite.position.set(px, 2.66, py);
        this.root.add(sprite);
      }
    }
  }

  /** Place one baked model (already normalised: y=0 base, centred on x/z). */
  addModel(parts, x, z, rotY = 0, scale = 1, y = 0, stretch = null, tint = null) {
    if (!parts) return null;
    const g = new THREE.Group();
    for (const p of parts) {
      let mat = p.material;
      if (tint) {
        mat = mat.clone();
        mat.color = mat.color.clone().multiply(new THREE.Color(tint));
      }
      g.add(new THREE.Mesh(p.geometry, mat));
    }
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    if (stretch) g.scale.set(scale * stretch[0], scale, scale * stretch[1]);
    else g.scale.setScalar(scale);
    this.root.add(g);
    return g;
  }

  /** City backdrop, trees and planters from the CC0 kits. */
  _buildAssets() {
    const A = this.assets;
    if (!A) return;
    const low = this.quality === "low";

    // the terminal itself: a run of kit buildings forming the facade
    const blocks = low ? [4, 20, 36] : [1, 10.5, 20, 29.5, 39];
    blocks.forEach((x, i) => {
      const b = A.buildings[i % A.buildings.length];
      this.addModel(b, x, -7.6 - (i % 2) * 1.2, 0, 1.0, 0, [2.1, 1.3], 0xffe4c2);
    });

    // a second row behind the terminal for depth
    if (!low) {
      [-13, 3, 19, 35, 49].forEach((x, i) => {
        const b = A.buildings[(i + 1) % A.buildings.length];
        this.addModel(b, x, -15.5 - (i % 2) * 4.5, 0, 1.18, 0, [1.85, 1.5], 0xf0dcc4);
      });
    }

    if (low) return;

    // trees along both edges and behind the building
    const treeSpots = [
      [-12, 6, 1.5], [-12, 14, 1.2], [-12, 22, 1.6], [-12, 30, 1.3],
      [60, 6, 1.4], [60, 14, 1.5], [60, 22, 1.2], [60, 30, 1.5],
      [-4, -12, 1.7], [13, -12, 1.5], [27, -12, 1.6], [41, -12, 1.4],
      [54, -12, 1.5], [-2, 36, 1.3], [50, 36, 1.4], [26, 38, 1.2],
    ];
    for (const [x, z, sc] of treeSpots) {
      this.addModel(A.trees[(x + z) % A.trees.length], x, z, (x + z) * 0.7, sc);
    }

    // planters along the terminal kerb
    for (let x = 2; x <= 44; x += 6.5) {
      this.addModel(A.bushes[(x | 0) % A.bushes.length], x, TERMINAL.y + TERMINAL.depth / 2 + 2.2, 0, 1.6);
    }
  }

  /* ---------------- zone counters (HTML, crisp text) ---------------- */
  attachLabels(host) {
    if (!host) return;
    host.innerHTML = "";
    this.labelEls = [0, 1, 2].map((c) => {
      const el = document.createElement("div");
      el.className = "zone-label";
      el.style.setProperty("--c", "#f2685c");
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
      const p = this.project(wx, 1.3, wz - 2.4);
      const n = f.q[c];
      el.style.setProperty("--c", ["#f2685c", "#2ec4a6", "#4a9eff"][c]);
      el.classList.toggle("hidden", n === 0 || p.z > 1);
      el.classList.toggle("worst", c === worst && n > 6);
      el.innerHTML = `<b>${n}</b> waiting`;
      el.style.transform = `translate(${p.x}px, ${p.y}px) translate(-50%, -100%)`;
    }
    const buf = this.labelEls[3];
    const [bx, bz] = bufferPos(0, 10);
    const pb = this.project(bx, 1.3, bz - 2.2);
    buf.innerHTML = `<b>${f.buf}</b> taxis`;
    buf.style.transform = `translate(${pb.x}px, ${pb.y}px) translate(-50%, -100%)`;
    buf.classList.toggle("hidden", pb.z > 1);
  }

  /* ---------------- per-frame state ---------------- */
  sync(frame) {
    this.metaFrame = frame;
    const seenT = new Set();
    const seenP = new Set();

    for (const row of frame.tx) {
      const [id, clsId, state, slot, group, bay] = row;
      seenT.add(id);
      const [x, y] = state === 2 ? bayPos(group, bay) : state === 1 ? standPos(clsId, slot) : bufferPos(clsId, slot);
      let e = this.taxis.get(id);
      if (!e) {
        // enter from the approach road, then swing into the buffer lane
        e = {
          x: -14, z: 25.4, yaw: 0, v: 0, cls: clsId, exiting: false, fade: 0,
          wp: { x: -3.0, z: 22.6 },
        };
        this.taxis.set(id, e);
      }
      e.tx = x;
      e.tz = y;
      e.exiting = false;
    }

    for (const [id, clsId, slot] of frame.px) {
      seenP.add(id);
      const [qx, qy] = queuePos(clsId, slot);
      const jx = (((id * 37) % 17) / 17 - 0.5) * 0.24;
      const jz = (((id * 53) % 19) / 19 - 0.5) * 0.28;
      let e = this.people.get(id);
      if (!e) {
        const [dx, dy] = doorPos(clsId);
        e = { x: dx, z: dy, yaw: 0, v: 0, cls: clsId, leaving: false, fade: 0, wait: 0 };
        this.people.set(id, e);
        this._ripple(dx, dy, CLS_COLOR[clsId]);
      }
      e.tx = qx + jx;
      e.tz = qy + jz;
    }

    for (const [id, e] of this.people) {
      if (seenP.has(id)) continue;
      if (!e.leaving) {
        e.leaving = true;
        e.tx = 38.2;
        e.tz = LANES[CLS[e.cls]];
        e.wait = 0.35;          // the boarding beat
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

  _ripple(x, z, color) {
    if (!this.rippleMeshes || this.quality === "low") return;
    const r = this.rippleMeshes[this.rippleIdx % this.rippleMeshes.length];
    this.rippleIdx++;
    r.mesh.position.set(x, 0.03, z);
    r.mesh.material.color.setHex(color);
    r.mesh.visible = true;
    r.life = 1;
  }

  /* ---------------- motion + draw ---------------- */
  tick(dt, hour) {
    this.time += dt;
    if (hour != null) this.setHour(hour);

    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();

    /* --- taxis --- */
    let n = 0;
    const countsT = [0, 0, 0];
    for (const [id, e] of this.taxis) {
      let gx = e.tx;
      let gz = e.tz;
      if (e.wp) {
        if (Math.hypot(e.wp.x - e.x, e.wp.z - e.z) < 1.4) e.wp = null;
        else { gx = e.wp.x; gz = e.wp.z; }
      }
      const dx = gx - e.x;
      const dz = gz - e.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 9) {
        e.x = e.tx;
        e.z = e.tz;
        e.v = 0;
      } else if (dist > 0.02) {
        // ease in/out: fast when far, gentle on arrival
        const want = Math.min(e.exiting ? 9 : 7, Math.max(0.5, dist * 2.6));
        e.v += (want - e.v) * Math.min(1, dt * 6);
        const stepLen = Math.min(dist, e.v * dt);
        e.x += (dx / dist) * stepLen;
        e.z += (dz / dist) * stepLen;

        // limited turn rate -> arcs instead of instant snapping
        const want_yaw = Math.atan2(dz, dx);
        let d = want_yaw - e.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        e.yaw += Math.max(-6 * dt, Math.min(6 * dt, d));
      } else {
        e.v = 0;
      }

      e.fade = Math.min(1, (e.fade ?? 1) + dt * 3.5);
      const grow = 0.6 + 0.4 * e.fade;

      if (e.exiting === "exit" && dist < 0.4) {
        this.taxis.delete(id);
        continue;
      }
      if (n >= TAXI_CAP) break;

      q.setFromAxisAngle(up, e.yaw || 0);
      m.compose(new THREE.Vector3(e.x, 0.02, e.z), q, new THREE.Vector3(grow, grow, grow));
      if (this.taxiInst) {
        // class 3 is a flexible taxi: draw it with the urban colourway
        const ci = e.cls >= 0 && e.cls <= 2 ? e.cls : 0;
        if (countsT[ci] < TAXI_CAP) {
          this.taxiInst[ci].set(countsT[ci], m);
          countsT[ci]++;
        }
      } else {
        this.taxiShell.setMatrixAt(n, m);
        this.taxiRoof.setMatrixAt(n, m);
        this.taxiDark.setMatrixAt(n, m);
        col.setHex(CLS_COLOR[e.cls] || 0xffffff);
        this.taxiShell.setColorAt(n, col);
      }
      m.compose(new THREE.Vector3(e.x, 0.012, e.z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
      this.taxiShadow.setMatrixAt(n, m);
      m.compose(new THREE.Vector3(e.x, 0.86, e.z), q, new THREE.Vector3(1, 1, 1));
      this.signMesh.setMatrixAt(n, m);
      this.signMesh.setColorAt(n, col.setHex(CLS_COLOR[e.cls] || 0xffffff));
      n++;
    }
    if (this.taxiInst) {
      for (let c = 0; c < 3; c++) {
        this.taxiInst[c].count = countsT[c];
        this.taxiInst[c].flush();
      }
    } else {
      for (const mesh of [this.taxiShell, this.taxiRoof, this.taxiDark]) {
        mesh.count = n;
        mesh.instanceMatrix.needsUpdate = true;
      }
      if (this.taxiShell.instanceColor) this.taxiShell.instanceColor.needsUpdate = true;
    }
    this.taxiShadow.count = n;
    this.taxiShadow.instanceMatrix.needsUpdate = true;
    this.signMesh.count = n;
    this.signMesh.instanceMatrix.needsUpdate = true;
    if (this.signMesh.instanceColor) this.signMesh.instanceColor.needsUpdate = true;

    /* --- people --- */
    const counts = [0, 0, 0];
    for (const [id, e] of this.people) {
      const dx = e.tx - e.x;
      const dz = e.tz - e.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 4.5) {
        e.x = e.tx;
        e.z = e.tz;
      } else if (dist > 0.02) {
        const want = Math.min(1.9, Math.max(0.35, dist * 2.4));
        e.v += (want - e.v) * Math.min(1, dt * 7);
        const stepLen = Math.min(dist, e.v * dt);
        e.x += (dx / dist) * stepLen;
        e.z += (dz / dist) * stepLen;
        const want_yaw = Math.atan2(dz, dx);
        let d = want_yaw - e.yaw;
        while (d > Math.PI) d -= Math.PI * 2;
        while (d < -Math.PI) d += Math.PI * 2;
        e.yaw += Math.max(-9 * dt, Math.min(9 * dt, d));
        e.moving = true;
      } else {
        e.v = 0;
        e.moving = false;
      }

      if (e.leaving) {
        if (dist < 0.5) e.wait -= dt;
        if (e.wait <= 0) e.fade -= dt * 2.2;
        if (e.fade <= 0) {
          this.people.delete(id);
          continue;
        }
      }

      const c = e.cls;
      const i = counts[c];
      if (i >= PAX_CAP) continue;
      // toy-like walk: vertical bob, lateral sway and a forward lean
      const phase = this.time * 9 + id * 0.7;
      const bob = e.moving ? Math.abs(Math.sin(phase)) * 0.045 : 0;
      const sway = e.moving ? Math.sin(phase * 0.5) * 0.05 : 0;
      const lean = e.moving ? -0.09 : 0;
      e.fade = Math.min(1, (e.fade ?? 1) + dt * 4);
      const variety = 0.94 + (((id * 13) % 7) / 7) * 0.12;
      const scale = Math.max(0.05, Math.min(1, e.fade)) * variety;
      // character models face -Z, so add PI to the heading
      const heading = (e.yaw || 0) + Math.PI;
      q.setFromEuler(new THREE.Euler(lean, heading, 0, "YXZ"));
      const side = new THREE.Vector3(Math.cos(heading), 0, -Math.sin(heading)).multiplyScalar(sway);
      m.compose(new THREE.Vector3(e.x + side.x, 0.01 + bob, e.z + side.z), q, new THREE.Vector3(scale, scale, scale));
      if (this.paxInst) this.paxInst[c].set(i, m);
      else this.paxMesh[c].setMatrixAt(i, m);
      m.compose(new THREE.Vector3(e.x, 0.015, e.z), new THREE.Quaternion(), new THREE.Vector3(scale * 0.8, scale, 1));
      this.paxShadow[c].setMatrixAt(i, m);
      counts[c]++;
    }
    for (let c = 0; c < 3; c++) {
      if (this.paxInst) {
        this.paxInst[c].count = counts[c];
        this.paxInst[c].flush();
      } else {
        this.paxMesh[c].count = counts[c];
        this.paxMesh[c].instanceMatrix.needsUpdate = true;
      }
      this.paxShadow[c].count = counts[c];
      this.paxShadow[c].instanceMatrix.needsUpdate = true;
    }

    /* --- clouds --- */
    for (const c of this.clouds) {
      c.sprite.position.x += c.speed * dt;
      if (c.sprite.position.x > 78) c.sprite.position.x = -26;
    }

    /* --- ripples --- */
    for (const r of this.rippleMeshes || []) {
      if (r.life <= 0) continue;
      r.life -= dt * 1.5;
      const s = 1 + (1 - r.life) * 2.4;
      r.mesh.scale.set(s, s, s);
      r.mesh.material.opacity = Math.max(0, r.life) * 0.5;
      if (r.life <= 0) r.mesh.visible = false;
    }

    /* --- bays + bottleneck --- */
    const occupied = new Set();
    for (const row of this.metaFrame?.tx || []) if (row[2] === 2) occupied.add(`${row[4]}:${row[5]}`);
    for (const b of this.bayMeshes) {
      b.mesh.material.emissiveIntensity = occupied.has(`${b.id}:${b.idx}`) ? 0.95 : 0.05;
    }

    const qs = this.metaFrame?.q || [0, 0, 0];
    const worst = qs[0] >= qs[1] && qs[0] >= qs[2] ? 0 : qs[1] >= qs[2] ? 1 : 2;
    for (let c = 0; c < 3; c++) {
      if (this.laneGlow[c]) {
        const target = c === worst && qs[c] > 8 ? 0.1 : 0.03;
        const mat = this.laneGlow[c].material;
        mat.opacity += (target - mat.opacity) * Math.min(1, dt * 3);
      }
    }
  }

  setHour(h) {
    if (Math.abs(h - this.hour) < 0.2) return;
    this.hour = h;
    const t = Math.min(1, Math.max(0, (h - 8) / 12));
    const day = Math.min(1, 0.6 + 0.7 * Math.sin(Math.PI * t));
    const dusk = t > 0.72 ? (t - 0.72) / 0.28 : 0;

    this.sun.intensity = 0.35 + 1.25 * day;
    this.sun.color.setHSL(0.1, 0.45 * (1 - day) + 0.04, 0.66 + 0.1 * day);
    this.hemi.intensity = 0.7 + 0.5 * day;
    this.rim.intensity = 0.25 + 0.25 * day;

    if (this.scene.fog) {
      const fog = new THREE.Color(0x1b2b40).lerp(new THREE.Color(0x2c4257), day * 0.7);
      fog.lerp(new THREE.Color(0x0a1018), dusk * 0.6);
      this.scene.fog.color = fog;
    }
    if (this.windowMat) this.windowMat.emissiveIntensity = 0.45 + 0.85 * dusk;
  }

  render(dt) {
    if (this.autoRotate) this.orbit.theta += (dt || 0.016) * 0.03;
    const { theta, phi } = this.orbit;
    const radius = this.orbit.radius * (this.portrait ? 1.0 : 1);
    this.camera.position.set(
      this.target.x + radius * Math.sin(phi) * Math.cos(theta),
      this.target.y + radius * Math.cos(phi),
      this.target.z + radius * Math.sin(phi) * Math.sin(theta)
    );
    this.camera.lookAt(this.target);
    this.renderer.render(this.scene, this.camera);
    this._updateLabels();
  }
}
