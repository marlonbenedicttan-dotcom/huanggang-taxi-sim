/**
 * glTF asset pipeline.
 *
 * The visual detail comes from CC0 models (Kenney city / car / nature kits).
 * Two rules keep this at 60 fps on a phone:
 *
 *   1. **Instance everything that repeats.** A GLB becomes a list of
 *      (geometry, material) pairs; each pair gets one InstancedMesh for all
 *      copies. 60 taxis = a handful of draw calls, not 60 clones.
 *   2. **Bake transforms.** Node transforms are baked into the geometry once,
 *      so instancing is a plain matrix write per frame.
 */

import * as THREE from "../vendor/three.module.js";
import { GLTFLoader } from "../vendor/GLTFLoader.js";

const loader = new GLTFLoader();
const cache = new Map();

/** Load one GLB and return its scene graph (cached). */
export function loadGLB(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      new Promise((resolve, reject) => loader.load(url, resolve, undefined, reject))
    );
  }
  return cache.get(url);
}

/**
 * Flatten a loaded model into geometry/material pairs with world transforms
 * applied, ready for instancing.
 */
export function bake(gltf) {
  const root = gltf.scene;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const geometry = o.geometry.clone();
    geometry.applyMatrix4(o.matrixWorld);
    const material = Array.isArray(o.material) ? o.material[0] : o.material;
    material.side = THREE.FrontSide;
    parts.push({ geometry, material });
  });
  return parts;
}

/** Normalise a baked model: centre on X/Z, sit on y = 0, and scale to `size` length. */
export function normalise(parts, { targetLength = null, targetHeight = null, scale = 1, rotateY = 0 } = {}) {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());
  let s = scale;
  if (targetHeight) s = targetHeight / size.y;
  else if (targetLength) s = targetLength / Math.max(size.x, size.z);
  const centre = box.getCenter(new THREE.Vector3());

  const m = new THREE.Matrix4()
    .makeRotationY(rotateY)
    .premultiply(
      new THREE.Matrix4().makeScale(s, s, s)
    );

  const shift = new THREE.Matrix4().makeTranslation(-centre.x, -box.min.y, -centre.z);
  for (const p of parts) {
    p.geometry.applyMatrix4(shift);
    p.geometry.applyMatrix4(m);
    p.geometry.computeBoundingBox();
    p.geometry.computeBoundingSphere();
  }
  return parts;
}

/**
 * Build an instanced renderer for a baked model.
 * Returns { meshes, set(index, matrix), flush(), count }.
 */
export function instances(parts, capacity, parent, { colors = false } = {}) {
  const meshes = parts.map((p) => {
    const mesh = new THREE.InstancedMesh(p.geometry, p.material, capacity);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.count = 0;
    if (colors) {
      mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3);
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    }
    parent.add(mesh);
    return mesh;
  });

  const state = { meshes, count: 0, colors };

  state.set = (i, matrix, color) => {
    for (const mesh of meshes) mesh.setMatrixAt(i, matrix);
    if (colors && color) for (const mesh of meshes) mesh.setColorAt(i, color);
  };
  state.flush = () => {
    for (const mesh of meshes) {
      mesh.count = state.count;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  };
  return state;
}

/** Load + bake + normalise in one go. */
export async function prepare(url, opts) {
  const gltf = await loadGLB(url);
  return normalise(bake(gltf), opts);
}


/**
 * Clone a baked model with its texture hue-rotated.
 * Lets one yellow kit taxi become the red / green / blue Hong Kong classes
 * without downloading two more models.
 */
export function recolor(parts, hueDeg, { saturation = 0.68, lift = 0.04 } = {}) {
  return parts.map((p) => {
    const material = p.material.clone();
    const map = material.map;
    if (map && map.image) {
      const img = map.image;
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      const frame = g.getImageData(0, 0, canvas.width, canvas.height);
      const d = frame.data;
      const h = ((hueDeg % 360) + 360) % 360 / 360;

      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue;
        const r = d[i] / 255, gg = d[i + 1] / 255, b = d[i + 2] / 255;
        const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b);
        const sat = mx === 0 ? 0 : (mx - mn) / mx;
        // whites, greys and tinted glass keep their value; only paint is recoloured
        if (sat < 0.2) continue;
        const lum = (mx + mn) / 2;
        const [rr, g2, b2] = hslToRgb(h, Math.max(sat, saturation), Math.min(0.72, lum + lift));
        d[i] = rr * 255;
        d[i + 1] = g2 * 255;
        d[i + 2] = b2 * 255;
      }

      g.putImageData(frame, 0, 0);
      const tex = new THREE.CanvasTexture(canvas);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.anisotropy = 4;
      material.map = tex;
      material.needsUpdate = true;
    } else {
      material.color.offsetHSL(hueDeg / 360, 0, 0);
    }
    return { geometry: p.geometry, material };
  });
}

function hslToRgb(h, s, l) {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [f(h + 1 / 3), f(h), f(h - 1 / 3)];
}
