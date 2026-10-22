import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 1500, height: 950 } });
p.on("pageerror", e => console.log("ERR", e.message));
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3500);
await p.evaluate(() => {
  const s = window.__sim.scene;
  s.cam.zoom = 2.4;
  s.cam.x = 300;   // buffer coords over the queue
  s.cam.y = 150;
  s._clampCam();
});
await p.waitForTimeout(600);
await p.screenshot({ path: "/tmp/cam_zoom.png" });
await b.close();
console.log("ok");
