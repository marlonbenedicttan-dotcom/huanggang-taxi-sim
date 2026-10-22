import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(12000);

console.log("cards:", (await p.evaluate(() =>
  [...document.querySelectorAll(".card-item")].map(i => `${i.querySelector(".t").textContent} ${i.querySelector(".eff").textContent}`))).join(" | "));

await p.evaluate(() => { document.getElementById("valuePanel").open = true; });
await p.waitForTimeout(300);
console.log("\nvalue table:");
console.log(await p.evaluate(() => [...document.querySelectorAll("#valueRows tr")].map(r =>
  [...r.children].map(c => c.textContent.trim()).join(" · ")).join("\n")));

await p.evaluate(() => { document.getElementById("pilotPanel").open = true; });
await p.waitForTimeout(200);
console.log("\npilot (nothing on):", await p.textContent("#pilotRows"));

// switch on the digital ticket
await p.evaluate(() => {
  [...document.querySelectorAll(".card-item")].find(i => i.textContent.includes("Digital queue ticket"))
    .querySelector(".card").click();
});
await p.waitForTimeout(2500);
console.log("pilot (ticket on):", (await p.textContent("#pilotRows")).replace(/\s+/g, " ").trim().slice(0, 120));
console.log("kpi:", (await p.textContent("#kpis")).replace(/\s+/g, " ").trim().slice(0, 60));

// 24-hour window
await p.selectOption("#windowSel", { label: "Full 24 hours (port never closes)" });
await p.waitForTimeout(4000);
console.log("\n24h:", await p.evaluate(() => {
  const s = window.__sim;
  return { frames: s.state.frames.length, hint: document.querySelector("#hint").textContent };
}));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await p.screenshot({ path: "/tmp/full_check.png" });
await b.close();
