// review sheets: N pairs stacked per image. usage: bun mksheets.mjs <theme> <perSheet> [width]
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = import.meta.dirname;
const [theme = 'light', per = '3', width = '1500'] = process.argv.slice(2);
mkdirSync(join(ROOT, 'sheets'), { recursive: true });
for (const dir of ['13-design-system', '14-editing', '15-annotations']) {
  const files = readdirSync(join(ROOT, 'pairs', dir)).filter((f) => f.endsWith(`-${theme}.png`)).sort();
  for (let i = 0; i * +per < files.length; i++) {
    const chunk = files.slice(i * +per, (i + 1) * +per).map((f) => join(ROOT, 'pairs', dir, f));
    spawnSync('magick', ['montage', '-label', '%t', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '14', ...chunk, '-resize', `${width}x`, '-tile', '1x', '-geometry', '+2+2', '-background', '#777', join(ROOT, 'sheets', `${dir}-${theme}-${String(i + 1).padStart(2, '0')}.jpg`)]);
  }
}
console.log(readdirSync(join(ROOT, 'sheets')).length);
