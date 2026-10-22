/**
 * Runs simulation batches off the main thread.
 *
 * The policy effect chips need ~120 full-day simulations after every change;
 * on a phone that is several seconds of CPU. Doing it here keeps the map at
 * 60fps while the numbers are being worked out.
 */
import { runSimulation } from "./sim.js";

self.onmessage = (e) => {
  const { id, jobs } = e.data;
  try {
    const values = jobs.map(({ cfg, seed }) => {
      const m = runSimulation(cfg, seed).metrics;
      return Number.isFinite(m.waitMeanInclAbandon) ? m.waitMeanInclAbandon : null;
    });
    self.postMessage({ id, values });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message ? err.message : err) });
  }
};
