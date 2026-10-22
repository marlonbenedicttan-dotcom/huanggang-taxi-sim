/**
 * Pixel art for the 2.5D scene.
 *
 * Every sprite is authored as a character grid plus a palette map. That is the
 * whole art pipeline: no external images, no atlas, nothing to download. It
 * also means the look is deliberate — the proportions below are hand-placed,
 * not sampled from a model.
 *
 * Conventions
 *   '.' = transparent
 *   one character = one pixel of the 640x360 internal buffer
 *   entities are anchored at their feet (bottom centre)
 */

/* ------------------------------------------------------------------ *
 * Palette — warm, limited, Stardew-ish: saturated greens, cream stone,
 * terracotta roofs, and three strongly separated livery colours.
 * ------------------------------------------------------------------ */
export const PAL = {
  ink: "#2a2018",
  white: "#fbf7ec",
  cream: "#f3e7cf",
  stone: "#d8cfbd",
  stoneDark: "#bcb2a0",
  stoneLight: "#e9e1d2",

  grass: "#6f9c55",
  grassDark: "#638d4b",
  grassLight: "#7dab60",

  road: "#6f7379",
  roadDark: "#63676d",
  roadLine: "#e8e2ce",

  roof: "#a4553f",
  roofLight: "#bd6a4f",
  roofDark: "#7d3d2d",

  wall: "#f0dfc0",
  wallShade: "#d9c6a4",
  window: "#4d7186",
  windowLit: "#7ba7b8",
  door: "#33424e",

  trunk: "#6b4a30",
  leaf: "#3f7a44",
  leafLight: "#54975a",
  leafDark: "#2f5f34",

  skin: "#f0c49a",
  hair: "#3b2a1d",
  trouser: "#3d4257",
  shoe: "#2b2620",

  taxiRoof: "#f7f3e8",
  glass: "#4d6472",
  tyre: "#2f2b27",
};

export const LIVERY = {
  urban: "#d94a3d",
  nt: "#2b9b71",
  prebook: "#3a78c2",
  flex: "#d9952f",
};

/* ------------------------------------------------------------------ *
 * Sprite builder
 * ------------------------------------------------------------------ */
function make(rows, map) {
  const h = rows.length;
  const w = rows[0].length;
  for (const r of rows) {
    if (r.length !== w) throw new Error(`ragged sprite row: ${r.length} != ${w}`);
  }
  const cv = document.createElement("canvas");
  cv.width = w;
  cv.height = h;
  const g = cv.getContext("2d");
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = map[rows[y][x]];
      if (!c) continue;
      g.fillStyle = c;
      g.fillRect(x, y, 1, 1);
    }
  }
  return cv;
}

/* ------------------------------------------------------------------ *
 * People — 7x12, big head, readable silhouette at full zoom-out.
 * Three frames: step-left, stand, step-right.
 * ------------------------------------------------------------------ */
const PERSON_TOP = [
  ".hh..",
  "hhhh.",
  ".fff.",
  ".ccc.",
  "ccccc",
];

const PERSON_LEGS = [
  [".k.k.", ".s.s."],
  ["..kk.", ".ss.s"],
  ["k...k", "s...s"],
];

function personFrames(shirt) {
  const map = {
    h: PAL.hair,
    f: PAL.skin,
    c: shirt,
    k: PAL.trouser,
    s: PAL.shoe,
    ".": null,
  };
  return PERSON_LEGS.map((legs) => make([...PERSON_TOP, ...legs], map));
}

/* ------------------------------------------------------------------ *
 * Taxis — 14x8 side view. Hong Kong liveries: red, green, blue.
 * ------------------------------------------------------------------ */
const TAXI_BODY = [
  "..wwwwwwwwww..",
  ".wwwwwwwwwwww.",
  ".ppggggggggpp.",
  "pppppppppppppp",
  "pppppppppppppp",
  "pppppppppppppp",
  "..dd....dd....",
  "..dd....dd....",
];

function taxiSprite(paint) {
  return make(TAXI_BODY, {
    w: PAL.taxiRoof,
    p: paint,
    g: PAL.glass,
    d: PAL.tyre,
    ".": null,
  });
}

/* ------------------------------------------------------------------ *
 * Props
 * ------------------------------------------------------------------ */
const TREE = [
  ".....gggggg.....",
  "...gggggggggg...",
  "..ggllllllgggg..",
  ".gggllllllllggg.",
  ".gggllllllllggg.",
  "ggggllllllllgggg",
  ".gggggggggggggg.",
  "..gggggggggggg..",
  "...gggggggggg...",
  ".....gggggg.....",
  "......tttt......",
  "......tttt......",
  "......tttt......",
  "......tttt......",
  ".....tttttt.....",
];

const BUSH = [
  "...gggg...",
  ".ggllllgg.",
  "ggllllllgg",
  "ggllllllgg",
  ".gggggggg.",
];

const BENCH = [
  "cccccccccccc",
  "............",
  "cccccccccccc",
  "d..........d",
  "d..........d",
];

const BIN = [
  ".dddd.",
  "dddddd",
  ".llll.",
  ".llll.",
  ".llll.",
  ".llll.",
  ".dddd.",
];

const LAMP = [
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  ".w.",
  "www",
];

const SIGNPOST = [
  "cccccccccc",
  "cwwwwwwwwc",
  "cwwwwwwwwc",
  "cccccccccc",
  "....dd....",
  "....dd....",
  "....dd....",
  "....dd....",
  "....dd....",
];

/** Neutral clothing, so a 100-person queue looks like people, not a colour block. */
const CROWD = ["#77808c", "#8a7159", "#5f6b7a", "#9a917f", "#6f7a6b"];

export const SPR = {
  crowd: CROWD.map((c) => personFrames(c)),
  person: {
    urban: personFrames(LIVERY.urban),
    nt: personFrames(LIVERY.nt),
    prebook: personFrames(LIVERY.prebook),
    flex: personFrames(LIVERY.flex),
  },
  taxi: {
    urban: taxiSprite(LIVERY.urban),
    nt: taxiSprite(LIVERY.nt),
    prebook: taxiSprite(LIVERY.prebook),
    flex: taxiSprite(LIVERY.flex),
  },
  tree: make(TREE, { g: PAL.leaf, l: PAL.leafLight, t: PAL.trunk, ".": null }),
  bush: make(BUSH, { g: PAL.leaf, l: PAL.leafLight, ".": null }),
  bench: make(BENCH, { c: "#a67c4e", d: PAL.tyre, ".": null }),
  bin: make(BIN, { d: "#5a6a5e", l: "#7c8f80", ".": null }),
  lamp: make(LAMP, { w: "#9aa3a8", ".": null }),
  sign: make(SIGNPOST, { c: "#3d4a55", w: PAL.white, d: "#7a8288", ".": null }),
};

/* ------------------------------------------------------------------ *
 * 3x5 bitmap font — the in-world signage. Crisp at 1x, no webfont.
 * ------------------------------------------------------------------ */
const GLYPHS = {
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["#.#", "###", "###", "###", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".#."],
  V: ["#.#", "#.#", "#.#", ".#.", ".#."],
  W: ["#.#", "#.#", "###", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  0: ["###", "#.#", "#.#", "#.#", "###"],
  1: [".#.", "##.", ".#.", ".#.", "###"],
  2: ["##.", "..#", ".#.", "#..", "###"],
  3: ["##.", "..#", ".#.", "..#", "##."],
  4: ["#.#", "#.#", "###", "..#", "..#"],
  5: ["###", "#..", "##.", "..#", "##."],
  6: [".##", "#..", "###", "#.#", "###"],
  7: ["###", "..#", ".#.", ".#.", ".#."],
  8: ["###", "#.#", "###", "#.#", "###"],
  9: ["###", "#.#", "###", "..#", "##."],
  " ": ["...", "...", "...", "...", "..."],
  "-": ["...", "...", "###", "...", "..."],
  ".": ["...", "...", "...", "...", ".#."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "'": [".#.", ".#.", "...", "...", "..."],
};

/** Width in pixels of `text` at the given scale. */
export function textWidth(text, scale = 1) {
  return (text.length * 4 - 1) * scale;
}

/**
 * Draw pixel text. Returns the width drawn.
 * `align` is "left" | "center" | "right".
 */
export function drawText(g, text, x, y, colour, scale = 1, align = "left") {
  const t = String(text).toUpperCase();
  const w = textWidth(t, scale);
  let cx = align === "center" ? Math.round(x - w / 2) : align === "right" ? Math.round(x - w) : Math.round(x);
  g.fillStyle = colour;
  for (const ch of t) {
    const glyph = GLYPHS[ch];
    if (glyph) {
      for (let gy = 0; gy < 5; gy++) {
        const row = glyph[gy];
        for (let gx = 0; gx < 3; gx++) {
          if (row[gx] === "#") g.fillRect(cx + gx * scale, y + gy * scale, scale, scale);
        }
      }
    }
    cx += 4 * scale;
  }
  return w;
}
