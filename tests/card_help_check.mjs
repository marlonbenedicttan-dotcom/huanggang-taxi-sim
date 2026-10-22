import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
let fails = 0;
const ok = (c, m) => { console.log(c ? "ok  " : "FAIL", m); if (!c) fails++; };
for (const [w, h, label] of [[390, 844, "phone"], [1500, 950, "desktop"]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: w < 820, hasTouch: w < 820 });
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2400);
  if (w < 820) { await p.evaluate(() => document.getElementById("sheetToggle").click()); await p.waitForTimeout(500); }

  const info = () => p.evaluate(() => {
    const items = [...document.querySelectorAll(".card-item")];
    return items.map((it) => {
      const note = it.querySelector(".card-note");
      const help = it.querySelector(".card-help");
      const card = it.querySelector(".card");
      const hr = help.getBoundingClientRect(), cr = card.getBoundingClientRect();
      return { label: it.querySelector(".t").textContent, noteHidden: note.hidden,
               expanded: help.getAttribute("aria-expanded"),
               on: card.classList.contains("on"),
               helpW: Math.round(hr.width), helpH: Math.round(hr.height),
               overlap: hr.left < cr.right - 1 };
    });
  });

  const before = await info();
  ok(before.every((c) => c.noteHidden), `${label}: notes start closed`);
  ok(before.every((c) => c.helpW >= 28 && c.helpH >= 36), `${label}: "?" is tappable (${before[0].helpW}×${before[0].helpH})`);
  ok(before.every((c) => !c.overlap), `${label}: "?" does not sit on the card`);

  // open the first explanation
  await p.evaluate(() => document.querySelectorAll(".card-help")[0].click());
  await p.waitForTimeout(300);
  let after = await info();
  ok(!after[0].noteHidden && after[0].expanded === "true", `${label}: "?" opens the note`);
  ok(after[0].on === before[0].on, `${label}: reading does not switch the policy on`);
  ok(after.slice(1).every((c) => c.noteHidden), `${label}: only one note open at a time`);

  // the card still toggles the policy and leaves the note alone
  await p.evaluate(() => document.querySelectorAll(".card")[0].click());
  await p.waitForTimeout(500);
  after = await info();
  ok(after[0].on !== before[0].on, `${label}: the card still toggles the policy`);
  ok(!after[0].noteHidden, `${label}: the note stays while you try it`);

  // "?" closes it again
  await p.evaluate(() => document.querySelectorAll(".card-help")[0].click());
  await p.waitForTimeout(250);
  after = await info();
  ok(after[0].noteHidden && after[0].expanded === "false", `${label}: "?" closes the note`);
  ok(errs.length === 0, `${label}: no page errors ${errs.join("|")}`);
  await p.close();
}
await b.close();
console.log(fails ? `${fails} FAILED` : "CARD HELP OK");
process.exit(fails ? 1 : 0);
