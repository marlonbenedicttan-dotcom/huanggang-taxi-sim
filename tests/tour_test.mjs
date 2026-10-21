import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
page.on("console", m => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });

const t0 = Date.now();
await page.goto("http://localhost:8010/?preset=baseline&play=0&tour=1", { waitUntil: "networkidle" });
console.log("loaded in", Date.now() - t0, "ms");

const state = async (tag) => {
  const s = await page.evaluate(() => ({
    hidden: document.querySelector("#tour").hidden,
    step: document.querySelector("#tourStep").textContent,
    title: document.querySelector("#tourTitle").textContent,
    highlight: [...document.querySelectorAll(".tour-highlight")].map(e => e.id || e.tagName),
    pointer: getComputedStyle(document.querySelector("#tour")).pointerEvents,
    blur: getComputedStyle(document.querySelector("#tour")).backdropFilter,
  }));
  console.log(tag, JSON.stringify(s));
};
await page.waitForTimeout(1600);
await state("before click:");

const t1 = Date.now();
await page.click("#tourNext", { timeout: 5000 }).catch(e => console.log("CLICK FAILED:", e.message.split("\n")[0]));
console.log("click returned in", Date.now() - t1, "ms");
await page.waitForTimeout(500);
await state("after click: ");

// can we still interact with the page behind the overlay?
const blocked = await page.evaluate(() => {
  const el = document.elementFromPoint(700, 450);
  return { topElement: el ? (el.id || el.className || el.tagName) : null };
});
console.log("what is on top at centre:", JSON.stringify(blocked));
await b.close();
