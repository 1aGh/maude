import * as d from './drv.mjs';
console.log(d.ab('set', 'media', 'reduced-motion').out);
console.log(d.ev('JSON.stringify({rm:matchMedia("(prefers-reduced-motion: reduce)").matches,cs:matchMedia("(prefers-color-scheme: dark)").matches})'));
import { readFileSync } from 'node:fs';
const j = JSON.parse(readFileSync(d.OUT + '/dark-canvas-smoke-inspector.json', 'utf8'));
for (const v of j.inc) for (const n of v.nodes) console.log(v.id, JSON.stringify(n.target), n.html.slice(0, 100), JSON.stringify(n.any?.[0]?.data ?? n.any?.[0]?.message ?? '').slice(0, 200));
