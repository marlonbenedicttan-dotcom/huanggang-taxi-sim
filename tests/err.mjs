import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: 1200, height: 800 } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message, "\n", (e.stack||"").split("\n").slice(0,4).join("\n")));
p.on("console", m => { if (m.type()==="error") console.log("CONSOLE:", m.text().slice(0,180)); });
p.on("requestfailed", r => console.log("REQFAIL:", r.url().split("/").pop(), r.failure()?.errorText));
await p.goto("http://localhost:8010/?preset=baseline&play=0&tour=0", { waitUntil: "networkidle" });
await p.waitForTimeout(2500);
console.log("has __sim:", await p.evaluate(() => !!window.__sim));
await b.close();
