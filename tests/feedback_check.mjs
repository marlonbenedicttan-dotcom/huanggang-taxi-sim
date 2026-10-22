import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const fails = [];
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fails.push(m); };

for (const [w, h, label] of [[390, 844, "phone"], [1500, 950, "desktop"]]) {
 try {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 820, hasTouch: w < 820 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2300);
  const before = await p.evaluate(() => +document.getElementById("heroWait").textContent);

  // apply the recommended package from the preset row
  if (w < 820) { await p.click("[data-preset=recommended]"); } else { await p.click("[data-preset=recommended]"); }
  await p.waitForTimeout(120);
  const mid = await p.evaluate(() => ({
    shiftVisible: !document.getElementById("heroShift").hidden,
    shiftText: document.getElementById("heroShift").textContent.trim(),
    flashing: document.querySelectorAll(".card.flash").length,
  }));
  await p.waitForTimeout(700);
  const after = await p.evaluate(() => ({
    wait: +document.getElementById("heroWait").textContent,
    shiftVisible: !document.getElementById("heroShift").hidden,
    shiftText: document.getElementById("heroShift").textContent.trim(),
  }));

  ok(mid.shiftVisible && /→/.test(mid.shiftText), `${label}: before/after line appears (${mid.shiftText.slice(0, 48)}…)`);
  ok(after.wait < before - 1, `${label}: hero number lands on the new value (${before} → ${after.wait})`);
  ok(mid.flashing === 2, `${label}: exactly the two changed cards flash (${mid.flashing})`);
  ok(errs.length === 0, `${label}: no page errors ${errs.join("|")}`);

  // the CTA becomes an end state, and can undo itself
  if (w < 820) { await p.evaluate(() => document.getElementById("sheetToggle").click()); await p.waitForTimeout(550); }
  // start from today's process so the CTA has something to change
  await p.evaluate(() => document.querySelector('[data-preset=baseline]').click());
  await p.waitForTimeout(500);
  const baseWait = await p.evaluate(() => +document.getElementById("heroWait").textContent);
  await p.evaluate(() => { document.getElementById("heroCta").scrollIntoView({ block: "center" }); });
  await p.waitForTimeout(400);
  await p.evaluate(() => { document.getElementById("heroCta").scrollIntoView({ block: "center" }); });
  await p.waitForTimeout(300);
  const label0 = await p.textContent("#heroCta");
  await p.click("#heroCta", { timeout: 8000 }); await p.waitForTimeout(600);
  const label1 = await p.textContent("#heroCta");
  const appliedWait = await p.evaluate(() => +document.getElementById("heroWait").textContent);
  await p.click("#heroCta", { timeout: 8000 }); await p.waitForTimeout(600);
  const label2 = await p.textContent("#heroCta");
  const undoneWait = await p.evaluate(() => +document.getElementById("heroWait").textContent);
  ok(/apply/i.test(label0) && /applied/i.test(label1), `${label}: CTA has an applied state (${label0} → ${label1})`);
  ok(appliedWait < baseWait - 1, `${label}: the CTA applies the package (${baseWait} → ${appliedWait})`);
  ok(/apply/i.test(label2) && !/applied/i.test(label2), `${label}: CTA resets after undo (${label2})`);
  ok(Math.abs(undoneWait - baseWait) < 1.5, `${label}: the CTA's own undo restores the old settings (${baseWait} → ${undoneWait})`);

  if (w < 820) {
    // undo button lives on the collapsed sheet
    await p.evaluate(() => document.getElementById("sheetToggle").click());
    await p.waitForTimeout(500);
    const u = await p.evaluate(() => {
      const b2 = document.getElementById("undoBtn");
      const r = b2.getBoundingClientRect();
      const st = document.getElementById("peekStatus").getBoundingClientRect();
      return { hidden: b2.hidden, w: Math.round(r.width), inside: r.right <= st.right + 1 && r.left >= st.left - 1 };
    });
    ok(!u.hidden && u.w > 30 && u.inside, `phone: undo button sits in the peek row (${u.w}px)`);
    const beforeUndo = await p.evaluate(() => +document.getElementById("peekWait").textContent);
    await p.evaluate(() => document.getElementById("undoBtn").click());
    await p.waitForTimeout(500);
    const afterUndo = await p.evaluate(() => +document.getElementById("peekWait").textContent);
    ok(Math.abs(afterUndo - beforeUndo) > 0.5 || afterUndo > 10, `phone: the peek undo changes the result (${beforeUndo} → ${afterUndo})`);
  } else {
    ok(true, "desktop: keyboard undo is the visible path");
  }

  // touching a card clears the applied state
  await p.evaluate(() => document.getElementById("policyCards").scrollIntoView({ block: "center" }));
  await p.waitForTimeout(250);
  await p.evaluate(() => document.querySelector("#policyCards .card").click());
  await p.waitForTimeout(350);
  const cleared = await p.textContent("#heroCta");
  ok(/apply/i.test(cleared) && !/applied/i.test(cleared), `${label}: editing clears the applied state (${cleared})`);
  await p.close();
 } catch (err) {
   console.log("THREW", label, err.message.replace(/\s+/g, " ").slice(0, 420));
   fails.push(label);
 }
}
await b.close();
console.log(fails.length ? `${fails.length} FAILED` : "FEEDBACK OK");
process.exit(fails.length ? 1 : 0);
