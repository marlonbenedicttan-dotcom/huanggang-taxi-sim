import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
p.on("console", m => console.log(m.type().toUpperCase(), m.text().slice(0,150)));
await p.goto("http://localhost:8010/proto-pixel.html", { waitUntil: "networkidle" });
await p.waitForTimeout(1500);
console.log(await p.evaluate(async () => {
  const m = await import("./js/sim.js");
  const r = m.runSimulation({ anim: { from: 30, to: 75, step: 0.08 } }, 7);
  return { frames: r.frames.length, hasTx: !!r.frames[0]?.tx, t: r.frames[0]?.t };
}));
await b.close();
