import { readFileSync, existsSync } from 'node:fs';
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f = (a) => `${med(a)} [${Math.min(...a)}–${Math.max(...a)}]`;
for (const tag of ['heavy-m', 'b48-m', 'b48-wm', 'heavy-wm']) {
  console.log(`## ${tag}\ncond | frames | p50 | p95 | p99 | max | >33 | >50 | gBCR/10s | peerCur | peerSel | ownHalo | load1`);
  for (const C of ['C0', 'C1', 'C1f', 'C2', 'C3', 'CX']) {
    const p = `raw/exp4-${tag}-${C}.json`; if (!existsSync(p)) continue;
    const j = JSON.parse(readFileSync(p, 'utf8')); if (!j.length) { console.log(C, '| no data'); continue; }
    const g = (k) => f(j.map((r) => r.canvas[k] ?? 0));
    console.log([C, g('frames'), g('p50'), g('p95'), g('p99'), g('max'), g('over33'), g('over50'), g('gbcr'), g('foreignCursors'), g('peerSel'), g('ownHalos'), j.map((r) => r.load.split(' ')[1]).join('/')].join(' | '));
  }
}
