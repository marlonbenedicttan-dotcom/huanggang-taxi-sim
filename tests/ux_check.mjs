import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 1000 } });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(11000);

const state = () => p.evaluate(() => ({
  active: [...document.querySelectorAll("[data-preset]")].filter(b => b.classList.contains("active")).map(b => b.dataset.preset),
  edited: !document.getElementById("presetEdited").hidden,
  chips: [...document.querySelectorAll(".card-item")].map(i => `${i.querySelector(".t").textContent.slice(0,22)}=${i.querySelector(".eff").textContent}`),
}));

console.log("at load:", JSON.stringify(await state(), null, 0));

await p.evaluate(() => {
  [...document.querySelectorAll(".card-item")].find(i => i.textContent.includes("Digital queue ticket"))
    .querySelector(".card").click();
});
await p.waitForTimeout(300);
console.log("after toggle (preset state):", JSON.stringify(await p.evaluate(() => ({
  active: [...document.querySelectorAll("[data-preset]")].filter(b => b.classList.contains("active")).length,
  edited: !document.getElementById("presetEdited").hidden,
}))));

await p.waitForTimeout(6000);
console.log("chips with ticket ON:", (await state()).chips.join(" | "));

await p.evaluate(() => document.querySelector('[data-preset="baseline"]').click());
await p.waitForTimeout(500);
console.log("after preset click:", JSON.stringify(await p.evaluate(() => ({
  active: [...document.querySelectorAll("[data-preset]")].find(b => b.classList.contains("active"))?.dataset.preset,
  edited: !document.getElementById("presetEdited").hidden,
}))));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await b.close();
