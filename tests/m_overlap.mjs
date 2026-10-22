import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const w of [360, 390]) {
  const p = await b.newPage({ viewport: { width: w, height: 844 }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  const check = () => p.evaluate(() => {
    const box = (s) => { const e = document.querySelector(s); if (!e) return null;
      const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
    const hit = (a, c) => a && c && !(a.r <= c.l || c.r <= a.l || a.b <= c.t || c.b <= a.t);
    const hud = box("#hud"), play = box(".overlay-top"), cam = box("#camCtl"), kpis = box("#kpis"), panel = box("#panel");
    return {
      hudPlay: hit(hud, play), hudCam: hit(hud, cam), playCam: hit(play, cam),
      kpisPanel: hit(kpis, panel), kpisCam: hit(kpis, cam),
    };
  });
  console.log(w, "closed:", JSON.stringify(await check()));
  await p.click("#sheetToggle");
  await p.waitForTimeout(700);
  console.log(w, "open  :", JSON.stringify(await p.evaluate(() => {
    const h = document.getElementById("sheetToggle").getBoundingClientRect();
    const rec = document.querySelector("#recommend").getBoundingClientRect();
    return { handleH: Math.round(h.height), overlapsRec: !(h.bottom <= rec.top || rec.bottom <= h.top) };
  })));
  await p.close();
}
await b.close();
