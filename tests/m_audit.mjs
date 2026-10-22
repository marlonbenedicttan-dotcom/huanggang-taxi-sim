import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const errs = [];
p.on("pageerror", e => errs.push(e.message));
await p.goto("http://localhost:8010/?t=40&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(3000);

const audit = await p.evaluate(() => {
  const vw = innerWidth, vh = innerHeight;
  const bad = [];
  for (const el of document.querySelectorAll("body *")) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.opacity === "0") continue;
    if (r.right > vw + 2 || r.left < -2 || r.bottom > vh + 2) {
      bad.push({
        tag: el.tagName, id: el.id, cls: String(el.className).slice(0, 24),
        x: Math.round(r.left), r: Math.round(r.right), b: Math.round(r.bottom),
        text: (el.textContent || "").trim().slice(0, 20),
      });
    }
  }
  return { vw, vh, bad: bad.slice(0, 14), scrollW: document.documentElement.scrollWidth };
});
console.log(JSON.stringify(audit, null, 1));

// frame timing
const fps = await p.evaluate(() => new Promise((res) => {
  let n = 0; const t0 = performance.now();
  function tick() { n++; if (performance.now() - t0 < 2000) requestAnimationFrame(tick); else res(Math.round(n / ((performance.now() - t0) / 1000))); }
  requestAnimationFrame(tick);
}));
console.log("fps:", fps, "errors:", errs.length ? errs.join(" | ") : "none");
await p.screenshot({ path: "/tmp/m_now.png" });
await b.close();
