// /_sync-status never serves a previous process's verdict. An unlinked project
// keeps the last session's `_sync.json` on disk (it is runtime state), and the
// shell used to greet the designer with "Working offline · 0 edit(s) queued"
// against a hub that was no longer linked at all (desktop cloud-attach E2E).

import { expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

test('a status file older than this server process reads as not linked', async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(
    join(designRoot, '_sync.json'),
    JSON.stringify({ state: 'offline', url: 'http://127.0.0.1:53448', updatedAt: Date.now() - 60_000 })
  );
  const port = nextPort();
  const proc = await bootServer(root, port);
  try {
    const stale = await (await fetch(`http://localhost:${port}/_sync-status`)).json();
    expect(stale).toEqual({ linked: false });
    // A payload this process wrote (stamped after boot) is served as-is.
    const fresh = { state: 'online', url: 'http://127.0.0.1:1', updatedAt: Date.now() + 1000 };
    writeFileSync(join(designRoot, '_sync.json'), JSON.stringify(fresh));
    expect(await (await fetch(`http://localhost:${port}/_sync-status`)).json()).toEqual(fresh);
  } finally {
    await killProc(proc);
  }
}, 30_000);
