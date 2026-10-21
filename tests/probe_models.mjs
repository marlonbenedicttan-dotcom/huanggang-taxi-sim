import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await b.newPage({ viewport: { width: 1400, height: 720 } });
page.on("pageerror", (e) => console.log("PAGEERROR:", e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") console.log("CONSOLE:", m.text().slice(0, 200)); });
page.on("requestfailed", (r) => console.log("REQ FAILED:", r.url().split("/").pop(), r.failure()?.errorText));
await page.goto("http://localhost:8010/dev-models.html", { waitUntil: "networkidle" });
await page.waitForTimeout(3000);
console.log("PRE:", (await page.textContent("#out")).slice(0, 600));
await b.close();
