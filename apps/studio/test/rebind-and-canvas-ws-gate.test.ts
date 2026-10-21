// Phase 2 gate (third verify pass) — two pre-existing browser-to-localhost holes.
//
// 1. DNS rebinding on the static fall-through: a page on attacker.example that re-points its
//    name at 127.0.0.1 talks to the studio with `Host: attacker.example:<port>`, so a loopback
//    check is what keeps it from reading `/.env`, `/.git/config` or `/.ai/**`. The API routes
//    had `isTrustedRequestHost`; the repo-file lane did not.
// 2. CSWSH on the CANVAS listener: `/_ws/collab/<slug>` (canvas realm — reads the Y-doc,
//    writes comments/annotations) and the HMR `/_ws` (leaks file paths → slugs) accepted a
//    drive-by handshake. The canvas iframe keeps its own origin (`allow-same-origin`), so the
//    same `isSameOriginWs` check as the main listener lets it through and nothing else.
// A plain GET with no Upgrade headers passes a WS gate and then fails the upgrade → 400.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { frameCap, withFc } from './_acl-cell.ts';
import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox;
let proc: Subprocess;
let port: number;
let canvas: string;
/** gate-b-c4 — the frame (ui/card.tsx) every canvas-listener handshake below is made from. */
let fc: string | null = null;

/** node:http, because fetch() will not send a Host header other than the URL's. */
function get(p: number, path: string, headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const r = request({ host: '127.0.0.1', port: p, path, method: 'GET', headers }, (res) => {
      res.resume();
      resolve(res.statusCode ?? 0);
    });
    r.on('error', reject);
    r.setTimeout(3000, () => r.destroy(new Error('timeout')));
    r.end();
  });
}

beforeAll(async () => {
  box = makeSandbox();
  writeFileSync(join(box.root, '.env'), 'SECRET=planted\n');
  mkdirSync(join(box.designRoot, 'assets'), { recursive: true });
  port = nextPort();
  proc = await bootServer(box.root, port, {
    MAUDE_NO_AUTOBUILD: '1',
    NO_OPEN: '1',
    MAUDE_CANVAS_ORIGIN_SPLIT: '1',
  });
  for (let i = 0; i < 40 && !canvas; i++) {
    try {
      canvas = JSON.parse(readFileSync(join(box.designRoot, '_server.json'), 'utf8')).canvasOrigin;
    } catch {
      /* not written yet */
    }
    if (!canvas) await Bun.sleep(50);
  }
  fc = await frameCap({ base: `http://localhost:${port}` }, {}, 'ui/card.tsx');
});
afterAll(async () => {
  await killProc(proc);
  rmSync(box.root, { recursive: true, force: true });
});

describe('DNS rebinding: the repo-file lane answers loopback hosts only', () => {
  test('a rebound Host cannot read /.env', async () => {
    expect(await get(port, '/.env', { Host: `attacker.example:${port}` })).toBe(403);
  });
  test('a rebound Host cannot read project media through /assets/ either', async () => {
    writeFileSync(join(box.designRoot, 'assets', 'planted.png'), 'x');
    expect(await get(port, '/assets/planted.png', { Host: `attacker.example:${port}` })).toBe(403);
    expect(await get(port, '/assets/planted.png', { Host: `localhost:${port}` })).toBe(200);
  });
  test('the studio itself still reads repo files', async () => {
    expect(await get(port, '/.env', { Host: `localhost:${port}` })).toBe(200);
  });
});

describe('canvas-listener sockets refuse a cross-origin handshake', () => {
  const canvasPort = () => Number(new URL(canvas).port);
  for (const path of ['/_ws/collab/ui-card', '/_ws']) {
    test(`${path}: a drive-by Origin is 403'd`, async () => {
      const host = `localhost:${canvasPort()}`;
      // inside a valid frame, so the 403 is the Origin gate's own
      const framed = withFc(path, fc);
      expect(await get(canvasPort(), framed, { Host: host, Origin: 'https://evil.example' })).toBe(
        403
      );
      expect(
        await get(canvasPort(), framed, { Host: host, Origin: `http://localhost:${port}` })
      ).toBe(403);
    });
    test(`${path}: the canvas iframe's own origin passes the gate`, async () => {
      const host = `localhost:${canvasPort()}`;
      // (400: past every gate, a plain GET is no upgrade) — from inside the frame; frame-less,
      // the frame gate refuses the handshake first (gate-b-c4).
      expect(
        await get(canvasPort(), withFc(path, fc), { Host: host, Origin: `http://${host}` })
      ).toBe(400);
      expect(await get(canvasPort(), path, { Host: host, Origin: `http://${host}` })).toBe(403);
    });
  }
});
