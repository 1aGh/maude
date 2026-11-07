import { readFileSync } from 'node:fs';
import { isRigError } from '../scripts/v2-verify/dead-controls/report.mjs';
const norm = (c) =>
  c
    .replace(/^\w+:/, '')
    .replace(/^<(?:open|re-toggle|again, clean:|read) (.*?)(?: again)?>$/, '$1');
const all = {};
for (const f of ['a', 'b2', 'F1-old']) {
  const p = JSON.parse(readFileSync(`dcs/${f}.json`, 'utf8'));
  const st = new Set();
  for (const r of p.results) {
    if ((r.effect === 'disabled' && !r.note) || r.effect === 'DEAD') st.add(`${r.mode}|${r.surface}`);
  }
  const errs = p.errors.filter((e) => !isRigError(e) && /http (409|422|404)/.test(e.kind));
  const names = new Set(errs.map((e) => `${e.mode}|${norm(e.control)}`));
  for (const r of p.results) {
    const n = `${r.mode}|${r.control}`;
    if (names.has(n)) st.add(`${r.mode}|${r.surface}`);
    for (const seg of r.surface.split(' › ')) if (names.has(`${r.mode}|${seg}`) && r.effect !== 'unreachable') st.add(`${r.mode}|${r.surface}`);
  }
  console.log(f, 'err names', [...names].filter((n) => !/canvas removed/.test(n)).length, 'stale states', st.size);
  all[f] = [...st];
}
console.log(all.a.slice(0, 40).join('\n'));
