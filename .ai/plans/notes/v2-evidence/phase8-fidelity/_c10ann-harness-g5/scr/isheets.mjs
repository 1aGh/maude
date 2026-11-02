// impl-only review sheets. usage: bun isheets.mjs <dir> <theme> [per=6] [w=640] [cols=3]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = import.meta.dirname;
const [dir, theme, per = '6', w = '640', cols = '3'] = process.argv.slice(2);
mkdirSync(join(ROOT, 'sheets'), { recursive: true });
const files = readdirSync(join(ROOT, 'impl', dir)).filter((f) => f.endsWith(`-${theme}.png`) && !f.endsWith('.crop.png')).sort();
for (let i = 0; i * +per < files.length; i++) {
  const chunk = files.slice(i * +per, (i + 1) * +per).map((f) => join(ROOT, 'impl', dir, f));
  const out = join(ROOT, 'sheets', `${dir}-${theme}-${i + 1}.jpg`);
  spawnSync('magick', ['montage', '-label', '%t', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '16', ...chunk, '-resize', `${w}x`, '-tile', `${cols}x`, '-geometry', '+4+4', '-background', '#888', '-fill', 'white', '-quality', '70', out]);
  console.log(out);
}
