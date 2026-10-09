// V2-1.12 §7 `format-gate-studio` — a real studio boot (MAUDE_NO_AUTOBUILD,
// NO_OPEN) on a project whose format this build does not edit: `/_config`
// says why, project writes answer 403 `detail: 'format'`, per-user runtime
// writes still work, comments are look-only (§9 Q3), and "Update project"
// (`POST /_api/project/migrate`) is the one way out — after it the gate lifts
// without a restart.
//
// Ships WITH the http.ts wiring from the V2-2.14 hand-back (red without it:
// today every format answers 200 to every write, and /_config has no format
// fields). Written for the STAGED wiring (`newerOnly: true`); when the lead
// flips to the full gate, the format-1 case becomes "view only until Update
// project" and its expectations flip with it.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort, type Sandbox } from './_helpers.ts';

let box: Sandbox | null = null;
let proc: Subprocess | null = null;
afterEach(async () => {
  if (proc) await killProc(proc);
  if (box) rmSync(box.root, { recursive: true, force: true });
  proc = null;
  box = null;
});

const ENV = { MAUDE_NO_AUTOBUILD: '1', NO_OPEN: '1' };

async function boot(formatVersion?: number) {
  box = makeSandbox();
  const cfgPath = path.join(box.designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(
    cfgPath,
    `${JSON.stringify(formatVersion ? { ...cfg, formatVersion } : cfg, null, 2)}\n`
  );
  writeFileSync(
    path.join(box.designRoot, 'ui', 'card.tsx'),
    'export default function C() { return null; }\n'
  );
  writeFileSync(path.join(box.designRoot, 'ui', 'card.meta.json'), '{"layout":{"artboards":[]}}\n');
  const port = nextPort();
  proc = await bootServer(box.root, port, ENV);
  const base = `http://localhost:${port}`;
  const send = (p: string, method: string, body?: unknown) =>
    fetch(`${base}${p}`, {
      method,
      headers: { 'content-type': 'application/json', origin: base },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { base, send };
}

describe('the format gate in a running studio (staged wiring: newerOnly)', () => {
  test('a project NEWER than this build: view only, with the reason', async () => {
    const { send } = await boot(3);
    const cfg = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({
      readOnly: true,
      readOnlyReason: 'format',
      formatVersion: 3,
      formatGate: { projectFormat: 3, supported: 2, source: 'config' },
    });
    const layout = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(layout.status).toBe(403);
    expect(await layout.json()).toMatchObject({
      reason: 'read-only',
      detail: 'format',
      formatVersion: 3,
      message: 'This project now uses Maude 2. Update Maude to edit it.',
    });
    const viewport = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { viewport: { x: 1, y: 1, zoom: 1 } },
    });
    expect(viewport.status).toBe(200);
    expect(
      (await send('/_comments', 'POST', { file: '.design/ui/card.tsx', text: 'hi' })).status
    ).toBe(403);
    // the migrator refuses a project newer than this build (exit 11 → 409)
    expect((await send('/_api/project/migrate', 'POST', { apply: true })).status).toBe(409);
  }, 30_000);

  test('"Update project" on a format-1 project: 200, and /_config follows without a restart', async () => {
    const { send } = await boot();
    const before = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(before).toMatchObject({ formatVersion: 1, formatGate: null, readOnly: false });
    const r = await send('/_api/project/migrate', 'POST', { direction: 'forward', apply: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ dryRun: false, exitCode: 0 });
    const deadline = Date.now() + 3000;
    let cfg: Record<string, unknown> = {};
    while (Date.now() < deadline) {
      cfg = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
      if (cfg.formatVersion === 2) break;
      await Bun.sleep(100);
    }
    expect(cfg).toMatchObject({
      readOnly: false,
      readOnlyReason: null,
      formatVersion: 2,
      formatGate: null,
    });
  }, 30_000);

  test('a format-2 project is editable', async () => {
    const { send } = await boot(2);
    const cfg = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({ readOnly: false, formatGate: null, formatVersion: 2 });
    const layout = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(layout.status).not.toBe(403);
  }, 30_000);
});

describe('the lane routes carry the privileged double gate', () => {
  test('a cross-origin or rebinding-host request never reaches migrate or the outbox', async () => {
    const { base } = await boot();
    const post = (p: string, headers: Record<string, string>) =>
      fetch(`${base}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ direction: 'forward', apply: true }),
      });
    // a drive-by page on another origin
    expect((await post('/_api/project/migrate', { origin: 'https://evil.example' })).status).toBe(
      403
    );
    // DNS rebinding: same-looking origin, foreign Host
    expect(
      (
        await post('/_api/project/migrate', {
          origin: 'http://evil.example:1',
          host: 'evil.example:1',
        })
      ).status
    ).toBe(403);
    // the outbox list (a read) is checked the way every privileged read is: a browser on
    // another site always stamps Sec-Fetch-Site (sameOriginRead)
    const read = await fetch(`${base}/_api/outbox`, {
      headers: { 'sec-fetch-site': 'cross-site' },
    });
    expect(read.status).toBe(403);
    // and the tree was not migrated
    const cfg = JSON.parse(
      readFileSync(path.join((box as Sandbox).designRoot, 'config.json'), 'utf8')
    );
    expect(cfg.formatVersion).toBeUndefined();
  });
});
