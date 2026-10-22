import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
let fail = 0;
const ok = (c, msg) => { if (!c) { fail++; console.log("FAIL", msg); } else console.log("ok  ", msg); };

for (const [w, h, label] of [[1500, 950, "desktop"], [390, 844, "phone"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 820, hasTouch: w < 820 });
  const errs = []; p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);
  if (w < 820) { await p.click("#sheetToggle"); await p.waitForTimeout(500); }

  // ? sits immediately left of Pause
  const g = await p.evaluate(() => {
    const hb = document.getElementById("helpBtn"), pb = document.getElementById("playBtn");
    if (!hb || !pb) return null;
    const a = hb.getBoundingClientRect(), b = pb.getBoundingClientRect();
    return { hx: Math.round(a.x), hy: Math.round(a.y), hw: Math.round(a.width), hh: Math.round(a.height),
             px: Math.round(b.x), py: Math.round(b.y), gap: Math.round(b.x - a.right),
             insideOverlay: !!hb.closest(".overlay-top"), text: hb.textContent.trim() };
  });
  ok(g && g.text === "?", `${label}: ? button exists`);
  ok(g && g.hx < g.px && g.gap >= 0 && g.gap < 20, `${label}: ? is left of Pause (gap ${g && g.gap}px)`);
  ok(g && Math.abs(g.hy + g.hh / 2 - (g.py + 18)) < 14, `${label}: ? vertically aligned with Pause`);

  // opens
  await p.click("#helpBtn"); await p.waitForTimeout(350);
  const m = await p.evaluate(() => {
    const el = document.getElementById("helpModal");
    const card = el.querySelector(".help-card");
    const body = el.querySelector(".help-body");
    return { hidden: el.hidden, cardH: Math.round(card.getBoundingClientRect().height),
             bodyH: Math.round(body.getBoundingClientRect().height),
             op: getComputedStyle(card).opacity,
             inView: card.getBoundingClientRect().top >= 0 && card.getBoundingClientRect().bottom <= innerHeight + 1,
             title: el.querySelector("h2").textContent };
  });
  ok(!m.hidden && m.cardH > 200 && m.op === "1", `${label}: guide opens (${m.cardH}px, opacity ${m.op})`);
  ok(m.inView, `${label}: guide fits on screen`);
  ok(m.title.includes("New here"), `${label}: guide has a title`);

  // closes
  await p.keyboard.press("Escape"); await p.waitForTimeout(250);
  ok(await p.evaluate(() => document.getElementById("helpModal").hidden), `${label}: Esc closes`);

  // every dropdown: tap, then read the title colour and the body
  const ids = ["why", "howItWorks", "valuePanel", "pilotPanel"];
  for (const id of ids) {
    await p.evaluate((i) => document.querySelector(`#${i} > summary`).scrollIntoView({ block: "center" }), id);
    await p.waitForTimeout(300);
    await p.click(`#${id} > summary`);
    await p.waitForTimeout(500);
    const r = await p.evaluate((i) => {
      const d = document.getElementById(i);
      const sum = d.querySelector(":scope > summary");
      const cs = getComputedStyle(sum);
      const body = d.querySelector(":scope > div");
      const bs = body ? getComputedStyle(body) : null;
      return { open: d.open, color: cs.color, op: cs.opacity, bg: getComputedStyle(d).backgroundColor,
               visible: sum.getBoundingClientRect().height > 0,
               bodyH: body ? Math.round(body.getBoundingClientRect().height) : 0,
               bodyOp: bs ? bs.opacity : "1" };
    }, id);
    const dark = (c) => { const [r2, g2, b2] = c.match(/\d+/g).map(Number); return (r2 + g2 + b2) / 3 < 140; };
    ok(r.open && r.visible && dark(r.color), `${label}: ${id} title stays readable after tap (${r.color})`);
    ok(r.bodyH > 10 && Number(r.bodyOp) > 0.9, `${label}: ${id} body visible (${r.bodyH}px, op ${r.bodyOp})`);
    // close it again
    await p.click(`#${id} > summary`); await p.waitForTimeout(300);
    const after = await p.evaluate((i) => {
      const d = document.getElementById(i);
      const sum = d.querySelector(":scope > summary");
      return { color: getComputedStyle(sum).color, h: Math.round(sum.getBoundingClientRect().height) };
    }, id);
    ok(after.h > 0 && dark(after.color), `${label}: ${id} title alive after closing (${after.color})`);
  }
  ok(errs.length === 0, `${label}: no page errors ${errs.join(" | ")}`);
  await p.close();
}
await b.close();
console.log(fail ? `${fail} FAILURES` : "all passed");
process.exit(fail ? 1 : 0);
