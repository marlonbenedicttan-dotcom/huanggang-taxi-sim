import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1200, height: 800 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:8010/?preset=baseline&t=60&play=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1200);
const snap = () => page.evaluate(() => {
  const s = window.__sim.scene, st = window.__sim.state;
  const first = [...s.people.values()][0];
  return {
    hidden: document.hidden, playing: st.playing, playT: +st.playT.toFixed(2),
    from: st.from, step: st.step, people: s.people.size,
    first: first ? { x: +first.x.toFixed(2), z: +first.z.toFixed(2) } : null,
  };
});
const a = await snap();
await page.waitForTimeout(800);
const c = await snap();
console.log("A:", JSON.stringify(a));
console.log("B:", JSON.stringify(c));
await b.close();
