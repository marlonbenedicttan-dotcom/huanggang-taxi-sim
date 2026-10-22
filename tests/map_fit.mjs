import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
for (const [w, h, label] of [[390, 844, "phone"], [1500, 950, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 820, hasTouch: w < 820 });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2400);
  console.log(label, await p.evaluate(() => {
    const s = window.__sim.scene;
    const cw = s.canvas.width, ch = s.canvas.height;
    const bw = s.view.W * s.scale, bh = s.view.H * s.scale;
    return { buffer: s.view, cw, ch, scale: +s.scale.toFixed(3),
             drawnW: Math.round(bw), drawnH: Math.round(bh),
             offX: s.offX, offY: s.offY,
             fillW: +(bw / cw).toFixed(3), fillH: +(bh / ch).toFixed(3),
             clippedLeft: s.offX < 0, clippedTop: s.offY < 0,
             clippedBottom: s.offY + bh > ch + 1 };
  }));
  await p.close();
}
await b.close();
