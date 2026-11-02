// bun .scr/seed-home.ts  (MAUDE_INDEX_DIR set) → seeds a machine index with Alligators-like projects; prints JSON
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { addCover, indexProject, makeProject } from '../apps/studio/test/_home-fixtures.ts';
import { writeThumb } from '../apps/studio/thumbs/store.ts';

if (!process.env.MAUDE_INDEX_DIR) throw new Error('set MAUDE_INDEX_DIR first');
const dir = mkdtempSync(join(tmpdir(), 'maude-home-pics-'));
const pic = (name: string, bg: string, fg: string) => {
  const out = join(dir, name + '.jpg');
  execFileSync('magick', ['-size', '480x360', `gradient:${bg}-${fg}`, out], { stdio: 'ignore' });
  return new Uint8Array(readFileSync(out));
};

const projects = [
  { name: 'Alligators brand', canvases: { 'ui/2026/Uniformy-2027.tsx': 'Uniformy-2027', 'ui/2026/Combine-kampan.tsx': 'Combine-kampan', 'ui/social/matchday.tsx': 'matchday' }, c: ['#dfe3ea', '#7ed6a0'] },
  { name: 'Studio site', canvases: { 'ui/Homepage.tsx': 'Homepage', 'ui/Pricing.tsx': 'Pricing' }, c: ['#8fd3f4', '#ffffff'] },
  { name: 'Portfolio 2026', canvases: { 'ui/Mobilni-app.tsx': 'Mobilní app — case study' }, c: ['#c9b6f2', '#f6d7f0'] },
  { name: 'Sponzoři 2027', canvases: { 'ui/Sponzori.tsx': 'Sponzoři' }, c: ['#7ed6a0', '#e8f7ee'] },
  { name: 'Open studio', canvases: { 'ui/Open.tsx': 'Open' }, c: ['#ffb4a2', '#ffe8d6'] },
];
const out: unknown[] = [];
let at = Date.now() - 300_000;
for (const p of projects) {
  const fx = makeProject(p.name, p.canvases);
  mkdirSync(join(fx.designRoot, '_canvas-state'), { recursive: true });
  const opened: Record<string, number> = {};
  let i = 0;
  for (const [rel, label] of Object.entries(p.canvases)) {
    const key = (0x1000 + out.length * 16 + i++).toString(16).padEnd(64, 'a');
    addCover(fx, rel, key);
    writeThumb(fx.pid, key, pic(label.replace(/\W+/g, ''), p.c[0], p.c[1]));
    opened[rel] = at;
    at -= 1_800_000;
  }
  indexProject(fx.root, p.name);
  writeFileSync(join(fx.designRoot, '_canvas-state', '_recent.json'), JSON.stringify({ opened }));
  out.push({ name: p.name, root: fx.root, pid: fx.pid, rels: Object.keys(p.canvases) });
}
console.log(JSON.stringify(out));
