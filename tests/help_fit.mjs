import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
let fail = 0;
for (const w of [320, 360, 390, 414, 768]) {
  const p = await b.newPage({ viewport: { width: w, height: 740 }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2000);
  const r = await p.evaluate(() => {
    const rect = (s) => { const e = document.querySelector(s); return e ? e.getBoundingClientRect() : null; };
    const hud = rect("#hud"), hb = rect("#helpBtn"), pb = rect("#playBtn");
    return { hudRight: hud && Math.round(hud.right), hbLeft: hb && Math.round(hb.left),
             pbRight: pb && Math.round(pb.right), vw: innerWidth,
             hudVisible: hud && hud.width > 0 };
  });
  const clear = !r.hudVisible || r.hbLeft > r.hudRight + 2;
  if (!clear) fail++;
  console.log(`${w}px  hud.right=${r.hudRight}  ?.left=${r.hbLeft}  pause.right=${r.pbRight}  ${clear ? "ok" : "OVERLAP"}`);
  await p.close();
}
await b.close();
process.exit(fail ? 1 : 0);
