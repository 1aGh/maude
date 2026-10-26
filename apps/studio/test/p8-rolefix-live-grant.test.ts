// p8-e2e-rolefix (2) — the grant changes live: the claim is re-exchanged and hubs.json rewritten (a raise
// closes no socket — only a narrowing does, S9.12b). The shell must hear it and re-read `/_config`, or the
// canvas Petra may now edit stays Viewing until a reload. The desktop's shell socket gets
// `{ type: 'access-changed' }` on every hubs.json change; the server's doors are untouched.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const HUB_URL = 'http://hub.invalid:9';
let proc: Subprocess | null = null;
let base = '';
let hubsPath = '';

const writeGrant = (r: string) =>
  writeFileSync(
    hubsPath,
    JSON.stringify({
      hubs: {
        [HUB_URL]: {
          token: `t-${r}-${Date.now()}`,
          linkedAt: Date.now(),
          role: 'viewer',
          access: { v: 1, role: null, grants: [{ c: 'ui/a.tsx', r }] },
        },
      },
    })
  );

beforeAll(async () => {
  const { root, designRoot } = makeSandbox();
  writeFileSync(join(designRoot, 'ui', 'a.tsx'), 'export default () => <div/>;\n');
  const cfgPath = join(designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  cfg.linkedHub = { url: HUB_URL, linkedAt: Date.now() };
  writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
  hubsPath = join(root, 'hubs.json');
  writeGrant('observer');
  const port = nextPort();
  proc = await bootServer(root, port, { HUBS_CONFIG_PATH: hubsPath });
  base = `http://localhost:${port}`;
}, 60000);
afterAll(async () => {
  if (proc) await killProc(proc);
});

describe('a live grant change reaches the shell', () => {
  test('Can view → Can edit on her canvas: the shell socket hears access-changed, /_config says member', async () => {
    const frames: Array<{ type?: string }> = [];
    const ws = new WebSocket(`${base.replace('http', 'ws')}/_ws`);
    await new Promise<void>((res, rej) => {
      ws.addEventListener('open', () => res());
      ws.addEventListener('error', () => rej(new Error('socket did not open')));
    });
    ws.addEventListener('message', (e) => {
      try {
        frames.push(JSON.parse(String(e.data)));
      } catch {
        /* binary */
      }
    });
    await Bun.sleep(300);
    writeGrant('member');
    const end = Date.now() + 5000;
    while (Date.now() < end && !frames.some((f) => f.type === 'access-changed'))
      await Bun.sleep(100);
    ws.close();
    expect(frames.some((f) => f.type === 'access-changed')).toBe(true);
    const cfg = (await (await fetch(`${base}/_config`)).json()) as { access?: unknown };
    expect(cfg.access).toEqual({ role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });
  }, 20000);
});
