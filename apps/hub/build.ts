#!/usr/bin/env bun
// Bundle src/server.mjs → dist/hub.bundle.mjs.
//
// Mirrors apps/studio/build.ts conventions per DDR-009
// (Bun runtime authoritative). The Hocuspocus + Yjs + ws + sql-tagged-template
// graph inlines; SQLite's native binding (better-sqlite3 / Bun's bun:sqlite)
// stays external so it loads at runtime against the host platform.
//
// Modes:
//   bun run build.ts             dev bundle (no minify)
//   bun run build.ts --release   minified bundle, prints size
//   bun run build.ts --dry-run   exit 0 without writing files

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));
const DIST = join(ROOT, 'dist');
const ENTRY = join(ROOT, 'src/server.mjs');
const ADMIN_SRC = join(ROOT, 'src/admin');
const ADMIN_DEST = join(DIST, 'admin');

const ARGS = new Set(process.argv.slice(2));
const MODE: 'dev' | 'release' | 'dry' = ARGS.has('--dry-run')
  ? 'dry'
  : ARGS.has('--release')
    ? 'release'
    : 'dev';

if (!existsSync(ENTRY)) {
  console.error(`[hub-build] missing entry: ${ENTRY}`);
  process.exit(1);
}

if (MODE === 'dry') {
  console.log('[hub-build] dry-run OK; entry exists, no output written.');
  process.exit(0);
}

if (!existsSync(DIST)) mkdirSync(DIST, { recursive: true });

const result = await Bun.build({
  entrypoints: [ENTRY],
  outdir: DIST,
  target: 'node',
  format: 'esm',
  minify: MODE === 'release',
  // Native SQLite bindings load at runtime against the host platform.
  // Hocuspocus' sqlite extension uses better-sqlite3 by default. oxc-parser
  // (the studio's source validator, shared by the workspace agent) is a napi
  // module too: its platform binding resolves from node_modules at runtime.
  external: ['better-sqlite3', 'bun:sqlite', 'node:sqlite', 'oxc-parser'],
  // Stable single-file emit; entry basename is `server` from `src/server.mjs`.
  // We rename below for the dist/hub.bundle.mjs contract.
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// Bun.build emits dist/server.js (format=esm, target=node). Rename to the
// Phase 9 plan's contract path: dist/hub.bundle.mjs.
const emitted = result.outputs[0]?.path;
if (!emitted) {
  console.error('[hub-build] Bun.build produced no output paths');
  process.exit(1);
}
const finalPath = join(DIST, 'hub.bundle.mjs');
if (emitted !== finalPath) {
  if (existsSync(finalPath)) unlinkSync(finalPath);
  renameSync(emitted, finalPath);
}

// Tidy any sibling chunks Bun may have emitted (e.g. dist/server.js.map in
// minified mode) so the dist directory has one canonical file per release.
for (const sibling of readdirSync(DIST)) {
  const p = join(DIST, sibling);
  if (p !== finalPath && (sibling.startsWith('server') || sibling.endsWith('.bundle.mjs.map'))) {
    try {
      unlinkSync(p);
    } catch {
      /* best-effort */
    }
  }
}

// Second entry: the cold-start rehydrate (Cloud Phase 15). The cell image
// ships only `dist/`, and its entrypoint invokes this before the server —
// so a rehydrate that lives only in `src/` is a rehydrate the cell cannot
// run. That is exactly what shipped: the entrypoint had called
// `src/rehydrate.mjs` since Phase 5 against an image that contained neither
// the file nor `src/`.
const REHYDRATE_ENTRY = join(ROOT, 'src/rehydrate.mjs');
if (!existsSync(REHYDRATE_ENTRY)) {
  console.error(`[hub-build] missing entry: ${REHYDRATE_ENTRY}`);
  process.exit(1);
}
const rehydrate = await Bun.build({
  entrypoints: [REHYDRATE_ENTRY],
  outdir: DIST,
  target: 'node',
  format: 'esm',
  minify: MODE === 'release',
  external: ['better-sqlite3', 'bun:sqlite', 'node:sqlite', 'oxc-parser'],
});
if (!rehydrate.success) {
  for (const log of rehydrate.logs) console.error(log);
  process.exit(1);
}
// Bun names the output from the entry basename with a .js extension; the cell
// entrypoint's contract is dist/rehydrate.mjs.
const rehydrateEmitted = rehydrate.outputs[0]?.path;
const rehydrateFinal = join(DIST, 'rehydrate.mjs');
if (!rehydrateEmitted) {
  console.error('[hub-build] Bun.build produced no rehydrate output');
  process.exit(1);
}
if (rehydrateEmitted !== rehydrateFinal) {
  if (existsSync(rehydrateFinal)) unlinkSync(rehydrateFinal);
  renameSync(rehydrateEmitted, rehydrateFinal);
}

const sizeKb = Math.round(statSync(finalPath).size / 1024);
console.log(`[hub-build] ${MODE} → dist/hub.bundle.mjs (${sizeKb} KB)`);
console.log(`[hub-build] ${MODE} → dist/rehydrate.mjs`);

// Phase 9 plan Validation §1 budget: hub bundle ≤ 5 MB.
const BUDGET_KB = 5 * 1024;
if (sizeKb > BUDGET_KB) {
  console.error(`[hub-build] over budget: ${sizeKb} KB > ${BUDGET_KB} KB ceiling`);
  process.exit(1);
}

// Copy src/admin → dist/admin so the bundle's admin-assets.mjs (which reads
// `<dirname(import.meta.url)>/admin/*`) finds the files alongside the bundle.
// This is the Task 2.5 packaging contract — see src/admin-assets.mjs.
if (existsSync(ADMIN_SRC)) {
  if (existsSync(ADMIN_DEST)) rmSync(ADMIN_DEST, { recursive: true, force: true });
  cpSync(ADMIN_SRC, ADMIN_DEST, { recursive: true });
  const adminBytes = readdirSync(ADMIN_DEST).reduce(
    (sum, f) => sum + statSync(join(ADMIN_DEST, f)).size,
    0
  );
  console.log(
    `[hub-build] copied src/admin → dist/admin (${Math.round(adminBytes / 1024)} KB raw)`
  );
} else {
  console.warn('[hub-build] WARNING: src/admin missing — admin UI will not ship.');
}
