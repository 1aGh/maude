#!/usr/bin/env node
// scripts/v2-perf-boot.mjs — boot ONE studio server from a given checkout against a fixture
// project, in a throwaway HOME (V2-8.8 / V2-8.14 harness). Prints `READY <port>` on stdout once
// `/_health` answers, then stays up until it is killed (SIGTERM stops the child too).
//
//   node scripts/v2-perf-boot.mjs --studio <apps/studio dir> --root <project> --port <n> --home <dir>
//
// Safety (memories maude-fake-home-real-claude-keychain, maude-servers-no-open): HOME and
// XDG_CONFIG_HOME point at --home, a stub `claude` is first on PATH, NO_OPEN=1 and
// MAUDE_NO_AUTOBUILD=1 are set, and the index/log caches live under --home. The server runs from
// --studio, so the same script boots a pre-v2 checkout (a `main` worktree) and the v2 one.
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { stubClaudeEnv } from './lib/stub-claude.mjs';

const argv = process.argv.slice(2);
const opt = (k, d) => {
  const i = argv.indexOf(k);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};
const studio = resolve(opt('--studio', fileURLToPath(new URL('../apps/studio', import.meta.url))));
const root = resolve(opt('--root', ''));
const port = Number(opt('--port', '4811'));
const home = resolve(opt('--home', ''));
if (!opt('--root', '') || !opt('--home', '')) {
  console.error('usage: v2-perf-boot.mjs --studio <dir> --root <project> --port <n> --home <dir>');
  process.exit(2);
}
mkdirSync(home, { recursive: true });
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: join(home, '.config'),
  ...stubClaudeEnv(home),
  NO_OPEN: '1',
  MAUDE_PORT_BASE: process.env.MAUDE_PORT_BASE ?? '48399', // never the person's 4399–4408 (port.ts)
  MAUDE_NO_AUTOBUILD: '1',
  MAUDE_INDEX_DIR: join(home, 'index'),
  MAUDE_LOG_DIR: join(home, 'logs'),
  MAUDE_UI_PREFS_PATH: join(home, '.config', 'maude', 'prefs.json'),
  MAUDE_CLOUD_CONFIG: join(home, '.config', 'maude', 'cloud.json'),
};
const child = spawn(
  'bun',
  ['run', join(studio, 'server.ts'), '--root', root, '--port', String(port)],
  {
    env,
    stdio: ['ignore', 'inherit', 'inherit'],
    cwd: root,
  }
);
const stop = () => {
  child.kill('SIGTERM');
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
child.on('exit', (code) => process.exit(code ?? 1));
for (let i = 0; i < 120; i++) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const res = await fetch(`http://127.0.0.1:${port}/_health`);
    if (res.ok) {
      console.log(`READY ${port}`);
      break;
    }
  } catch {}
  if (i === 119) {
    console.error('server never became healthy');
    stop();
  }
}
