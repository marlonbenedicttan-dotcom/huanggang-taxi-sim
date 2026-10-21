/**
 * Scene geometry for the port layout.
 *
 * One shared definition so the 3D scene, the legend and the stats agree.
 * Units are arbitrary but consistent: one taxi is 1.0 x 0.45, and slot spacing
 * is slightly larger than the vehicle footprint so parked taxis never overlap
 * (overlapping boxes used to merge into solid slabs).
 *
 *   x  -> direction of travel (entrance 0 .. exit 46)
 *   y  -> lane offset (urban 4, NT 12, pre-booked 20, flex 25)
 */

export const CLS = ["urban", "nt", "prebook", "flex"];
export const CLS_LABEL = ["Urban (red)", "NT (green)", "Pre-booked", "Flexible"];
export const CLS_COLOR = [0xe0564a, 0x3fa86a, 0x4a90d9, 0xe8a33d];
export const CSS_COLOR = ["#e0564a", "#3fa86a", "#4a90d9", "#e8a33d"];

export const LANES = { urban: 4, nt: 12, prebook: 20, flex: 25 };

export const TAXI = { length: 1.0, height: 0.45, width: 0.52 };

const BUF = { x0: 2.5, dx: 1.12, cols: 8, rows: [-1.9, -0.95, 0, 0.95, 1.9] };
const BUF_FLEX = { x0: 2.5, dx: 1.12, cols: 5, rows: [-0.95, 0, 0.95] };
const QUEUE = { x0: 13.4, dx: 0.8, cols: 12, rows: [-1.65, -0.55, 0.55, 1.65] };
const STAND = { x0: 25.0, dx: 1.12, n: 12 };

const BAY = {
  urban: { x: 40.0, y0: 1.2, dy: 1.45, n: 8 },
  nt: { x: 43.0, y0: 2.8, dy: 1.5, n: 3 },
  prebook: { x: 43.0, y0: 9.4, dy: 1.5, n: 2 },
  pool: { x: 40.0, y0: 0.4, dy: 2.05, n: 11 },
};

export const EXIT_X = 46;
export const MAX_QUEUE_SHOWN = 60;

export function laneY(clsId) {
  return LANES[CLS[clsId]];
}

/** Slot position for a taxi waiting in the buffer zone. */
export function bufferPos(clsId, slot) {
  const flex = clsId === 3;
  const g = flex ? BUF_FLEX : BUF;
  const y0 = LANES[CLS[clsId]];
  const i = Math.min(slot, g.cols * g.rows.length - 1);
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return [g.x0 + col * g.dx, y0 + g.rows[row]];
}

/** Holding lane in front of the pickup bays. */
export function standPos(clsId, slot) {
  const i = Math.min(slot, STAND.n - 1);
  return [STAND.x0 + i * STAND.dx, LANES[CLS[clsId]]];
}

/** Pickup bay platform position (groupId: 0 urban, 1 nt, 2 prebook, 3 pool). */
export function bayPos(groupId, idx) {
  const g = BAY[CLS[groupId]] || BAY.urban;
  return [g.x, g.y0 + Math.min(idx, g.n - 1) * g.dy];
}

/** Queue slot for the i-th waiting party of a class. */
export function queuePos(clsId, i) {
  const col = i % QUEUE.cols;
  const row = Math.floor(i / QUEUE.cols) % QUEUE.rows.length;
  return [QUEUE.x0 + col * QUEUE.dx, LANES[CLS[clsId]] + QUEUE.rows[row]];
}

export function bufferSlots(clsId) {
  const flex = clsId === 3;
  const g = flex ? BUF_FLEX : BUF;
  const cap = flex ? 15 : 40;
  const out = [];
  for (let i = 0; i < cap; i++) out.push(bufferPos(clsId, i));
  return out;
}

export function standSlots(clsId) {
  const out = [];
  for (let i = 0; i < STAND.n; i++) out.push(standPos(clsId, i));
  return out;
}

export function baySlots(groupId) {
  const g = BAY[CLS[groupId]];
  if (!g) return [];
  const out = [];
  for (let i = 0; i < g.n; i++) out.push([g.x, g.y0 + i * g.dy]);
  return out;
}
