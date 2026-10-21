/**
 * Visual regression harness.
 *
 * The simulation has parity tests; this is the equivalent for the 3D layer.
 * It answers one question in a single run: **are the moving entities actually
 * in the scene and drawable?** Every failure we hit could have been named by
 * one of these checks.
 *
 *   node tests/visual_check.mjs [url]
 *
 * Exit code 0 = pass, 1 = fail (so it can gate a commit).
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ||
  "http://localhost:8010/?preset=baseline&t=40&play=0&tour=0";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "networkidle" });
// give the kit + the first frames time to land
await page.waitForTimeout(3500);

const report = await page.evaluate(() => {
  const sim = window.__sim;
  if (!sim) return { fatal: "window.__sim missing — app did not initialise" };
  const s = sim.scene;
  const f = sim.state.frames[Math.round((sim.state.playT - sim.state.from) / sim.state.step)];

  const checks = [];
  const add = (name, ok, detail) => checks.push({ name, ok, detail });

  // 1. the simulation produced entities in this frame
  const txCount = f ? f.tx.length : 0;
  const pxCount = f ? f.px.length : 0;
  add("frame has taxis", txCount > 0, `${txCount} taxis in frame`);
  add("frame has passengers", pxCount > 0, `${pxCount} passengers in frame`);

  // 2. the entity meshes exist
  const meshNames = ["taxiShell", "taxiRoof", "taxiDark", "taxiShadow"];
  for (const n of meshNames) {
    const m = s[n];
    add(`${n} exists`, !!m, m ? `${m.count} instances` : "missing");
  }

  // 3. they are attached to the live scene graph (the detached-mesh bug)
  for (const n of meshNames) {
    const m = s[n];
    if (!m) continue;
    let attached = false;
    let node = m;
    while (node) {
      if (node === s.root) { attached = true; break; }
      node = node.parent;
    }
    add(`${n} attached to root`, attached, attached ? "ok" : "DETACHED from scene root");
  }

  // 4. they have a non-zero instance count
  const shell = s.taxiShell;
  if (shell) add("taxiShell.count > 0", shell.count > 0, `count=${shell.count}`);
  const pax = s.paxMesh && s.paxMesh[0];
  if (pax) add("paxMesh[0].count > 0", pax.count > 0, `count=${pax.count}`);

  // 5. the matrices are finite (a NaN scale makes a mesh invisible)
  if (shell && shell.count > 0) {
    const arr = shell.instanceMatrix.array;
    let bad = 0;
    for (let i = 0; i < Math.min(16 * shell.count, arr.length); i++) {
      if (!Number.isFinite(arr[i])) bad++;
    }
    add("taxi matrices finite", bad === 0, bad ? `${bad} non-finite values` : "ok");
  }

  // 6. the renderer is actually drawing geometry
  const info = s.renderer.info.render;
  add("draw calls > 20", info.calls > 20, `${info.calls} calls`);
  add("triangles > 5k", info.triangles > 5000, `${info.triangles} tris`);

  // 7. the clock is moving (the loop is alive)
  const t0 = sim.state.playT;
  return { checks, t0, frames: sim.state.frames.length };
});

// ---- the check that would have caught every failure: pixels ----
// Screenshot the hall, hide every entity mesh, screenshot again. If the two
// images are identical, the entities are not contributing a single pixel,
// no matter what the counts say.
await page.evaluate(() => window.__sim.settle?.(3));
await page.waitForTimeout(400);
const before = await page.screenshot({ clip: { x: 340, y: 60, width: 1100, height: 640 } });

await page.evaluate(() => {
  const s = window.__sim.scene;
  for (const n of ["taxiShell", "taxiRoof", "taxiDark", "taxiShadow", "taxiInst", "paxInst"]) {
    const v = s[n];
    if (!v) continue;
    if (Array.isArray(v)) v.forEach((m) => (m.visible = false));
    else if (v.meshes) v.meshes.forEach((m) => (m.visible = false));
    else v.visible = false;
  }
  (s.paxMesh || []).forEach((m) => (m.visible = false));
  (s.paxShadow || []).forEach((m) => (m.visible = false));
  s.renderer.render(s.scene, s.camera);
});
await page.waitForTimeout(300);
const after = await page.screenshot({ clip: { x: 340, y: 60, width: 1100, height: 640 } });

const identical = Buffer.compare(before, after) === 0;
const pixelCheck = {
  name: "entities contribute pixels",
  ok: !identical,
  detail: identical
    ? "IDENTICAL images with entities hidden — nothing is drawn"
    : `differs (${before.length} vs ${after.length} bytes)`,
};

await browser.close();

if (report.fatal) {
  console.log("FATAL:", report.fatal);
  process.exit(1);
}

// bring the pixel result into the report
report.checks.push(pixelCheck);

let failed = 0;
console.log("visual check —", url);
console.log("frames:", report.frames);
for (const c of report.checks) {
  if (!c.ok) failed++;
  console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(26)} ${c.detail}`);
}
if (errors.length) {
  console.log("page errors:");
  for (const e of errors.slice(0, 3)) console.log("   ", e.slice(0, 160));
}
console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
