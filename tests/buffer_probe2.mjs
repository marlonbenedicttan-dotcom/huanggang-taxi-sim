import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2600);
console.log(await p.evaluate(() => {
  const st = window.__sim.state;
  const i = Math.min(st.frames.length - 1, Math.round((st.playT - st.from) / st.step));
  const f = st.frames[i];
  const tx = f.tx || [];
  const by = {};
  for (const t of tx) by[t.s || t.status || "?"] = (by[t.s || t.status || "?"] || 0) + 1;
  return { buf: f.buf, busy: f.busy, txCount: tx.length, byStatus: by, sample: tx.slice(0, 4),
           scene: [...window.__sim.scene.taxis.values()].map((e) => ({ st: e.state, exiting: e.exiting })).slice(0, 25) };
}));
await b.close();
