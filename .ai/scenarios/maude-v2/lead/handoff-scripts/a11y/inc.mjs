import { readFileSync, readdirSync } from 'node:fs';
import { OUT } from './drv.mjs';
const agg = new Map();
for (const f of readdirSync(OUT).filter((f) => f.endsWith('.json'))) {
  const j = JSON.parse(readFileSync(`${OUT}/${f}`, 'utf8'));
  for (const v of j.inc)
    for (const n of v.nodes) {
      const key = `${v.id} ${JSON.stringify(n.target).replace(/:nth-child\(\d+\)/g, '')}`;
      const e = agg.get(key) ?? { n: 0, files: new Set(), msg: '', html: '' };
      e.n++;
      e.files.add(f.split('-')[0]);
      e.msg = (n.any?.[0]?.message ?? n.failureSummary ?? '').replace(/\s+/g, ' ').slice(0, 140);
      e.html = n.html.slice(0, 90);
      agg.set(key, e);
    }
}
for (const [k, e] of [...agg].sort((a, b) => b[1].n - a[1].n)) console.log(e.n, [...e.files].join('/'), k.slice(0, 120), '|', e.html, '|', e.msg);
