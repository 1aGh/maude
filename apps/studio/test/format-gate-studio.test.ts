// V2-1.12 §7 `format-gate-studio` — a real studio boot (MAUDE_NO_AUTOBUILD,
// NO_OPEN) on a project whose format this build does not edit: `/_config`
// says why, project writes answer 403 `detail: 'format'`, per-user runtime
// writes still work, comments are look-only (§9 Q3), and "Update project"
// (`POST /_api/project/migrate`) is the one way out — after it the gate lifts
// without a restart.
//
// Ships WITH the http.ts wiring from the V2-2.14 hand-back (red without it:
// today every format answers 200 to every write, and /_config has no format
// fields). The FULL gate (CONTRACT §4.1, Michal 2A 2026-10-28): a format-1
// project is view only until "Update project", which snapshots it to
// `_history/_migrate/v2-<stamp>/` and lifts the gate without a restart.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

/** `formatVersion` undefined = a format-1 project (the key absent, as every v1 project has it). */
async function boot(formatVersion?: number) {
  box = makeSandbox();
  const cfgPath = path.join(box.designRoot, 'config.json');
  const { formatVersion: _drop, ...cfg } = JSON.parse(readFileSync(cfgPath, 'utf8'));
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
      // what the Maude window sends — a migrate apply needs the browser-only Sec-Fetch-Site
      headers: {
        'content-type': 'application/json',
        origin: base,
        'sec-fetch-site': 'same-origin',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { base, send };
}

describe('the format gate in a running studio (the full gate, CONTRACT §4.1)', () => {
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

  test('a format-1 project is VIEW ONLY until "Update project"; the click snapshots, then lifts the gate without a restart', async () => {
    const { send } = await boot();
    const before = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(before).toMatchObject({
      formatVersion: 1,
      formatGate: { projectFormat: 1, supported: 2, source: 'config' },
      readOnly: true,
      readOnlyReason: 'format',
    });
    const layout = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(layout.status).toBe(403);
    expect(await layout.json()).toMatchObject({
      detail: 'format',
      formatVersion: 1,
      message: 'View only — this project still uses Maude 1.',
    });
    const r = await send('/_api/project/migrate', 'POST', { direction: 'forward', apply: true });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ dryRun: false, exitCode: 0 });
    // the one click backed the project up first (docs/MIGRATING-V1-TO-V2.md)
    const snaps = readdirSync(path.join(box!.designRoot, '_history', '_migrate'));
    expect(snaps.some((d) => /^v2-/.test(d))).toBe(true);
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
    const after = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(after.status).toBe(200);
  }, 30_000);

  test('nothing migrates a format-1 project by itself: boot, /_config, the format view and a dry run leave it as it was', async () => {
    // Michal 2026-10-28 (via the lead): a local format-1 project is view only and OFFERS Update
    // project — there is no migration on open. Only the person's click (apply + Sec-Fetch-Site) writes.
    const { send } = await boot();
    const cfgPath = path.join(box!.designRoot, 'config.json');
    const bytes = readFileSync(cfgPath, 'utf8');
    expect(JSON.parse(bytes).formatVersion).toBeUndefined();
    await send('/_config', 'GET');
    expect((await send('/_api/project/format', 'GET')).status).toBe(200);
    const dry = await send('/_api/project/migrate', 'POST', { direction: 'forward' });
    expect(await dry.json()).toMatchObject({ dryRun: true, exitCode: 0 });
    // an apply from anything but the Maude window is refused (no Sec-Fetch-Site)
    const port = new URL((await send('/_config', 'GET')).url).port;
    const forged = await fetch(`http://localhost:${port}/_api/project/migrate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
      body: JSON.stringify({ direction: 'forward', apply: true }),
    });
    expect(forged.status).toBe(403);
    await Bun.sleep(500);
    expect(readFileSync(cfgPath, 'utf8')).toBe(bytes);
    expect(existsSync(path.join(box!.designRoot, '_history', '_migrate'))).toBe(false);
    expect(await (await send('/_config', 'GET')).json()).toMatchObject({
      formatVersion: 1,
      readOnlyReason: 'format',
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
