import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2300);
const read = () => p.evaluate(() => ({
  wait: +document.getElementById("heroWait").textContent,
  values: window.__sim.state.values,
  cardOn: [...document.querySelectorAll("#policyCards .card")].map((c) => c.classList.contains("on")),
  labels: [...document.querySelectorAll("#policyCards .card .t")].map((t) => t.textContent),
}));
const before = await read();
await p.click("[data-preset=recommended]");
await p.waitForTimeout(900);
const rec = await read();
console.log("before:", before.wait, "| recommended:", rec.wait);
console.log("backhaul:", rec.values.backhaulMatch, "supply:", rec.values.taxiSupplyRatioUrban, rec.values.taxiSupplyRatioNt);
console.log("cards on:", rec.cardOn.map((v, i) => v ? rec.labels[i] : null).filter(Boolean));
const idx = rec.labels.findIndex((l) => /book the trip back/i.test(l));
await p.evaluate((i) => document.querySelectorAll("#policyCards .card")[i].click(), idx);
await p.waitForTimeout(900);
const off = await read();
console.log("card off ->", off.wait, "backhaul:", off.values.backhaulMatch);
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await b.close();
