// Seed two fixture projects + their machine-index entries for home.e2e.ts (V2-3.3).
//
// Run with bun (the studio's index service is bun-native), with MAUDE_INDEX_DIR already
// pointing at a fresh temp dir: `MAUDE_INDEX_DIR=… bun fixtures/seed-home-index.ts`. The
// projects are written the way apps/studio/test/_home-fixtures.ts builds them for the Home
// server's own tests: a snapshot as the project's server writes it, one canvas with a cover
// picture, and `_canvas-state/_recent.json` saying the canvas was opened (Home's "recent" rows).
// Prints one JSON line: [{ name, root, pid, rel }].

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { addCover, makeProject } from '../../../studio/test/_home-fixtures.ts';
import { writeThumb } from '../../../studio/thumbs/store.ts';

if (!process.env.MAUDE_INDEX_DIR) throw new Error('set MAUDE_INDEX_DIR first');

// The studio fixture's 1×1 JPEG passes checkJpeg but WebKit can't decode it, so the
// page would (rightly) show an empty picture. Convert the app icon into a real one.
const ICON = resolve(dirname(fileURLToPath(import.meta.url)), '../../src-tauri/icons/128x128.png');
const jpegOut = join(mkdtempSync(join(tmpdir(), 'maude-home-e2e-pic-')), 'pic.jpg');
execFileSync('sips', ['-s', 'format', 'jpeg', ICON, '--out', jpegOut], { stdio: 'ignore' });
const PICTURE = new Uint8Array(readFileSync(jpegOut));

const projects = [
  { name: 'alpha', rel: 'ui/alpha-board.tsx', label: 'Alpha', key: 'a'.repeat(64) },
  { name: 'beta', rel: 'ui/beta-board.tsx', label: 'Beta', key: 'b'.repeat(64) },
];

const out = [];
let at = Date.now();
for (const p of projects) {
  const fx = makeProject(p.name, { [p.rel]: p.label });
  addCover(fx, p.rel, p.key);
  writeThumb(fx.pid, p.key, PICTURE);
  mkdirSync(join(fx.designRoot, '_canvas-state'), { recursive: true });
  writeFileSync(
    join(fx.designRoot, '_canvas-state', '_recent.json'),
    JSON.stringify({ opened: { [p.rel]: at-- } })
  );
  out.push({ name: p.name, root: fx.root, pid: fx.pid, rel: p.rel });
}
console.log(JSON.stringify(out));
