import { chromium } from "playwright-core";
const b = await chromium.launch({ channel: "chrome", headless: true, args:["--enable-unsafe-swiftshader"] });
const p = await b.newPage({ viewport:{width:1500,height:950} });
p.on("pageerror", e => console.log("ERR:", e.message));
p.on("console", m => { if (m.type()==="warning"||m.type()==="error") console.log(m.type(), m.text().slice(0,200)); });
await p.goto("http://localhost:8010/?preset=baseline&t=40&play=0&tour=0", { waitUntil:"networkidle" });
await p.waitForTimeout(4000);
console.log(await p.evaluate(() => {
  const s = window.__sim.scene;
  const out = { hasAssets: !!s.assets, isArr: Array.isArray(s.assets?.taxi), n: s.assets?.taxi?.length,
                instLen: s.taxiInst?.length };
  const tex = (parts) => {
    const m = parts[0].material;
    const c = document.createElement("canvas");
    c.width = 8; c.height = 8;
    const g = c.getContext("2d");
    g.drawImage(m.map.image, 0, 0, 8, 8);
    const d = g.getImageData(0,0,8,8).data;
    let r=0,gg=0,bl=0; for (let i=0;i<d.length;i+=4){r+=d[i];gg+=d[i+1];bl+=d[i+2];}
    return [Math.round(r/64), Math.round(gg/64), Math.round(bl/64), !!m.map];
  };
  try { out.tex0 = tex(s.assets.taxi[0]); out.tex1 = tex(s.assets.taxi[1]); out.tex2 = tex(s.assets.taxi[2]); } catch(e){ out.texErr = e.message; }
  out.clsSample = [...s.taxis.values()].slice(0,3).map(e=>e.cls);
  return out;
}));
await b.close();
