import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on("pageerror", e => console.log("ERR", e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3200);

const snap = () => p.evaluate(() => {
  const s = window.__sim;
  const f = s.state.frames[Math.round((s.state.playT - s.state.from) / s.state.step)];
  return {
    demand: s.state.values.paxPerHour,
    q: f?.q,
    buf: f?.buf,
    taxis: s.scene.taxis.size,
    people: s.scene.people.size,
    kpi: document.querySelector(".kpi b, #kpis b, .stat b")?.textContent,
    mean: document.querySelector("#kpis")?.textContent?.slice(0, 40),
  };
});

const before = await snap();
console.log("before", JSON.stringify(before));

// push demand to 850 through the real slider
await p.evaluate(() => {
  const el = document.querySelector('input[data-key="paxPerHour"]') ||
             [...document.querySelectorAll("input[type=range]")][0];
  el.value = "850";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.waitForTimeout(2000);

const after = await snap();
console.log("after ", JSON.stringify(after));

// toggle the first policy card
await p.evaluate(() => document.querySelector("#policyCards .card, .policy-card")?.click());
await p.waitForTimeout(1800);
const afterPolicy = await snap();
console.log("policy", JSON.stringify(afterPolicy));

await b.close();
