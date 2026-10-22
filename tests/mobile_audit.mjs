import { chromium } from "playwright-core";

const b = await chromium.launch({ channel: "chrome", headless: true });
const sizes = [[390, 844, "iPhone 390"], [360, 780, "small Android 360"], [430, 900, "large 430"]];

for (const [w, h, label] of sizes) {
  const p = await b.newPage({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
  const errs = [];
  p.on("pageerror", e => errs.push(e.message));
  await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
  await p.waitForTimeout(2500);

  const audit = await p.evaluate(() => {
    const vw = innerWidth, vh = innerHeight;
    const small = [], overflow = [], tiny = [];
    const seen = new Set();

    for (const el of document.querySelectorAll("button, input, summary, .card, a, select")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const cs = getComputedStyle(el);
      if (cs.visibility === "hidden" || cs.display === "none") continue;
      const name = el.tagName.toLowerCase() + (el.id ? "#" + el.id : el.className ? "." + String(el.className).split(" ")[0] : "");
      const key = name + Math.round(r.width) + Math.round(r.height);
      if (seen.has(key)) continue;
      seen.add(key);
      if (r.height < 34 || r.width < 28) small.push({ name, w: Math.round(r.width), h: Math.round(r.height) });
      if (r.right > vw + 1 || r.left < -1) overflow.push({ name, l: Math.round(r.left), r: Math.round(r.right) });
    }

    for (const el of document.querySelectorAll("p, span, li, label, b, h1, h2, h3, h4, summary")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs && fs < 10.5) tiny.push({ t: el.textContent.trim().slice(0, 24), fs });
    }

    return {
      docOverflow: document.documentElement.scrollWidth - vw,
      small: small.slice(0, 12),
      overflow: overflow.slice(0, 8),
      tiny: tiny.slice(0, 8),
      errors: [],
    };
  });

  console.log(`\n=== ${label} (${w}x${h}) ===`);
  console.log("horizontal overflow:", audit.docOverflow, "px");
  console.log("tap targets under 34px:", JSON.stringify(audit.small));
  console.log("elements past viewport:", JSON.stringify(audit.overflow));
  console.log("text under 10.5px:", JSON.stringify(audit.tiny));
  if (errs.length) console.log("page errors:", errs.join(" | "));
  await p.close();
}
await b.close();
