import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
for (const [name, w, h, clicks] of [["/tmp/tour1.png", 1400, 900, 1], ["/tmp/tour2.png", 1400, 900, 2], ["/tmp/tour_phone.png", 390, 844, 1]]) {
  const page = await b.newPage({ viewport: { width: w, height: h } });
  await page.goto("http://localhost:8010/?preset=baseline&play=0&tour=1", { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  for (let i = 0; i < clicks; i++) { await page.click("#tourNext"); await page.waitForTimeout(400); }
  await page.waitForTimeout(300);
  await page.screenshot({ path: name });
  await page.close();
  console.log("wrote", name);
}
await b.close();
