import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [w, h, label] of [[390, 844, "390x844"], [360, 740, "360x740"], [430, 932, "430x932"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);
  const r = await p.evaluate(() => {
    const rect = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
    const cv = document.getElementById("scene");
    const g = cv.getContext("2d");
    const d = g.getImageData(0, 0, cv.width, cv.height).data;
    // grass is the dominant colour at the corners
    const at = (x, y) => { const i = (y * cv.width + x) * 4; return [d[i], d[i+1], d[i+2]]; };
    const grass = at(2, 2);
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    const step = 3;
    for (let y = 0; y < cv.height; y += step) {
      for (let x = 0; x < cv.width; x += step) {
        const c = at(x, y);
        const diff = Math.abs(c[0]-grass[0]) + Math.abs(c[1]-grass[1]) + Math.abs(c[2]-grass[2]);
        if (diff > 26) { if (x<minX) minX=x; if (x>maxX) maxX=x; if (y<minY) minY=y; if (y>maxY) maxY=y; }
      }
    }
    const sc = cv.width / cv.getBoundingClientRect().width;
    return {
      vw: innerWidth, vh: innerHeight,
      stage: rect("#stage"), canvas: rect("#scene"), kpis: rect("#kpis"),
      chart: rect("#chartWrap"), panel: rect("#panel"), hud: rect("#hud"),
      buffer: { w: cv.width, h: cv.height },
      ink: { x: Math.round(minX/sc), y: Math.round(minY/sc), r: Math.round(maxX/sc), b: Math.round(maxY/sc) },
      grass,
      gapStageToKpis: rect("#kpis").y - rect("#stage").bottom,
      gapKpisToSheet: rect("#panel").y - rect("#kpis").bottom,
    };
  });
  console.log(label, JSON.stringify(r, null, 1));
  await p.close();
}
await b.close();
