/**
 * Record a demo video of the simulator.
 *
 *   node tests/record.mjs "?preset=baseline&window=0" results/demo_baseline.mp4 720 30 180
 *                                   query            output              frames fps minutes
 *
 * Frames are captured deterministically (the page's playhead is advanced by a
 * fixed amount per frame) and encoded with ffmpeg, so the result is smooth and
 * reproducible — no screen-capture timing jitter.
 */
import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const [, , query = "?preset=baseline&window=0", out = "results/demo.mp4",
  nFramesArg = "720", fpsArg = "30", minsArg = "180"] = process.argv;

const nFrames = Number(nFramesArg);
const fps = Number(fpsArg);
const totalMinutes = Number(minsArg);
const dMin = totalMinutes / nFrames;

const dir = "/tmp/rec_frames";
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });

const PORT = process.env.PORT || "8010";

const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: ["--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
const url = `http://localhost:${PORT}/${query}${query.includes("?") ? "&" : "?"}play=0`;
await page.goto(url, { waitUntil: "networkidle" });
await page.waitForFunction(
  () => (document.querySelector("#hint")?.textContent || "").includes("frames"),
  { timeout: 20000 }
);
await page.evaluate(() => {
  window.__sim.state.playing = false;      // we drive the clock ourselves
  window.__sim.state.playT = window.__sim.state.from;
});
await page.waitForTimeout(600);

for (let i = 0; i < nFrames; i++) {
  await page.evaluate((d) => window.__sim.step(d), dMin);
  await page.screenshot({ path: join(dir, `f${String(i).padStart(4, "0")}.png`) });
  if (i % 120 === 0) process.stdout.write(`\rframe ${i}/${nFrames}`);
}
await browser.close();
process.stdout.write(`\rframe ${nFrames}/${nFrames}\n`);

const ffmpeg = existsSync(join(homedir(), ".local/bin/ffmpeg"))
  ? join(homedir(), ".local/bin/ffmpeg")
  : "ffmpeg";
mkdirSync("results", { recursive: true });
execFileSync(ffmpeg, [
  "-y", "-loglevel", "error",
  "-framerate", String(fps),
  "-i", join(dir, "f%04d.png"),
  "-c:v", "libx264", "-preset", "medium", "-crf", "20",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart",
  out,
]);
rmSync(dir, { recursive: true, force: true });
console.log("wrote", out);
