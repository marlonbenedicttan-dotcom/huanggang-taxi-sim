import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto("http://localhost:8010/?preset=baseline&t=60&play=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const s = window.__sim.scene, st = window.__sim.state;
  const f = st.frames[Math.round((st.playT - st.from) / st.step)];
  const sample = [...s.people.entries()].slice(0, 6).map(([id, e]) => ({
    id, cls: e.cls, x: +e.x.toFixed(1), z: +e.z.toFixed(1),
    tx: +e.tx.toFixed(1), tz: +e.tz.toFixed(1), leaving: e.leaving,
  }));
  return {
    frame_px: f.px.length, frame_q: f.q,
    people: s.people.size, taxis: s.taxis.size,
    taxiBodyCount: s.taxiBody.count, paxCounts: s.paxMesh.map(m => m.count),
    sample,
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
