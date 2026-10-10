// V2-1.12 §7 `format-gate-studio`, the 1.x compat cut (V2-2.18) — a real
// studio boot (MAUDE_NO_AUTOBUILD, NO_OPEN) of a 1.x build (SUPPORTED_FORMAT
// = 1) in both directions:
//   • a format-2 project (NEWER than this build): `/_config` says why, project
//     writes answer 403 `detail: 'format'` with "Update Maude to edit it",
//     per-user runtime writes still work, comments are look-only (§9 Q3);
//   • a format-1 project: this build stays a full writer.
//
// Adapted from feat/maude-v2's format-gate-studio.test.ts (12b4fbb2). The v2
// file also covers "Update project" (`POST /_api/project/migrate`) and the lane
// route tables, which a 1.x build does not have.

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
      headers: {
        'content-type': 'application/json',
        origin: base,
        'sec-fetch-site': 'same-origin',
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
  return { base, send };
}

describe('the format gate in a running 1.x studio', () => {
  test('a format-2 project (NEWER than this build): view only, with the reason', async () => {
    const { send } = await boot(2);
    const cfg = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({
      readOnly: true,
      readOnlyReason: 'format',
      formatVersion: 2,
      formatGate: { projectFormat: 2, supported: 1, source: 'config' },
    });
    const layout = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(layout.status).toBe(403);
    expect(await layout.json()).toMatchObject({
      reason: 'read-only',
      detail: 'format',
      formatVersion: 2,
      message: 'This project now uses Maude 2. Update Maude to edit it.',
    });
    // the meta file on disk is untouched
    expect(readFileSync(path.join(box!.designRoot, 'ui', 'card.meta.json'), 'utf8')).toBe(
      '{"layout":{"artboards":[]}}\n'
    );
    // per-user runtime (the camera) still writes
    const viewport = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { viewport: { x: 1, y: 1, zoom: 1 } },
    });
    expect(viewport.status).toBe(200);
    // comments are look-only (§9 Q3)
    expect(
      (await send('/_comments', 'POST', { file: '.design/ui/card.tsx', text: 'hi' })).status
    ).toBe(403);
  }, 30_000);

  test('a format-1 project: this 1.x build stays a full writer', async () => {
    const { send } = await boot();
    const cfg = (await (await send('/_config', 'GET')).json()) as Record<string, unknown>;
    expect(cfg).toMatchObject({
      readOnly: false,
      readOnlyReason: null,
      formatVersion: 1,
      formatGate: null,
    });
    const layout = await send('/_api/canvas-meta', 'PATCH', {
      file: '.design/ui/card.tsx',
      patch: { layout: { artboards: [{ id: 'a', x: 1, y: 2 }] } },
    });
    expect(layout.status).not.toBe(403);
    expect(
      (await send('/_comments', 'POST', { file: '.design/ui/card.tsx', text: 'hi' })).status
    ).not.toBe(403);
  }, 30_000);
});
