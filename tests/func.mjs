import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:8010/?preset=baseline&t=60&play=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const kpi = () => page.evaluate(() => document.querySelectorAll(".kpi-val")[0].textContent.trim());
const before = await kpi();

// 1) auto-apply: move the demand slider without pressing Run
await page.evaluate(() => {
  const el = document.querySelector("#c-paxPerHour");
  el.value = "800";
  el.dispatchEvent(new Event("input", { bubbles: true }));
});
await page.waitForTimeout(1400);
const after = await kpi();

// 2) advanced disclosure
const adv = await page.evaluate(() => {
  const t = document.querySelector("#advancedToggle");
  const hiddenBefore = document.querySelector("#advanced").hidden;
  t.click();
  return { hiddenBefore, hiddenAfter: document.querySelector("#advanced").hidden };
});

// 3) tour next/done
await page.evaluate(() => document.querySelector("#tourNext")?.click());
const tourStep = await page.evaluate(() => document.querySelector("#tourStep")?.textContent);

console.log(JSON.stringify({ before, after, adv, tourStep }, null, 1));
await b.close();
