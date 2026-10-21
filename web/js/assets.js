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
