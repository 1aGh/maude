// node show.mjs <file-fragment> [incomplete]
import { readFileSync, readdirSync } from 'node:fs';
import { OUT } from './drv.mjs';
const frag = process.argv[2];
const which = process.argv[3] === 'incomplete' ? 'inc' : 'viol';
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.json') && f.includes(frag))) {
  const j = JSON.parse(readFileSync(`${OUT}/${f}`, 'utf8'));
  for (const v of j[which])
    for (const n of v.nodes) {
      console.log(f, v.id, JSON.stringify(n.target), n.html.slice(0, 90), '\n    ', (n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 330));
    }
}
