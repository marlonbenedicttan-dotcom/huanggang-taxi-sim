import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

const cdp = await p.context().newCDPSession(p);
await cdp.send("Emulation.setCPUThrottlingRate", { rate: 6 });

const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  function tick() { n++; if (performance.now() - t0 < 2500) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
  requestAnimationFrame(tick);
}));
console.log("fps @6x CPU throttle:", fps);

// interaction pass on touch
const tap = async (sel) => { const el = await p.$(sel); if (el) { await el.tap(); } };
await tap("#sheetToggle");
await p.waitForTimeout(500);
await tap(".card-item .card");
await p.waitForTimeout(1200);
await tap("#runBtn");
await p.waitForTimeout(1500);
await tap("#applyRec");
await p.waitForTimeout(1500);
console.log("after taps:", await p.evaluate(() => ({
  ticket: window.__sim.state.values.ticketDelayMin,
  preset: [...document.querySelectorAll("[data-preset]")].find(b => b.classList.contains("active"))?.dataset.preset,
  kpi: document.querySelector("#kpis").textContent.replace(/\s+/g, " ").slice(0, 34),
  sheet: document.body.classList.contains("sheet-open"),
})));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await p.screenshot({ path: "/tmp/m_taps.png" });
await b.close();
