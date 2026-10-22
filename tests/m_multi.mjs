import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.click("#sheetToggle");
await p.waitForTimeout(500);

for (const label of ["Digital queue ticket", "Cross-boundary taxi quota", "Two extra stands"]) {
  await p.evaluate((l) => {
    const item = [...document.querySelectorAll(".card-item")].find(i => i.textContent.includes(l));
    item.querySelector(".card").click();
  }, label);
  await p.waitForTimeout(400);
}
console.log(await p.evaluate(() => ({
  sheetOpen: document.body.classList.contains("sheet-open"),
  on: [...document.querySelectorAll(".card-item")]
        .filter(i => i.querySelector(".card").classList.contains("on"))
        .map(i => i.querySelector(".t").textContent.trim()),
  ticket: window.__sim.state.values.ticketDelayMin,
  supply: window.__sim.state.values.taxiSupplyRatioUrban,
  stands: window.__sim.state.values["stands.urban"],
})));
const r = (sel) => p.evaluate((s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect();
  return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; }, sel);
console.log("playback:", JSON.stringify(await r(".playback")), "hud:", JSON.stringify(await r("#hud")));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await b.close();
