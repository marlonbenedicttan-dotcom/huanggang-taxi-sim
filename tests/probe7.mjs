import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1500, height: 950 } });
page.on("pageerror", e => console.log("PAGEERROR:", e.message));
page.on("console", m => console.log("CONSOLE:", m.type(), m.text().slice(0, 160)));
await page.goto("http://localhost:8010/?preset=smart&t=60&play=0&compare=1", { waitUntil: "networkidle" });
await page.waitForTimeout(4000);
const st = await page.evaluate(() => ({
  compare: window.__sim?.state?.compare,
  cls: document.querySelector("#stage")?.className,
}));
console.log("STATE:", JSON.stringify(st));
await b.close();
