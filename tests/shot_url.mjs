import { chromium } from "playwright-core";
const [url, out, w = "1400", h = "720", wait = "4000"] = process.argv.slice(2);
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const p = await b.newPage({ viewport: { width: +w, height: +h } });
p.on("pageerror", e => console.log("PAGEERROR:", e.message));
await p.goto(url, { waitUntil: "networkidle" });
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
console.log("wrote", out);
await b.close();
