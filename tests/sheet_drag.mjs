import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const fails = [];
const check = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fails.push(m); };

for (const [w, h] of [[390, 844], [360, 740], [320, 568]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true });
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2200);

  const state = () => p.evaluate(() => {
    const pan = document.getElementById("panel");
    const r = pan.getBoundingClientRect();
    const ta = getComputedStyle(pan).touchAction;
    return { h: Math.round(r.height), top: Math.round(r.top), open: document.body.classList.contains("sheet-open"),
             half: document.body.classList.contains("sheet-half"), full: document.body.classList.contains("sheet-full"), ta };
  });

  check((await state()).ta === "none", `${w}: collapsed sheet captures the gesture (touch-action ${(await state()).ta})`);

  // drag up from the middle of the collapsed sheet
  await p.mouse.move(w / 2, h - 60);
  await p.mouse.down();
  for (let i = 1; i <= 12; i++) await p.mouse.move(w / 2, h - 60 - i * 18);
  await p.mouse.up();
  await p.waitForTimeout(450);
  let s = await state();
  check(s.h >= h * 0.4, `${w}: pull up from the sheet body opens it (${s.h}px)`);

  // then drag the handle up to full
  const handle = await p.evaluate(() => { const r = document.getElementById("sheetToggle").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(handle.x, handle.y);
  await p.mouse.down();
  for (let i = 1; i <= 20; i++) await p.mouse.move(handle.x, handle.y - i * 20);
  await p.mouse.up();
  await p.waitForTimeout(450);
  s = await state();
  check(s.full && s.h > h * 0.85, `${w}: handle drag reaches full (${s.h}px, ${Math.round(s.h / h * 100)}%)`);

  // a drag that ends on the handle must not also register as a tap
  check((await state()).h > h * 0.85, `${w}: drag end did not toggle the sheet back`);

  // drag down from full
  const h2 = await p.evaluate(() => { const r = document.getElementById("sheetToggle").getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(h2.x, h2.y);
  await p.mouse.down();
  for (let i = 1; i <= 18; i++) await p.mouse.move(h2.x, h2.y + i * 20);
  await p.mouse.up();
  await p.waitForTimeout(450);
  s = await state();
  check(s.h < h * 0.7 || !s.open, `${w}: drag down closes it (${s.h}px)`);

  // tap toggles peek <-> half only
  await p.click("#sheetToggle"); await p.waitForTimeout(420);
  const s1 = await state();
  await p.click("#sheetToggle"); await p.waitForTimeout(420);
  const s2 = await state();
  check(s1.half && !s1.full && s2.h < 250, `${w}: tap toggles half then peek (${s1.h}, ${s2.h})`);

  // cards must not clip their own text
  const cards = await p.evaluate(() => [...document.querySelectorAll("#kpis .kpi")].map((k) => {
    const v = k.querySelector(".kpi-val");
    return { h: Math.round(k.getBoundingClientRect().height), over: v.scrollHeight > v.clientHeight + 1 || k.scrollHeight > k.clientHeight + 1 };
  }));
  check(cards.every(c => !c.over), `${w}: kpi cards fit their text (${cards.map(c => c.h).join(",")})`);
  const g = await p.evaluate(() => {
    const s = document.getElementById("stage").getBoundingClientRect();
    const k = document.getElementById("kpis").getBoundingClientRect();
    const pn = document.getElementById("panel").getBoundingClientRect();
    return { a: Math.round(k.top - s.bottom), b: Math.round(pn.top - k.bottom) };
  });
  check(g.a >= 8 && g.a <= 24 && g.b >= 8 && g.b <= 20, `${w}: map/stats/sheet spacing is even (${g.a}px, ${g.b}px)`);
  await p.close();
}
await b.close();
console.log(fails.length ? `${fails.length} FAILED` : "SHEET OK");
process.exit(fails.length ? 1 : 0);
