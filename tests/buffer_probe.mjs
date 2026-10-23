import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2600);
console.log(await p.evaluate(() => {
  const s = window.__sim;
  const st = s.state;
  const endT = st.from + st.step * (st.frames.length - 1);
  const i = Math.min(st.frames.length - 1, Math.max(0, Math.round((st.playT - st.from) / st.step)));
  const f = st.frames[i];
  const kpis = [...document.querySelectorAll("#kpis .kpi")].map((k) => k.textContent.trim().replace(/\s+/g, " "));
  return {
    playT: Math.round(st.playT), clock: document.getElementById("clock").textContent,
    frameIndex: i, frames: st.frames.length, from: st.from, to: endT, step: st.step,
    frameBuf: f && f.buf, frameKeys: f ? Object.keys(f).slice(0, 12) : null,
    sceneTaxis: s.scene.taxis.size,
    kpis,
    bufferAvg: st.shownMetrics && st.shownMetrics.bufferAvg,
    bufferMax: st.shownMetrics && st.shownMetrics.bufferMax,
  };
}));
await b.close();
