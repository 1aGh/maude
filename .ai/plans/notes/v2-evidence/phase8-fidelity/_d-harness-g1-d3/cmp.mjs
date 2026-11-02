import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const [a, b] = process.argv.slice(2);
for (const f of readdirSync(b)) {
  const r = spawnSync('magick', ['compare', '-metric', 'AE', `${a}/${f}`, `${b}/${f}`, 'null:'], { encoding: 'utf8' });
  const v = (r.stderr || '').trim();
  if (v !== '0') console.log(f, v);
}
