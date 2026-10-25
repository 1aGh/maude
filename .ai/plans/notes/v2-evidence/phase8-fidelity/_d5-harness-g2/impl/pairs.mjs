// node pairs.mjs — SPEC (left) | IMPL (right), same height, label strip. Full-size to .scr/pairs/<canvas>/, committed copy
// (<=1100 px wide, JPEG q55) to .ai/plans/notes/v2-evidence/phase8-fidelity/<canvas>/.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const W = process.env.D5_REPO || join(import.meta.dirname, '../..');
const S = `${W}/.scr`;
const EV = `${W}/.ai/plans/notes/v2-evidence/phase8-fidelity`;
const FONT = '/System/Library/Fonts/Helvetica.ttc';
const cfg = JSON.parse(readFileSync(`${S}/${process.env.MAP || 'pairs-map.json'}`, 'utf8'));
const mg = (...a) => execFileSync('magick', a, { stdio: ['ignore', 'pipe', 'pipe'] });
const size = (f) => execFileSync('magick', ['identify', '-format', '%w %h', f]).toString().split(' ').map(Number);
const rows = [];

for (const [canvas, c] of Object.entries(cfg)) {
  const full = `${S}/pairs/${canvas}`;
  const ev = `${EV}/${canvas}`;
  mkdirSync(full, { recursive: true });
  mkdirSync(ev, { recursive: true });
  const meta = JSON.parse(readFileSync(`${S}/spec/${c.nn}/meta.json`, 'utf8'));
  for (const id of Object.keys(c.ids)) {
    if (process.env.ONLY && !process.env.ONLY.split(',').includes(id)) continue;
    const m = c.ids[id];
    for (const theme of ['dark', 'light']) {
      const spec = `${S}/spec/${c.nn}/${id}-${theme}.png`;
      const [sw, sh] = size(spec);
      let impl = null;
      let note = '';
      if (m.impl) {
        const src = `${S}/impl-out/${c.dir}/${m.impl}-${theme}.jpg`;
        if (existsSync(src)) {
          impl = `${S}/tmp-impl.png`;
          if (m.crop) {
            const [x, y, w, h] = m.crop;
            mg(src, '-crop', `${w}x${h}+${x}+${y}`, '+repage', impl);
            note = `IMPL cropped to ${w}x${h}+${x}+${y}`;
          } else mg(src, impl);
        }
      }
      if (!impl) {
        impl = `${S}/tmp-impl.png`;
        mg('-background', '#2a2d33', '-fill', '#eeeeee', '-font', FONT, '-pointsize', '20', '-gravity', 'center', '-size', '520x300', `caption:NOT REACHABLE IN THE APP. ${m.reason || ''}`, impl);
      }
      const [iw, ih] = size(impl);
      const H = Math.max(sh, ih);
      const L = `${S}/tmp-l.png`;
      const R = `${S}/tmp-r.png`;
      mg(spec, '-background', '#555', '-gravity', 'northwest', '-extent', `${sw}x${H}`, L);
      mg(impl, '-background', '#555', '-gravity', 'northwest', '-extent', `${iw}x${H}`, R);
      const out = `${full}/${id}-${theme}.png`;
      const label = `${id} · ${theme}    SPEC (left, ${sw}x${sh})  |  IMPL (right, ${iw}x${ih})${note ? '  · ' + note : ''}${m.impl ? '' : '  · no impl frame'}`;
      mg(L, '(', '-size', '12x' + H, 'xc:#ff3b6b', ')', R, '+append', '-background', '#111', '-gravity', 'northwest', '-splice', '0x40', '-font', FONT, '-fill', 'white', '-pointsize', '22', '-annotate', '+12+8', label, out);
      mg(out, '-resize', '1100x>', '-strip', '-quality', '55', `${ev}/${id}-${theme}.jpg`);
      rows.push({ canvas, id, theme, reached: !!m.impl && impl !== null });
      console.log(canvas, id, theme);
    }
  }
}
if (!process.env.ONLY) writeFileSync(`${S}/pairs-rows.json`, JSON.stringify(rows));
