/**
 * Deterministic screenshots of the website (used during development and to
 * generate the images for the report).  Uses the system Chrome via
 * playwright-core, so no browser download is needed.
 *
 *   node tests/shoot.mjs "?preset=baseline&t=60&play=0" out.png [width height]
 */
import { chromium } from "playwright-core";

const [query = "", out = "shot.png", w = "1500", h = "950"] = process.argv.slice(2);

const PORT = process.env.PORT || "8010";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on("console", (m) => { if (m.type() === "error") console.log("console error:", m.text()); });
page.on("pageerror", (e) => console.log("page error:", e.message));

await page.goto(`http://localhost:${PORT}/${query}`, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => (document.querySelector("#hint")?.textContent || "").includes("frames"),
  { timeout: 20000 }
);
await page.waitForTimeout(1800);          // let the scene settle & animate in
await page.screenshot({ path: out });
await browser.close();
console.log("wrote", out);
