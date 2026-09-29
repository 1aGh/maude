// node summarize.mjs <suffix e.g. chromium-t1>  → median [min–max] per metric per condition
import { readFileSync, existsSync } from 'node:fs';
const suf = process.argv[2];
const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
const f = (a) => `${med(a)} [${Math.min(...a)}–${Math.max(...a)}]`;
const keys = [['p50', (r) => r.canvas.p50], ['p95', (r) => r.canvas.p95], ['max', (r) => r.canvas.max], ['>33ms', (r) => r.canvas.over33], ['longT', (r) => r.canvas.longtasks], ['gBCR/10s', (r) => r.canvas.gbcr], ['overlayR', (r) => r.canvas.overlayRenders], ['memoChildR', (r) => r.canvas.overlayChildRenders], ['peerSelR', (r) => r.canvas.selChildRenders], ['partsR', (r) => r.canvas.participantsRenders], ['shellP95', (r) => r.shell.p95], ['shellLongT', (r) => r.shell.longtasks]];
console.log(['cond', ...keys.map((k) => k[0]), 'pre(own/peerSel)'].join(' | '));
for (const C of ['C0', 'C1', 'C2', 'C3', 'C4']) {
  const p = `raw/exp2-${C}-${suf}.json`;
  if (!existsSync(p)) continue;
  const j = JSON.parse(readFileSync(p, 'utf8'));
  console.log([C, ...keys.map(([, g]) => f(j.map(g).map((v) => v ?? 0))), j.map((r) => `${r.pre?.ownHalos}/${r.pre?.peerSel}`).join(',')].join(' | '));
}
