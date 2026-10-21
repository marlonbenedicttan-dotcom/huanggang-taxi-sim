import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
await p.evaluate(() => window.__sim.settle?.(4));
const r = await p.evaluate(() => {
  const s = window.__sim.scene;
  const arr = s.taxiShell?.instanceMatrix?.array || [];
  return {
    taxis: s.taxis.size, people: s.people.size,
    shellCount: s.taxiShell?.count, paxCount: s.paxMesh?.[0]?.count,
    firstTaxi: [arr[12], arr[13], arr[14]].map(v => +Number(v).toFixed(1)),
    camera: s.camera.position.toArray().map(v => +v.toFixed(0)),
    zoom: s.camera.zoom,
    frustum: [s.camera.left, s.camera.right, s.camera.top, s.camera.bottom],
  };
});
console.log(JSON.stringify(r, null, 1));
await b.close();
