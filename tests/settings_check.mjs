/**
 * Does the picture follow the sliders?
 *
 * The renderer is only evidence if a setting change actually changes what is
 * on screen. This drives the real UI, reads the simulation frame the scene is
 * showing, and asserts the crowd and the KPI move in the right direction.
 *
 *   node tests/settings_check.mjs
 */
import { chromium } from "playwright-core";

const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
const errs = [];
p.on("pageerror", (e) => errs.push(e.message));

await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3200);

const snap = () => p.evaluate(() => {
  const s = window.__sim;
  const f = s.state.frames[Math.round((s.state.playT - s.state.from) / s.state.step)];
  const mean = document.querySelector("#kpis")?.textContent || "";
  return {
    demand: s.state.values.paxPerHour,
    q: f ? f.q.reduce((a, v) => a + v, 0) : -1,
    people: s.scene.people.size,
    taxis: s.scene.taxis.size,
    waitText: mean.replace(/\s+/g, " ").trim().slice(0, 40),
  };
});

const before = await snap();

await p.evaluate(() => {
  const el = [...document.querySelectorAll("input[type=range]")][0];
  el.value = "850";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await p.waitForTimeout(2200);
const after = await snap();

const checks = [];
checks.push(["demand applied", after.demand === 850, `${before.demand} -> ${after.demand}`]);
checks.push(["queue grows with demand", after.q > before.q, `${before.q} -> ${after.q} waiting`]);
checks.push(["crowd grows with queue", after.people > before.people, `${before.people} -> ${after.people} people`]);
checks.push(["KPIs recomputed", after.waitText !== before.waitText, after.waitText]);
checks.push(["no page errors", errs.length === 0, errs[0] || "clean"]);

let bad = 0;
for (const [name, ok, detail] of checks) {
  if (!ok) bad++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name.padEnd(28)} ${detail}`);
}
console.log(bad ? `\n${bad} FAILED` : "\nSETTINGS REFLECTED");
await b.close();
process.exit(bad ? 1 : 0);
