// contact sheets of the IMPL shots (for a quick scan): bun mkcontact.mjs
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const ROOT = import.meta.dirname;
mkdirSync(join(ROOT, 'sheets'), { recursive: true });
for (const dir of ['13-design-system', '14-editing']) {
  for (const theme of ['light', 'dark']) {
    const files = readdirSync(join(ROOT, 'impl', dir)).filter((f) => f.endsWith(`-${theme}.png`) && !f.includes('crop')).sort();
    for (let i = 0; i * 12 < files.length; i++) {
      const chunk = files.slice(i * 12, (i + 1) * 12).map((f) => join(ROOT, 'impl', dir, f));
      spawnSync('magick', ['montage', '-label', '%t', '-font', '/System/Library/Fonts/Supplemental/Arial.ttf', '-pointsize', '16', ...chunk, '-resize', '700x', '-tile', '3x', '-geometry', '+4+4', '-background', '#777', '-fill', 'white', join(ROOT, 'sheets', `c-${dir}-${theme}-${i + 1}.jpg`)]);
    }
  }
}
console.log(readdirSync(join(ROOT, 'sheets')).filter((f) => f.startsWith('c-')).join(' '));
