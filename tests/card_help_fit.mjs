import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
let fails = 0;
for (const w of [320, 360, 390, 430]) {
  const p = await b.newPage({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  await p.evaluate(() => document.getElementById("sheetToggle").click());
  await p.waitForTimeout(500);
  const r = await p.evaluate(() => {
    const items = [...document.querySelectorAll(".card-item")];
    const rows = items.map((it) => {
      const card = it.querySelector(".card").getBoundingClientRect();
      const help = it.querySelector(".card-help").getBoundingClientRect();
      const eff = it.querySelector(".eff").getBoundingClientRect();
      return { cardW: Math.round(card.width), helpRight: Math.round(help.right),
               effRight: Math.round(eff.right), effClipped: eff.width < 20 };
    });
    return { rows, panel: Math.round(document.getElementById("panelScroll").getBoundingClientRect().right) };
  });
  const ok = r.rows.every((x) => x.helpRight <= r.panel + 1 && !x.effClipped);
  if (!ok) fails++;
  console.log(w, ok ? "ok" : "FAIL", JSON.stringify(r.rows[0]), "panelRight", r.panel);
  await p.close();
}
await b.close();
process.exit(fails ? 1 : 0);
