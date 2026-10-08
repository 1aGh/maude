#!/usr/bin/env node
// `claude-design-server` — legacy direct alias for the design dev server.
// Historically this bin WAS the zero-dep Node server (apps/studio/server.mjs);
// that server is gone (Bun authoritative since DDR-009, deleted in the post-1.0
// hardening pass), so the alias now forwards to `maude design serve`, which owns
// binary resolution, the RCA G3 bun shim, and the loud no-runtime refusal.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const maude = resolve(fileURLToPath(import.meta.url), '..', 'maude.mjs');
const child = spawn(process.execPath, [maude, 'design', 'serve', ...process.argv.slice(2)], {
  stdio: 'inherit',
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (err) => {
  process.stderr.write(`claude-design-server: ${err.message}\n`);
  process.exit(1);
});
