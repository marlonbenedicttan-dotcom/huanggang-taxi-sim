import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto("http://localhost:8010/?preset=baseline&t=60&play=0", { waitUntil: "networkidle" });
await page.waitForTimeout(1500);
const out = await page.evaluate(() => {
  const s = window.__sim.scene, r = s.renderer;
  let meshes = 0, inst = 0;
  s.root.traverse(o => { if (o.isInstancedMesh) inst++; else if (o.isMesh) meshes++; });
  return {
    calls: r.info.render.calls,
    triangles: r.info.render.triangles,
    geometries: r.info.memory.geometries,
    meshes, instanced: inst,
    taxiGeo: s.geo.taxiBody.attributes.position.count / 3,
    personGeo: s.geo.person.attributes.position.count / 3,
    fps: (() => { const t0 = performance.now(); return new Promise(r2 => requestAnimationFrame(() => requestAnimationFrame(() => r2(Math.round(2000 / (performance.now() - t0)))))); })(),
  };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
