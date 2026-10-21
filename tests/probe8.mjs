import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
await page.goto("http://localhost:8010/?preset=smart&t=60&play=0&compare=1", { waitUntil: "networkidle" });
await page.waitForTimeout(3500);
const out = await page.evaluate(() => {
  const s = window.__sim.scene;
  const sb = window.__sim.sceneB || null;
  const desc = (sc, label) => {
    if (!sc) return { label, missing: true };
    const c = sc.renderer.domElement;
    return {
      label, id: c.id, canvas: [c.clientWidth, c.clientHeight, c.width, c.height],
      aspect: +sc.camera.aspect.toFixed(2), portrait: !!sc.portrait,
      calls: sc.renderer.info.render.calls, tris: sc.renderer.info.render.triangles,
      taxis: sc.taxis.size, people: sc.people.size,
      rootKids: sc.root.children.length,
      camPos: sc.camera.position.toArray().map(v => +v.toFixed(1)),
    };
  };
  return { compare: window.__sim.state.compare, A: desc(sb, "A"), B: desc(s, "B") };
});
console.log(JSON.stringify(out, null, 1));
await b.close();
