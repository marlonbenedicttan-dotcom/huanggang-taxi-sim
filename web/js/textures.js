/**
 * Procedural textures — generated on a canvas at runtime so the site stays a
 * dependency-free static bundle (no image downloads, no CDN).
 *
 * Everything is deliberately subtle: the goal is to stop large surfaces from
 * looking like flat paint, not to add visual noise.
 */

import * as THREE from "../vendor/three.module.js";

function make(w, h, draw, { repeat = [1, 1], srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const rnd = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/**
 * Weathered asphalt.
 *
 * Deliberately *only* fine grain: large blotches read as an obvious repeating
 * pattern once the texture is tiled 20+ times across the hall.
 */
export function asphaltTexture(repeat = [22, 18]) {
  return make(256, 256, (g, w, h) => {
    const r = rnd(7);
    g.fillStyle = "#454e5c";
    g.fillRect(0, 0, w, h);

    for (let i = 0; i < 14000; i++) {
      const v = 46 + Math.floor(r() * 44);
      g.fillStyle = `rgba(${v},${v + 4},${v + 11},${0.05 + r() * 0.1})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5);
    }
    // very faint low-contrast mottling, small enough not to tile obviously
    for (let i = 0; i < 26; i++) {
      g.fillStyle = `rgba(28,33,42,${0.015 + r() * 0.02})`;
      g.beginPath();
      g.ellipse(r() * w, r() * h, 6 + r() * 12, 4 + r() * 8, r() * 3, 0, Math.PI * 2);
      g.fill();
    }
  }, { repeat });
}

/** Light concrete for the terminal. */
export function concreteTexture(repeat = [8, 2]) {
  return make(256, 256, (g, w, h) => {
    const r = rnd(19);
    g.fillStyle = "#4a5464";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < 5000; i++) {
      const v = 60 + Math.floor(r() * 50);
      g.fillStyle = `rgba(${v},${v + 6},${v + 16},${0.04 + r() * 0.08})`;
      g.fillRect(r() * w, r() * h, 1 + r() * 2, 1 + r() * 2);
    }
    // panel joints
    g.strokeStyle = "rgba(24,30,40,0.35)";
    g.lineWidth = 2;
    for (let x = 0; x <= w; x += 64) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, h);
      g.stroke();
    }
    for (let y = 0; y <= h; y += 64) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(w, y);
      g.stroke();
    }
  }, { repeat });
}

/** Terminal facade: a grid of windows, a third of them lit. */
export function windowsTexture(repeat = [10, 1]) {
  return make(256, 128, (g, w, h) => {
    const r = rnd(31);
    g.fillStyle = "#212b3a";
    g.fillRect(0, 0, w, h);
    const cols = 8;
    const rows = 3;
    const cw = w / cols;
    const ch = h / rows;
    for (let x = 0; x < cols; x++) {
      for (let y = 0; y < rows; y++) {
        const lit = r() > 0.55;
        g.fillStyle = lit ? `rgba(255,214,150,${0.55 + r() * 0.35})` : "rgba(60,80,105,0.55)";
        g.fillRect(x * cw + 3, y * ch + 3, cw - 6, ch - 6);
      }
    }
    g.strokeStyle = "rgba(16,22,32,0.6)";
    g.lineWidth = 2;
    for (let x = 0; x <= cols; x++) {
      g.beginPath();
      g.moveTo(x * cw, 0);
      g.lineTo(x * cw, h);
      g.stroke();
    }
  }, { repeat });
}

/** Vertical sky gradient used as the scene background. */
export function skyTexture() {
  return make(16, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, "#0a1220");
    grad.addColorStop(0.45, "#14243c");
    grad.addColorStop(0.75, "#22374f");
    grad.addColorStop(1.0, "#2c4257");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

/** Soft radial glow, used for lamp heads (additive). */
export function glowTexture() {
  return make(128, 128, (g, w, h) => {
    const grad = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    grad.addColorStop(0, "rgba(255,240,205,0.95)");
    grad.addColorStop(0.35, "rgba(255,225,170,0.35)");
    grad.addColorStop(1, "rgba(255,220,160,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

/** Painted lane sign (white on dark), used on the hanging boards. */
export function signTexture(text, color = "#e9f2ff") {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 160;
  const g = c.getContext("2d");
  g.fillStyle = "#1b2534";
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = "rgba(120,150,190,0.5)";
  g.lineWidth = 6;
  g.strokeRect(4, 4, c.width - 8, c.height - 8);
  g.font = "700 74px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
  g.fillStyle = color;
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}


/** Soft daytime sky: pale blue at the top, warm haze at the horizon. */
export function daySkyTexture() {
  return make(16, 256, (g, w, h) => {
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0.0, "#b9d8ee");
    grad.addColorStop(0.55, "#d7e8f4");
    grad.addColorStop(1.0, "#eef4f2");
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
  }, { repeat: [1, 1] });
}

/** Puffy cloud billboard (three overlapping blobs). */
export function cloudTexture() {
  return make(256, 128, (g, w, h) => {
    const blob = (cx, cy, r) => {
      const grad = g.createRadialGradient(cx, cy, r * 0.2, cx, cy, r);
      grad.addColorStop(0, "rgba(255,255,255,0.95)");
      grad.addColorStop(0.6, "rgba(255,255,255,0.75)");
      grad.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = grad;
      g.beginPath();
      g.arc(cx, cy, r, 0, Math.PI * 2);
      g.fill();
    };
    blob(90, 74, 46);
    blob(140, 62, 54);
    blob(186, 78, 38);
    blob(64, 82, 30);
  }, { repeat: [1, 1] });
}
