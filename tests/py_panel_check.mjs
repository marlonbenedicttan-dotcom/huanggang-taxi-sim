import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
let fails = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fails++; };
for (const [w, h, label] of [[390, 844, "phone"], [1500, 950, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 820, hasTouch: w < 820 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2400);
  if (w < 820) { await p.evaluate(() => document.getElementById("sheetToggle").click()); await p.waitForTimeout(500); }
  await p.evaluate(() => { const d = document.getElementById("pyPanel"); d.scrollIntoView({ block: "center" }); d.open = true; });
  await p.waitForTimeout(1200);
  const r = await p.evaluate(() => ({
    open: document.getElementById("pyPanel").open,
    len: document.getElementById("pyCode").textContent.length,
    codeH: Math.round(document.getElementById("pyCode").getBoundingClientRect().height),
    preH: Math.round(document.querySelector(".py-code").getBoundingClientRect().height),
    tabs: [...document.querySelectorAll("[data-py]")].map((b) => b.textContent),
    links: [...document.querySelectorAll(".py-actions a")].map((a) => a.getAttribute("href")),
  }));
  ok(r.open && r.len > 5000, `${label}: engine.py loads (${r.len} chars)`);
  ok(r.preH <= 341 && r.preH > 100, `${label}: code box is bounded (${r.preH}px)`);
  ok(r.tabs.length === 3 && r.links.length === 4, `${label}: tabs and links present`);
  // switch file
  await p.evaluate(() => document.querySelector('[data-py="stats.py"]').click());
  await p.waitForTimeout(700);
  const len2 = await p.evaluate(() => document.getElementById("pyCode").textContent.length);
  ok(len2 > 500 && len2 !== r.len, `${label}: switching files reloads the code (${len2})`);
  // download links resolve
  for (const href of ["py/engine.py", "py/scenarios.py", "py/stats.py"]) {
    const res = await p.request.get(`http://localhost:8010/${href}`);
    ok(res.ok(), `${label}: ${href} downloads (${res.status()})`);
  }
  ok(errs.length === 0, `${label}: no page errors ${errs.join("|")}`);
  await p.close();
}
await b.close();
console.log(fails ? `${fails} FAILED` : "PY PANEL OK");
process.exit(fails ? 1 : 0);
