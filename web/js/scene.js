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
  paper: 0xffffff,
  paperShade: 0xeeece6,
  road: 0xd2cfc5,
  roadEdge: 0xc9c6bc,
  water: 0xeef4f6,
  ink: 0x1b1f24,
  accent: 0xd94f3d,
  accent2: 0x2f6f97,
  roof: 0xffffff,
  glass: 0x8f969d,
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
    this.scene.background = new THREE.Color(0xf4f3ef);

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
          this.viewOffset.zoom = Math.min(1.7, Math.max(0.75, (startZoom * dist()) / pinch));
        }
        return;
      }
      // rotate the isometric angle in 90°-ish steps for a clean look
      this.viewOffset.theta -= (e.clientX - p.lx) * 0.006;
      this.viewOffset.phi = Math.min(1.05, Math.max(0.78, this.viewOffset.phi - (e.clientY - p.ly) * 0.003));
      p.lx = e.clientX;
      p.ly = e.clientY;
    }, { passive: true });

    this.canvas.addEventListener("wheel", (e) => {
      e.preventDefault();
      this.viewOffset.zoom = Math.min(1.7, Math.max(0.75, this.viewOffset.zoom - e.deltaY * 0.0012));
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
    const size = this.portrait ? 92 : 66;
    this.camera.left = -size / 2;
    this.camera.right = size / 2;
    this.camera.top = size / 2;
    this.camera.bottom = -size / 2;
    this.camera.updateProjectionMatrix();
  }

  /* ---------------- helpers ---------------- */
  /** A box with a black silhouette behind it — the whole look in one helper. */
  box(w, h, d, color, opts = {}) {
    const geo = new THREE.BoxGeometry(w, h, d);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color, ...opts }));

    const edge = new THREE.Mesh(
      geo,
      new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide })
    );
    edge.scale.setScalar(1.035);
    m.add(edge);
    return m;
  }

  /** Place a baked kit model (already normalised: base at y=0, centred x/z). */
  addModel(parts, x, z, rotY = 0, scale = 1, y = 0) {
    if (!parts) return null;
    const g = new THREE.Group();
    for (const p of parts) {
      let mat = p.material;
      if (!mat.userData.warmed) {
        mat = mat.clone();
        mat.color = mat.color.clone().multiply(new THREE.Color(0xfff0d8));
        mat.userData.warmed = true;
      }
      g.add(new THREE.Mesh(p.geometry, mat));
    }
    g.position.set(x, y, z);
    g.rotation.y = rotY;
    g.scale.setScalar(scale);
    this.root.add(g);
    return g;
  }

  /** One draw call for a repeated static prop. */
  addInstanced(geo, material, spots, outline = true) {
    const mesh = new THREE.InstancedMesh(geo, material, spots.length);
    const m = new THREE.Matrix4();
    spots.forEach(([x, y, z, s = 1], i) => {
      m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.root.add(mesh);

    if (outline) {
      const edge = new THREE.InstancedMesh(
        geo,
        new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide }),
        spots.length
      );
      spots.forEach(([x, y, z, s = 1], i) => {
        m.compose(new THREE.Vector3(x, y, z), new THREE.Quaternion(),
          new THREE.Vector3(s * 1.07, s * 1.05, s * 1.07));
        edge.setMatrixAt(i, m);
      });
      edge.instanceMatrix.needsUpdate = true;
      this.root.add(edge);
    }
    return mesh;
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

    this.root.add(this.plain(160, 160, C.paperShade, 0, -0.06, 10));

    // tarmac apron under the operational area
    this.root.add(this.plain(56, 28, C.road, 22.5, -0.02, 10.5));
    this.root.add(this.plain(56, 5.6, C.paper, 22.5, 0.0, -3.4));

    // three lanes: road strips with a coloured kerb stripe
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      this.root.add(this.plain(50, 4.9, C.road, 23, 0.01, y));
      for (const dz of [-2.45, 2.45]) {
        this.root.add(this.plain(50, 0.06, 0xb9b6ad, 23, 0.02, y + dz));
      }
      // a single coloured line keeps the class readable without painting the road
      this.root.add(this.plain(50, 0.12, CLS_COLOR[id], 23, 0.021, y + 2.2));
      // lane names live in the HTML counters; painted kerbs carry the colour
    }

    // approach road in front
    this.root.add(this.plain(64, 6, C.road, 21, 0.012, 25.4));
    for (let x = -8; x < 52; x += 4.4) {
      this.root.add(this.plain(2.2, 0.16, C.roadEdge, x, 0.022, 25.4));
    }

    this._buildBuffer();
    this._buildBays();
    this._buildTerminal();
    this._buildTrees();
    this._buildFurniture();
    this._buildPools();

    this._buildBayCanopy();
    this._buildMarkings();
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

  /** The waiting area: a lighter apron with painted slots, so taxis queue on
   *  something rather than an empty grey rectangle. */
  _buildBuffer() {
    const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const lines = [];
    const floors = [];

    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      floors.push(this.plain(11.5, 5.0, 0x76808c, 7.0, 0.008, y));

      for (let i = 0; i < 24; i++) {
        const [bx, bz] = bufferPos(id, i);
        // two short strokes per slot read as a painted parking bay
        lines.push([bx - 0.42, 0.02, bz - 0.3], [bx + 0.42, 0.02, bz - 0.3]);
        lines.push([bx - 0.42, 0.02, bz + 0.3], [bx + 0.42, 0.02, bz + 0.3]);
      }
    }

    this.addInstanced(new THREE.BoxGeometry(0.84, 0.02, 0.05), flat(0xd8dee6), lines);

    const tag = this.label("WAITING AREA", "#2f3a45", 0.34);
    tag.position.set(7.0, 0.9, -3.2);
    this.root.add(tag);
  }

  _buildBays() {
    const spots = [];
    this.bayIndex = [];
    for (const gid of this.meta.groups) {
      const id = ["urban", "nt", "prebook", "pool"].indexOf(gid);
      if (id < 0) continue;
      baySlots(id).forEach(([x, z], i) => {
        spots.push([x, 0.04, z]);
        this.bayIndex.push({ id, idx: i });
      });
    }
    if (!spots.length) return;

    const geo = new THREE.BoxGeometry(1.9, 0.08, 1.0);
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, spots.length);
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(spots.length * 3), 3);
    const m = new THREE.Matrix4();
    const c = new THREE.Color();
    spots.forEach(([x, y, z], i) => {
      m.makeTranslation(x, y, z);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, c.setHex(0xe8e3d6));
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.instanceColor.needsUpdate = true;
    this.root.add(mesh);
    this.bayMesh = mesh;
  }

  _buildTerminal() {
    const T = TERMINAL;

    // main hall: a long block with a coloured roof
    const kit = null;
    if (kit && kit.length) {
      // three kit buildings form the terminal frontage
      [[7, 5.4], [22, 6.0], [37, 5.2]].forEach(([x, h], i) => {
        this.addModel(kit[i % kit.length], x, T.y - 4.5, 0, h / 5, 0);
      });
    } else {
      const hall = this.box(40, 4.1, 6, C.paper);
      hall.position.set(22, 2.05, T.y - 3.0);
      this.root.add(hall);
      const roof = this.box(41, 0.45, 6.6, C.paper);
      roof.position.set(22, 4.32, T.y - 3.0);
      this.root.add(roof);
      for (const y of [1.3, 3.0]) {
        const band = this.box(38, 0.75, 0.1, C.glass);
        band.position.set(22, y, T.y + 0.05);
        this.root.add(band);
      }
    }

    // recessed entrance
    const recess = this.box(9.0, 3.0, 2.6, 0x3a4652);
    recess.position.set(17.6, 1.5, T.y - 0.6);
    this.root.add(recess);
    for (let i = 0; i < 2; i++) {
      const step = this.box(9.4 - i * 0.5, 0.16, 0.6, C.paperShade);
      step.position.set(17.6, 0.08 + i * 0.16, T.y + 1.3 + i * 0.55);
      this.root.add(step);
    }

    // entrance canopy
    const canopy = this.box(13, 0.3, 3.2, C.accent2);
    canopy.position.set(17.6, 3.3, T.y + 2.2);
    this.root.add(canopy);
    for (const x of [11.6, 23.6]) {
      const col = this.box(0.5, 3.3, 0.5, C.paperShade);
      col.position.set(x, 1.65, T.y + 4.4);
      this.root.add(col);
    }

    // sign board above the entrance
    const board = this.box(11, 1.2, 0.25, C.paper);
    board.position.set(17.6, 5.35, T.y - 0.2);
    this.root.add(board);
    const sign = this.label("HUANGGANG PORT", "#22303c", 0.58);
    sign.position.set(17.6, 5.35, T.y + 0.02);
    this.root.add(sign);

    // skyline: kit buildings if they loaded, simple blocks otherwise
    const skyline = null;
    if (skyline && skyline.length) {
      const row1 = [[1, -13.5, 6.4], [11, -15, 5.2], [21, -13, 6.8], [32, -14.5, 5.6], [43, -13.5, 6.2]];
      row1.forEach(([x, z, h], i) => this.addModel(skyline[i % skyline.length], x, z, 0, h / 5, 0));
      const row2 = [[6, -22, 8.5], [20, -23, 7.4], [34, -21.5, 9.2], [47, -22.5, 7.0]];
      row2.forEach(([x, z, h], i) => this.addModel(skyline[(i + 1) % skyline.length], x, z, 0, h / 5, 0));
    } else {
      const blocks = [
        [-6, 7, C.paper], [4, 9, C.accent2], [14, 6, C.paper],
        [30, 8, C.accent2], [42, 10, C.paper], [52, 7, C.paper],
      ];
      for (const [x, h, roofColor] of blocks) {
        const b = this.box(9, h, 8, C.paper);
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
  }

  /** A roof over the pickup bays, so the rank reads as infrastructure. */
  _buildBayCanopy() {
    const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });
    const posts = [];
    for (const x of [35.0, 41.0]) {
      for (let z = 2; z <= 21; z += 4.5) posts.push([x, 2.0, z]);
    }
    this.addInstanced(new THREE.BoxGeometry(0.2, 4.0, 0.2), flat(0xe9e4d6), posts);

    const roof = this.box(5.4, 0.2, 19, C.paper);
    roof.position.set(38.0, 4.3, 11.5);
    this.root.add(roof);

    // coloured fascia so the roof reads as a structure, not a blank card
    const trim = this.box(6.6, 0.4, 0.3, C.accent2);
    trim.position.set(38.0, 4.2, 1.6);
    this.root.add(trim);
    const trim2 = this.box(6.6, 0.4, 0.3, C.accent2);
    trim2.position.set(38.0, 4.2, 21.4);
    this.root.add(trim2);

    // chevrons on the tarmac leading into the bays
    const marks = [];
    for (let z = 2; z <= 21; z += 3.2) marks.push([32.4, 0.02, z]);
    this.addInstanced(new THREE.BoxGeometry(0.9, 0.02, 0.16), flat(0xd8dee6), marks);

    const tag = this.label("PICKUP BAYS", "#2f3a45", 0.34);
    tag.position.set(38.2, 3.9, -0.6);
    this.root.add(tag);
  }

  /** Extra ground detail so the apron is not a blank grey field. */
  _buildMarkings() {
    const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

    // pedestrian crossing between the terminal and the rank
    const stripes = [];
    for (let z = -0.2; z <= 22; z += 1.6) stripes.push([30.2, 0.02, z]);
    this.addInstanced(new THREE.BoxGeometry(1.6, 0.02, 0.8), flat(0xe8eef5), stripes);

    // a taxi rank arrow painted on each lane approach
    const arrows = [];
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      for (const x of [15.5, 18, 20.5]) arrows.push([x, 0.02, y]);
    }
    this.addInstanced(new THREE.BoxGeometry(1.1, 0.02, 0.9), flat(0xdfe6ee), arrows);

    // curb along the frontage
    const kerb = this.box(52, 0.22, 0.4, C.paperShade);
    kerb.position.set(22, 0.11, -0.9);
    this.root.add(kerb);
  }

  _buildTrees() {
    const spots = [
      [-6, 4], [-6, 14], [-6, 24], [-6, 32],
      [50, 4], [50, 14], [50, 24], [50, 32],
      [-2, -10], [12, -10], [26, -10], [40, -10],
      [56, -10], [10, 34], [34, 34], [46, 34],
    ];
    const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

    this.addInstanced(new THREE.CylinderGeometry(0.16, 0.2, 1.0, 6), flat(C.ink),
      spots.map(([x, z]) => [x, 0.5, z]));
    this.addInstanced(new THREE.ConeGeometry(0.8, 1.4, 7), flat(0xf6f5f0),
      spots.map(([x, z]) => [x, 1.55, z]));
    this.addInstanced(new THREE.ConeGeometry(0.58, 1.0, 7), flat(0xffffff),
      spots.map(([x, z]) => [x, 2.2, z]));
    this.addInstanced(new THREE.CircleGeometry(0.95, 10),
      new THREE.MeshBasicMaterial({ color: 0x1d2a24, transparent: true, opacity: 0.14, depthWrite: false }),
      spots.map(([x, z]) => [x, 0.02, z]));
  }

  _buildFurniture() {
    const flat = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

    // benches + bins along the frontage
    const benchX = [];
    for (let x = 4; x <= 44; x += 8) benchX.push(x);
    this.addInstanced(new THREE.BoxGeometry(1.7, 0.14, 0.55), flat(0xb98a5e),
      benchX.map((x) => [x, 0.42, -1.4]));
    this.addInstanced(new THREE.BoxGeometry(1.7, 0.5, 0.12), flat(0xb98a5e),
      benchX.map((x) => [x, 0.72, -1.66]));
    this.addInstanced(new THREE.CylinderGeometry(0.2, 0.18, 0.6, 8), flat(0x3f8f5a),
      benchX.map((x) => [x + 2.5, 0.3, -1.2]));

    // lamp posts
    const lamps = [];
    for (const x of [10, 22, 34]) for (const z of [2.2, 12, 21]) lamps.push([x, z]);
    this.addInstanced(new THREE.BoxGeometry(0.12, 2.6, 0.12), flat(0x8d98a5),
      lamps.map(([x, z]) => [x, 1.3, z]));
    this.addInstanced(new THREE.BoxGeometry(0.34, 0.2, 0.34), flat(0xfff3c4),
      lamps.map(([x, z]) => [x, 2.68, z]));

    // queue railings
    const rail = [];
    for (const id of [0, 1, 2]) {
      const y = LANES[CLS[id]];
      for (const dz of [-2.15, 2.15]) {
        for (let x = 12.8; x <= 24; x += 2.8) rail.push([x, y + dz]);
      }
    }
    this.addInstanced(new THREE.BoxGeometry(0.07, 0.7, 0.07), flat(0x9aa6b2),
      rail.map(([x, z]) => [x, 0.35, z]));
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
    this.taxiRoof = this._pool(new THREE.BoxGeometry(0.52, 0.3, 0.5), mat(C.paper), TAXI_CAP);
    this.taxiDark = this._pool(new THREE.BoxGeometry(1.02, 0.12, 0.58), mat(C.ink), TAXI_CAP);
    this.taxiShadow = this._pool(new THREE.CircleGeometry(0.55, 12), new THREE.MeshBasicMaterial({
      color: 0x1d2a24, transparent: true, opacity: 0.18, depthWrite: false,
    }), TAXI_CAP);
    this.taxiShadow.geometry.rotateX(-Math.PI / 2);

    // ink silhouette for the taxi body
    this.taxiEdge = this._pool(
      new THREE.BoxGeometry(1.0, 0.34, 0.56),
      new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide }),
      TAXI_CAP
    );

    // person: coloured body + skin head
    this.paxMesh = [0, 1, 2].map((c) =>
      this._pool(new THREE.BoxGeometry(0.34, 0.44, 0.28), mat(CLS_COLOR[c]), PAX_CAP)
    );
    this.paxHead = this._pool(new THREE.BoxGeometry(0.26, 0.26, 0.26), mat(0xf0c39a), PAX_CAP);
    this.paxShadow = this._pool(new THREE.CircleGeometry(0.16, 10), new THREE.MeshBasicMaterial({
      color: 0x1d2a24, transparent: true, opacity: 0.16, depthWrite: false,
    }), PAX_CAP);
    this.paxShadow.geometry.rotateX(-Math.PI / 2);

    this.paxEdge = this._pool(
      new THREE.BoxGeometry(0.34, 0.44, 0.28),
      new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide }),
      PAX_CAP
    );
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
      e.parked = state === 2;
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
        // at a bay the taxi squares up to the kerb instead of keeping its
        // approach angle (that was reading as a car park)
        const yaw = e.parked && dist < 1.2 ? 0 : Math.atan2(dz, dx);
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
      m.compose(new THREE.Vector3(e.x, 0.3, e.z), q, new THREE.Vector3(1.05, 1.08, 1.06));
      this.taxiEdge.setMatrixAt(n, m);
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
    for (const mesh of [this.taxiShell, this.taxiRoof, this.taxiDark, this.taxiShadow, this.taxiEdge]) {
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

      m.compose(new THREE.Vector3(e.x, 0.22 + bob, e.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
      this.paxMesh[c].setMatrixAt(i, m);
      m.compose(new THREE.Vector3(e.x, 0.22 + bob, e.z), new THREE.Quaternion(),
        new THREE.Vector3(s * 1.06, s * 1.08, s * 1.06));
      this.paxEdge.setMatrixAt(total, m);
      m.compose(new THREE.Vector3(e.x, 0.58 + bob, e.z), new THREE.Quaternion(), new THREE.Vector3(s, s, s));
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
    this.paxEdge.count = total;
    this.paxEdge.instanceMatrix.needsUpdate = true;
    this.paxHead.count = total;
    this.paxHead.instanceMatrix.needsUpdate = true;
    this.paxShadow.count = total;
    this.paxShadow.instanceMatrix.needsUpdate = true;

    /* bay glow: occupied bays lift slightly */
    if (this.bayMesh && this.metaFrame) {
      const occupied = new Set();
      for (const row of this.metaFrame.tx) if (row[2] === 2) occupied.add(`${row[4]}:${row[5]}`);
      const c = new THREE.Color();
      this.bayIndex.forEach((b, i) => {
        this.bayMesh.setColorAt(i, c.setHex(occupied.has(`${b.id}:${b.idx}`) ? 0xffe9a8 : 0xe8e3d6));
      });
      this.bayMesh.instanceColor.needsUpdate = true;
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
