import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
page.on("console", m => { if (m.type() === "error") console.log("CONSOLE:", m.text()); });
await page.goto("http://localhost:8010/?preset=smart&window=0&t=60&play=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1000);
const res = await page.evaluate(() => {
  try {
    window.__sim.setCompare(true);
    const s = window.__sim.scene;
    return { ok: true, compare: window.__sim.state.compare,
      stageClass: document.querySelector("#stage").className,
      sceneB: !!document.querySelector("#sceneB"),
      taxis: s.taxis.size };
  } catch (e) {
    return { ok: false, error: String(e), stack: (e.stack || "").split("\n").slice(0, 3) };
  }
});
console.log(JSON.stringify(res, null, 1));
await b.close();
