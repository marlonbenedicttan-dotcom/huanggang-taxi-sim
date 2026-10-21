/**
 * Visual regression harness for the 2.5D pixel renderer.
 *
 * The simulation has parity tests; this is the equivalent for the picture.
 * It answers one question in a single run: **is the scene actually being
 * drawn, with entities, and does it animate?** Every failure we hit during
 * the 3D years could have been named by one of these checks.
 *
 *   node tests/visual_check.mjs [url]
 *
 * Exit code 0 = pass, 1 = fail (so it can gate a commit).
 */
import { chromium } from "playwright-core";

const url = process.argv[2] ||
  "http://localhost:8010/?preset=baseline&t=40&play=0&tour=0";

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));

await page.goto(url, { waitUntil: "networkidle" });
await page.waitForTimeout(2500);

const checks = [];
const add = (name, ok, detail) => checks.push({ name, ok, detail });

/* ---- 1. app booted and the scene holds entities ---- */
const info = await page.evaluate(() => {
  const sim = window.__sim;
  if (!sim) return { fatal: "window.__sim missing — app did not initialise" };
  const s = sim.scene;
  return {
    taxis: s.taxis?.size ?? -1,
    people: s.people?.size ?? -1,
    buf: [s.buf?.width, s.buf?.height],
    labels: document.querySelectorAll("#zoneLabels .zone-label").length,
    canvas: [s.canvas.width, s.canvas.height],
  };
});

if (info.fatal) {
  console.log(`FAIL  ${info.fatal}`);
  await browser.close();
  process.exit(1);
}

add("app initialised", true, `buffer ${info.buf[0]}x${info.buf[1]}`);
add("taxis in scene", info.taxis > 0, `${info.taxis} taxis`);
add("people in scene", info.people > 0, `${info.people} people`);
add("zone counters attached", info.labels === 4, `${info.labels} labels`);

/* ---- 2. the canvas actually has a picture on it ---- */
const picture = await page.evaluate(() => {
  const s = window.__sim.scene;
  const c = s.canvas;
  const g = c.getContext("2d");
  // read the middle band, avoiding the letterbox
  const d = g.getImageData(0, Math.round(c.height * 0.2), c.width, Math.round(c.height * 0.5)).data;
  const seen = new Set();
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    seen.add((d[i] >> 3) << 10 | (d[i + 1] >> 3) << 5 | (d[i + 2] >> 3));
    sum += d[i] + d[i + 1] + d[i + 2];
  }
  return { colours: seen.size, mean: Math.round(sum / (d.length / 4) / 3) };
});

add("canvas is not blank", picture.mean > 20 && picture.mean < 245, `mean luma ${picture.mean}`);
add("canvas has depth", picture.colours > 24, `${picture.colours} distinct colours`);

/* ---- 3. it animates: same scene, a moment later, must differ ---- */
const before = await page.screenshot();
await page.evaluate(() => window.__sim.settle(1.2));
const after = await page.screenshot();
add("animation moves", Buffer.compare(before, after) !== 0,
  `${before.length} -> ${after.length} bytes`);

/* ---- 4. no runtime errors ---- */
add("no page errors", errors.length === 0, errors.slice(0, 2).join(" | ") || "clean");

/* ---- report ---- */
let failed = 0;
for (const c of checks) {
  const mark = c.ok ? "PASS" : "FAIL";
  if (!c.ok) failed++;
  console.log(`${mark}  ${c.name.padEnd(24)} ${c.detail}`);
}
console.log(failed ? `\n${failed} CHECK(S) FAILED` : "\nALL CHECKS PASSED");

await browser.close();
process.exit(failed ? 1 : 0);
