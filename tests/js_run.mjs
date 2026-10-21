/**
 * Headless harness: run the browser engine in Node and print metrics as JSON.
 * Used by tests/parity_check.py to compare against the Python research model.
 *
 *   node tests/js_run.mjs --seeds 1,2,3 [--config cfg.json] [--smart]
 */
import { runSimulation, DEFAULTS, SMART } from "../web/js/sim.js";
import fs from "node:fs";

const args = process.argv.slice(2);
const get = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const seeds = (get("--seeds") || "1,2,3").split(",").map(Number);
const cfgPath = get("--config");
const cfg = cfgPath ? JSON.parse(fs.readFileSync(cfgPath, "utf8")) : { ...DEFAULTS };
if (args.includes("--smart")) Object.assign(cfg, SMART);
if (args.includes("--anim")) {
  cfg.anim = cfg.anim || { from: 60, to: 240, step: 0.25 };
}

const out = seeds.map((s) => {
  const t0 = performance.now();
  const r = runSimulation(cfg, s);
  return { seed: s, ms: +(performance.now() - t0).toFixed(1), metrics: r.metrics, frames: r.frames.length };
});
console.log(JSON.stringify(out, null, 1));
