// usage: node views.mjs <theme> → .scr/views/<NN>/<id>-<theme>.jpg (1800 px wide)
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
const R = join(import.meta.dirname, '..');
const theme = process.argv[2] || 'light';
for (const n of ['01', '02', '05']) {
  mkdirSync(join(R, 'views', n), { recursive: true });
  for (const f of readdirSync(join(R, 'pairs', n)).filter((x) => x.endsWith(`-${theme}.png`))) {
    execFileSync('magick', [join(R, 'pairs', n, f), '-resize', '1900x>', '-quality', '72', join(R, 'views', n, f.replace('.png', '.jpg'))]);
  }
}
console.log('ok');
