import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:8010/?preset=smart&window=0&t=60&play=0&compare=1", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const out = await page.evaluate(() => {
  const c = document.querySelector("#scene"), cb = document.querySelector("#sceneB");
  const s = window.__sim.scene;
  const info = (el) => ({
    hidden: el.hidden,
    client: [el.clientWidth, el.clientHeight],
    buf: [el.width, el.height],
    display: getComputedStyle(el).display,
  });
  const stage = document.querySelector("#stage");
  return {
    stageClass: stage.className,
    stageBox: [stage.clientWidth, stage.clientHeight],
    A: info(c),
    B: info(cb),
    sceneA_taxis: s.taxis.size,
    sceneA_people: s.people.size,
    compare: window.__sim.state.compare,
    runA: !!window.__sim.state.runA,
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
