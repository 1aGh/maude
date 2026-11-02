// usage: node rows.mjs rects-<name>.json  → per row: y, tallest, gap to next row's top, overlaps
import { readFileSync } from 'node:fs';
const m = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const a = m.artboards.map((r) => ({ ...r, y: Math.round(r.y), h: Math.round(r.h), x: Math.round(r.x), w: Math.round(r.w) }));
const byY = new Map();
for (const r of a) byY.set(r.y, [...(byY.get(r.y) ?? []), r]);
const rows = [...byY.entries()].sort((p, q) => p[0] - q[0]);
let prevBottom = null;
let total = 0;
for (const [y, row] of rows) {
  const tall = Math.max(...row.map((r) => r.h));
  const gap = prevBottom === null ? '-' : y - prevBottom;
  console.log(`y=${y}\tn=${row.length}\ttallest=${tall}\tgap-above=${gap}`);
  prevBottom = y + tall;
}
const top = Math.min(...a.map((r) => r.y));
const bot = Math.max(...a.map((r) => r.y + r.h));
console.log('total height', bot - top);
let ov = 0;
for (let i = 0; i < a.length; i++)
  for (let j = i + 1; j < a.length; j++) {
    const p = a[i], q = a[j];
    if (p.x < q.x + q.w - 1 && q.x < p.x + p.w - 1 && p.y < q.y + q.h - 1 && q.y < p.y + p.h - 1) ov++;
  }
console.log('overlapping pairs', ov);
