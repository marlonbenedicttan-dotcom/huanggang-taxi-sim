import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [w, h] of [[390, 844], [360, 740], [430, 932]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  console.log(w, await p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), h: Math.round(b.height), vis: b.height > 0 }; };
    return { panel: r("#panel"), handle: r("#sheetToggle"), status: r("#peekStatus"), presets: r(".presets"),
             run: r("#runBtn"), note: r(".preset-note"), panelBottom: Math.round(document.getElementById("panel").getBoundingClientRect().bottom) };
  }));
  await p.close();
}
await b.close();
