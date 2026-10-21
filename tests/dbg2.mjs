import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true });
const p = await b.newPage();
p.on("pageerror", e => console.log("ERR:", e.message, "\n", (e.stack||"").split("\n").slice(0,5).join("\n")));
p.on("requestfailed", r => console.log("404:", r.url()));
await p.goto("http://localhost:8010/proto-pixel.html", { waitUntil: "networkidle" });
await p.waitForTimeout(1200);
await b.close();
