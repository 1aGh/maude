#!/usr/bin/env bun
// gen-shell-parity.mjs — the v2 shell parity contract as a committed file (Maude v2, V2-4.9).
//
// apps/studio/client/v2/shell/shell-parity.js derives the contract from the registry and the shell's
// own models; this writes it to apps/studio/client/v2/shell/shell-parity.json, which the desktop e2e
// (apps/desktop/e2e/scenarios/shell-parity.e2e.ts) reads — a wdio spec cannot import the client's
// TypeScript/JSX graph. test/v2-shell-parity.test.tsx fails when the committed file is stale.
//
// Usage (repo root; needs bun, the client graph imports .jsx):
//   bun scripts/gen-shell-parity.mjs            write the file
//   bun scripts/gen-shell-parity.mjs --check    exit 1 when the committed file differs

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'apps/studio/client/v2/shell/shell-parity.json');
const { buildParity } = await import('../apps/studio/client/v2/shell/shell-parity.js');

// Through Biome (the repo's formatter), so `pnpm lint` and --check agree byte for byte.
const raw = `${JSON.stringify(buildParity(), null, 2)}\n`;
const fmt = spawnSync(
  join(ROOT, 'node_modules/.bin/biome'),
  ['format', `--stdin-file-path=${OUT}`],
  { input: raw, encoding: 'utf8' }
);
const text = fmt.status === 0 ? fmt.stdout : raw;
if (process.argv.includes('--check')) {
  if (!existsSync(OUT) || readFileSync(OUT, 'utf8') !== text) {
    console.error(
      'gen-shell-parity: shell-parity.json is stale — run `bun scripts/gen-shell-parity.mjs`'
    );
    process.exit(1);
  }
  console.log('gen-shell-parity: up to date');
} else {
  writeFileSync(OUT, text);
  console.log(`gen-shell-parity: wrote ${OUT}`);
}
