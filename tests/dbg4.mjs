import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true, args:["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1500,height:950} });
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil:"networkidle" });
await p.waitForTimeout(4000);
const res = await p.evaluate(() => {
  const s = window.__sim.scene;
  const stat = (parts) => {
    const img = parts[0].material.map.image;
    const c = document.createElement("canvas");
    c.width = img.width || img.videoWidth; c.height = img.height;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0,0,c.width,c.height).data;
    let r=0,gg=0,bl=0,k=0, tot=0;
    for (let i=0;i<d.length;i+=4) {
      const R=d[i]/255,G=d[i+1]/255,B=d[i+2]/255;
      const mx=Math.max(R,G,B), mn=Math.min(R,G,B);
      const sat = mx ? (mx-mn)/mx : 0;
      if (sat > 0.25 && mx > 0.2) { r+=d[i]; gg+=d[i+1]; bl+=d[i+2]; k++; }
      tot++;
    }
    return { size:[c.width,c.height], painted: k, avg: k ? [Math.round(r/k),Math.round(gg/k),Math.round(bl/k)] : null };
  };
  return [stat(s.assets.taxi[0]), stat(s.assets.taxi[1]), stat(s.assets.taxi[2])];
});
console.log(JSON.stringify(res));
await b.close();
