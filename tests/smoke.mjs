import { chromium } from "playwright-core";
const base = "http://localhost:8010/";
const b = await chromium.launch({ channel: "chrome", headless: true });
const results = [];
const add = (name, ok, detail = "") => results.push({ name, ok, detail });

async function open(url, viewport = { width: 1500, height: 950 }) {
  const p = await b.newPage({ viewport });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  p.on("console", m => { if (m.type() === "error") errs.push("console: " + m.text().slice(0, 120)); });
  await p.goto(base + url, { waitUntil: "networkidle" });
  await p.waitForTimeout(3200);
  return { p, errs };
}

/* 1. diag mode */
{
  const { p, errs } = await open("?diag=1&t=40&play=0&tour=0");
  const diag = await p.evaluate(() => document.getElementById("diag")?.textContent || "");
  add("diag panel", diag.includes("canvas"), diag.slice(0, 40));
  add("diag no errors", errs.length === 0, errs[0] || "");
  await p.close();
}

/* 2. compare mode */
{
  const { p, errs } = await open("?compare=1&t=40&play=0&tour=0");
  const state = await p.evaluate(() => {
    const a = document.getElementById("scene");
    const b = document.getElementById("sceneB");
    const rb = b.getBoundingClientRect();
    const lx = document.querySelector(".zone-label");
    const lr = lx ? lx.getBoundingClientRect() : null;
    return {
      split: document.getElementById("stage").classList.contains("split"),
      bVisible: !b.hidden && b.width > 0,
      bRect: [Math.round(rb.x), Math.round(rb.y), Math.round(rb.width), Math.round(rb.height)],
      labelInsideB: lr ? lr.x > rb.x - 5 : false,
      aSize: [a.width, a.height],
    };
  });
  add("compare split", state.split, JSON.stringify(state.bRect));
  add("compare B drawn", state.bVisible, "");
  add("compare labels on A", state.labelInsideB, "");
  add("compare no errors", errs.length === 0, errs[0] || "");
  await p.close();
}

/* 3. mobile */
{
  const { p, errs } = await open("?t=40&play=0&tour=0", { width: 390, height: 844 });
  const m = await p.evaluate(() => {
    const ctl = document.getElementById("camCtl");
    const r = ctl.getBoundingClientRect();
    const hint = getComputedStyle(document.getElementById("camHint")).display;
    return {
      ctl: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)],
      onScreen: r.x >= 0 && r.right <= innerWidth && r.y >= 0,
      hint,
    };
  });
  add("mobile controls on screen", m.onScreen, JSON.stringify(m.ctl));
  add("mobile hint hidden", m.hint === "none", m.hint);
  await p.click("#camIn");
  await p.waitForTimeout(200);
  const z = await p.evaluate(() => window.__sim.scene.cam.zoom);
  add("mobile zoom works", z > 1, `${Math.round(z * 100)}%`);
  add("mobile no errors", errs.length === 0, errs[0] || "");
  await p.close();
}

/* 4. tour */
{
  const { p, errs } = await open("?t=40&play=0&tour=1");
  const t = await p.evaluate(() => {
    const el = document.querySelector(".tour-card, #tourCard, #tour");
    return el ? el.textContent.slice(0, 60) : "missing";
  });
  add("tour opens", t !== "missing", t);
  add("tour no errors", errs.length === 0, errs[0] || "");
  await p.close();
}

/* 5. zoom keeps counters glued to the crowd */
{
  const { p, errs } = await open("?t=40&play=0&tour=0");
  const before = await p.evaluate(() => {
    const el = document.querySelector(".zone-label:not(.buffer)");
    const r = el.getBoundingClientRect();
    return [r.x, r.y];
  });
  await p.evaluate(() => window.__sim.scene.zoomBy(2));
  await p.waitForTimeout(250);
  const after = await p.evaluate(() => {
    const el = document.querySelector(".zone-label:not(.buffer)");
    const r = el.getBoundingClientRect();
    return [r.x, r.y];
  });
  add("counters follow zoom", Math.abs(before[0] - after[0]) > 4,
    `${before.map(Math.round)} -> ${after.map(Math.round)}`);
  await p.screenshot({ path: "/tmp/zoom_labels.png" });
  add("zoom no errors", errs.length === 0, errs[0] || "");
  await p.close();
}

/* report */
let bad = 0;
for (const r of results) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? "PASS" : "FAIL"}  ${r.name.padEnd(26)} ${r.detail}`);
}
console.log(bad ? `\n${bad} FAILED` : "\nSMOKE PASSED");
await b.close();
process.exit(bad ? 1 : 0);
