import { chromium } from "playwright-core";
const [url, out, w = "1200", h = "700", wait = "2500"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message.slice(0, 200)));
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
await b.close();
console.log("wrote", out);
