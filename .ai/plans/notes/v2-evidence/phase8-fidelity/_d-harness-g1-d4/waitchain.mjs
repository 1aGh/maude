import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const f = join(import.meta.dirname, '../chain.log');
const t = Date.now();
const iv = setInterval(() => {
  let s = '';
  try { s = readFileSync(f, 'utf8'); } catch {}
  if (s.includes('DONE') || Date.now() - t > 560000) { console.log(s); clearInterval(iv); }
}, 5000);
