import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);

const geo = () => p.evaluate(() => {
  const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect();
    return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height), bottom: Math.round(b.bottom) }; };
  return {
    stage: r("#stage"), kpis: r("#kpis"), chart: r("#chartWrap"), panel: r("#panel"),
    playback: r(".playback"), hud: r("#hud"),
    overlapKpiPanel: (() => {
      const k = document.querySelector("#kpis").getBoundingClientRect();
      const s = document.querySelector("#panel").getBoundingClientRect();
      return !(k.bottom <= s.top + 1);
    })(),
  };
});
console.log("closed:", JSON.stringify(await geo()));

await p.click("#sheetToggle");
await p.waitForTimeout(800);
console.log("open  :", JSON.stringify(await geo()));

const scrollable = await p.evaluate(() => {
  const el = document.getElementById("panel");
  el.scrollTop = el.scrollHeight;
  return { canScroll: el.scrollHeight > el.clientHeight + 4, top: el.scrollTop };
});
console.log("scroll:", JSON.stringify(scrollable));

await p.click("#sheetToggle");
await p.waitForTimeout(500);
console.log("closed again:", await p.evaluate(() => ({
  open: document.body.classList.contains("sheet-open"),
  scrollTop: document.getElementById("panel").scrollTop,
})));

const cdp = await p.context().newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });
const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
  requestAnimationFrame(tick);
}));
console.log("fps @6x throttle:", fps, "errors:", errs.length ? errs.join(" | ") : "none");
await b.close();
