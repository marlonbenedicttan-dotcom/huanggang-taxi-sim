import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: 900, height: 600 } });
p.on("console", m => { if (m.type() !== "log") console.log(m.type().toUpperCase()+":", m.text().slice(0,200)); });
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);
console.log(JSON.stringify(await p.evaluate(() => {
  const s = window.__sim.scene;
  return {
    hasAssets: !!s.assets,
    assetKeys: s.assets ? Object.keys(s.assets) : null,
    taxisIsArray: Array.isArray(s.assets?.taxis),
    taxisLen: s.assets?.taxis?.length ?? null,
    instType: Array.isArray(s.taxiInst) ? "array" : typeof s.taxiInst,
    instLen: Array.isArray(s.taxiInst) ? s.taxiInst.length : null,
    counts: Array.isArray(s.taxiInst) ? s.taxiInst.map(t => t.count) : null,
    shellCount: s.taxiShell?.count ?? null,
  };
}), null, 1));
await b.close();
