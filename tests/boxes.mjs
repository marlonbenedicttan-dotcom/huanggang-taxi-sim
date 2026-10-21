import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
const o = await p.evaluate(() => {
  const box = (s) => { const e = document.querySelector(s); if (!e) return null;
    const r = e.getBoundingClientRect(); return [Math.round(r.top), Math.round(r.bottom), Math.round(r.height)]; };
  return { main: box("main"), stage: box("#stage"), scene: box("#scene"),
           chart: box("#chartWrap"), kpis: box("#kpis"),
           mainBG: getComputedStyle(document.querySelector("main")).background.slice(0, 80) };
});
console.log(JSON.stringify(o, null, 1));
await b.close();
