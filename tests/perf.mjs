import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
for (const [name, w, h] of [["desktop", 1500, 950], ["phone", 390, 844]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await page.waitForTimeout(2500);
  const r = await page.evaluate(() => {
    const s = window.__sim.scene;
    const info = s.renderer.info;
    return {
      calls: info.render.calls,
      triangles: info.render.triangles,
      geometries: info.memory.geometries,
      textures: info.memory.textures,
      dpr: s.renderer.getPixelRatio(),
      canvas: [s.renderer.domElement.width, s.renderer.domElement.height],
      quality: s.quality,
    };
  });
  console.log(name, JSON.stringify(r));
  await page.close();
}
await b.close();
