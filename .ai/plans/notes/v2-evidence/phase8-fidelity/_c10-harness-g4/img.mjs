// D5: picture fixtures made in Chromium (the Mac mini runner has no ImageMagick). Same sizes as the stage-A `convert plasma:fractal` photos;
// the look is a seeded blob "plasma", not the fractal one — the board's photos are placeholders either way.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { playwright } from './lib.mjs';

/** list: [{ path, w, h, kind: 'plasma' | 'gradient', seed?, bg?, fg? }] */
export async function makeImages(list) {
  const browser = await playwright.chromium.launch(process.env.SHOT_CHANNEL ? { channel: process.env.SHOT_CHANNEL } : {});
  const page = await browser.newPage();
  for (const it of list) {
    const b64 = await page.evaluate(({ w, h, kind, seed, bg, fg }) => {
      const c = document.createElement('canvas');
      c.width = w;
      c.height = h;
      const g = c.getContext('2d');
      if (kind === 'gradient') {
        const lg = g.createLinearGradient(0, 0, 0, h);
        lg.addColorStop(0, bg);
        lg.addColorStop(1, fg);
        g.fillStyle = lg;
        g.fillRect(0, 0, w, h);
      } else {
        let s = ((seed || 1) * 2654435761) >>> 0;
        const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
        g.fillStyle = `hsl(${Math.floor(rnd() * 360)} 60% 45%)`;
        g.fillRect(0, 0, w, h);
        for (let i = 0; i < 18; i++) {
          const x = rnd() * w;
          const y = rnd() * h;
          const r = (0.15 + rnd() * 0.5) * Math.max(w, h);
          const rg = g.createRadialGradient(x, y, 0, x, y, r);
          const hue = Math.floor(rnd() * 360);
          rg.addColorStop(0, `hsla(${hue} 75% 60% / 0.85)`);
          rg.addColorStop(1, `hsla(${hue} 75% 60% / 0)`);
          g.fillStyle = rg;
          g.fillRect(0, 0, w, h);
        }
      }
      return c.toDataURL('image/jpeg', 0.9).split(',')[1];
    }, it);
    mkdirSync(dirname(it.path), { recursive: true });
    writeFileSync(it.path, Buffer.from(b64, 'base64'));
  }
  await browser.close();
}
