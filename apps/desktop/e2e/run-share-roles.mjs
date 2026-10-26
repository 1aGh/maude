#!/usr/bin/env node
// The share-roles lane's runner (S9.21c · V2-8.3): stands up the world the scenario needs, writes the run file
// `wdio.share-roles.conf.ts` reads (`MAUDE_SHARE_ROLES_CONFIG`), runs wdio, and tears everything down.
//
//   pnpm --filter @maude/desktop-e2e e2e:share-roles            stand up → wdio → tear down (needs a screen)
//   pnpm --filter @maude/desktop-e2e e2e:share-roles -- --setup-only
//                                                               stand up and wait (Ctrl-C tears down): the run
//                                                               file's path is printed, wdio is yours to start
//   pnpm --filter @maude/desktop-e2e e2e:share-roles -- --check stand up, verify, tear down (no wdio, no screen)
//   MAUDE_SHARE_ROLES_CONFIG=<run.json> … e2e:share-roles:wdio  the old way, against a world you made yourself
//
// What it stands up, and what is real, is in share-roles/stand-up.mjs. Needs: Node 24 on PATH (the hub's
// better-sqlite3), bun (the people's studios), and — for wdio — the debug app (`pnpm test:e2e:desktop:build`).
// Nothing here touches ~/.config/maude, a real hub, a production cell, Stripe or Cloudflare.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { standUp } from './share-roles/stand-up.mjs';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
// Evidence outlives the throwaway world: the same place the cloud lane keeps its runs.
const out =
  process.env.MAUDE_E2E_RUN_DIR ||
  resolve(
    HERE,
    '../../../.ai/device/scenario-runs/share-roles',
    new Date().toISOString().slice(0, 16).replace('T', '-').replace(':', '')
  );

const world = await standUp({
  out,
  keep: flag('--setup-only'),
  log: (l) => console.log(`[share-roles] ${l}`),
});
let done = false;
const finish = async (code) => {
  if (done) return;
  done = true;
  await world.stop();
  process.exit(code);
};
for (const sig of ['SIGINT', 'SIGTERM']) process.once(sig, () => finish(130));

console.log(`[share-roles] run file ${world.runFile}`);
console.log(`[share-roles] evidence ${world.run.out}`);

if (flag('--check')) {
  const ok = world.run.lukas.url && (await fetch(`${world.run.lukas.url}/_health`)).ok;
  await finish(ok ? 0 : 1);
} else if (flag('--setup-only')) {
  console.log(
    `[share-roles] ready — MAUDE_SHARE_ROLES_CONFIG=${world.runFile} pnpm --filter @maude/desktop-e2e e2e:share-roles:wdio`
  );
  await new Promise(() => {}); // until a signal
} else {
  // the package's own wdio — pnpm puts node_modules/.bin on PATH, a plain `node run-share-roles.mjs` does not
  const wdio = spawn(
    resolve(HERE, 'node_modules/.bin/wdio'),
    ['run', './wdio.share-roles.conf.ts'],
    {
      cwd: HERE,
      stdio: 'inherit',
      env: { ...process.env, MAUDE_SHARE_ROLES_CONFIG: world.runFile },
    }
  );
  wdio.on('error', (e) => {
    console.error(`[share-roles] could not start wdio: ${e.message}`);
    finish(1);
  });
  wdio.on('exit', (code, signal) => finish(code ?? (signal ? 1 : 0)));
}
