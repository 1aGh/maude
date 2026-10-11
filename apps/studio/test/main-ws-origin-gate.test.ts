// Phase 2 gate — CSWSH on the main origin's collab + inspector sockets. A WebSocket
// handshake bypasses the same-origin policy, and a loopback Host is what EVERY page in
// the user's browser sends to `ws://localhost:<port>`, so the loopback gate alone let a
// drive-by site open `/_ws/collab/<slug>` (realm 'main' — ungated Y-doc writes) and the
// inspector `/_ws`. `/_ws/acp` already had the Origin check (acp-origin-gate.test.ts);
// these two now share it. A plain GET with no Upgrade headers passes the gate and then
// fails the upgrade → 400, so 400 = "gate passed", 403 = "gate refused".

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { rmSync } from 'node:fs';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox;
let proc: Subprocess;
let main: string;

beforeAll(async () => {
  box = makeSandbox();
  const port = nextPort();
  proc = await bootServer(box.root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    NO_OPEN: '1',
    MAUDE_CANVAS_ORIGIN_SPLIT: '1',
  });
  main = `http://localhost:${port}`;
});
afterAll(async () => {
  await killProc(proc);
  rmSync(box.root, { recursive: true, force: true });
});

const status = async (path: string, origin?: string) =>
  (
    await fetch(main + path, {
      headers: origin ? { Origin: origin } : {},
      signal: AbortSignal.timeout(3000),
    })
  ).status;

describe('main-origin sockets refuse a cross-origin handshake', () => {
  for (const path of ['/_ws/collab/ui-card', '/_ws']) {
    test(`${path}: a drive-by Origin is 403'd before the upgrade`, async () => {
      expect(await status(path, 'https://evil.example')).toBe(403);
      expect(await status(path, 'null')).toBe(403);
      expect(await status(path, 'http://localhost:1')).toBe(403);
    });

    test(`${path}: the shell's own origin and a non-browser client still pass the gate`, async () => {
      expect(await status(path, main)).toBe(400);
      expect(await status(path)).toBe(400);
    });
  }
});
