import { chromium } from "playwright-core";
const shots = [
  ["bc81e9f", 8031, "/tmp/g1.png"],
  ["7e6714e", 8032, "/tmp/g2.png"],
  ["6ba4648", 8033, "/tmp/g3.png"],
];
const b = await chromium.launch({ channel: "chrome", headless: true,
  args: ["--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
for (const [name, port, out] of shots) {
  const p = await b.newPage({ viewport: { width: 1400, height: 800 } });
  p.on("pageerror", e => console.log(name, "ERR", e.message.slice(0,120)));
  await p.goto(`http://localhost:${port}/?preset=baseline&t=40&play=0&tour=0`, { waitUntil: "networkidle" });
  await p.waitForTimeout(3500);
  await p.evaluate(() => window.__sim?.settle?.(4));
  await p.waitForTimeout(500);
  await p.screenshot({ path: out });
  await p.close();
  console.log("shot", name);
}
await b.close();
