import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);

const play = await p.evaluate(() => {
  const r = document.querySelector(".playback").getBoundingClientRect();
  return { right: Math.round(r.right), width: Math.round(r.width), vw: innerWidth };
});
console.log("playback:", JSON.stringify(play));

await p.click("#sheetToggle");
await p.waitForTimeout(500);

// watch card positions while the background calculation runs
const spots = [];
for (let i = 0; i < 8; i++) {
  await p.waitForTimeout(400);
  spots.push(await p.evaluate(() => {
    const c = document.querySelector(".card-item");
    const h = document.getElementById("sheetToggle");
    const rb = document.querySelector(".runbar");
    return [Math.round(c.getBoundingClientRect().top), Math.round(h.getBoundingClientRect().top),
            Math.round(rb.getBoundingClientRect().top)];
  }));
}
const tops = spots.map(s => s[0]);
console.log("card tops over 3.2s:", tops.join(","), "| stable:", new Set(tops).size === 1);
console.log("handle top (sticky):", spots.map(s => s[1]).join(","));
console.log("runbar top:", spots.map(s => s[2]).join(","));

// scroll the sheet and confirm the handle is still reachable
await p.evaluate(() => { const el = document.getElementById("panel"); el.scrollTop = el.scrollHeight; });
await p.waitForTimeout(400);
console.log("handle after scroll:", await p.evaluate(() => {
  const r = document.getElementById("sheetToggle").getBoundingClientRect();
  return { top: Math.round(r.top), visible: r.top >= 0 && r.top < innerHeight };
}));
await p.click("#sheetToggle");
await p.waitForTimeout(600);
console.log("sheet closed:", await p.evaluate(() => !document.body.classList.contains("sheet-open")));
console.log("errors:", errs.length ? errs.join(" | ") : "none");
await p.screenshot({ path: "/tmp/mobile_final.png" });
await b.close();
