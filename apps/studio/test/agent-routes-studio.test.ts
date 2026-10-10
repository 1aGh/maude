// V2-2.4b — the agent routes' http.ts wiring in a REAL studio boot (MAUDE_NO_AUTOBUILD, NO_OPEN).
// test/agent-hook-routes.test.ts drives the table with injected deps; this pins what http.ts
// injects: `readOnly` is the format gate (§5.4 `read-only`), and the run bracket reaches the
// ai-activity banner (touch → entry keyed like the Maude chat's, run end → cleared at once,
// not after the 30 s heartbeat grace).

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

const CARD =
  'export default function C() {\n  return <DCArtboard id="a1" width={10} height={10} />;\n}\n';

async function boot(formatVersion?: number) {
  box = makeSandbox();
  const cfgPath = path.join(box.designRoot, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(
    cfgPath,
    `${JSON.stringify(formatVersion ? { ...cfg, formatVersion } : cfg, null, 2)}\n`
  );
  writeFileSync(path.join(box.designRoot, 'ui', 'card.tsx'), CARD);
  const port = nextPort();
  proc = await bootServer(box.root, port, { MAUDE_NO_AUTOBUILD: '1', NO_OPEN: '1' });
  const base = `http://localhost:${port}`;
  // what a hook sends: loopback, no Origin / Sec-Fetch-Site (the routes refuse a browser)
  const hook = async (p: string, body: unknown) => {
    const r = await fetch(`${base}${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as Record<string, unknown> };
  };
  const aiFiles = async () =>
    (
      (await (await fetch(`${base}/_api/ai`)).json()) as { entries: { file: string }[] }
    ).entries.map((e) => e.file);
  return { hook, aiFiles };
}

const check = {
  session: 's1',
  toolUseId: 't1',
  tool: 'Edit',
  path: 'ui/card.tsx',
  edit: { old: 'height={10}', new: 'height={20}' },
};

describe('agent routes — the http.ts deps in a running studio', () => {
  test('a project NEWER than this build: edit/check denies with code read-only', async () => {
    const { hook } = await boot(3);
    const r = await hook('/_api/agent/edit/check', check);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ decision: 'deny', code: 'read-only' });
  });

  test('an editable project: edit/check is not read-only', async () => {
    const { hook } = await boot();
    const r = await hook('/_api/agent/edit/check', check);
    expect(r.status).toBe(200);
    expect(r.body.code).not.toBe('read-only');
  });

  test('touch lights the ai-activity banner for the canvas; run end clears it at once', async () => {
    const { hook, aiFiles } = await boot();
    expect(
      (await hook('/_api/agent/run/begin', { session: 's1', actor: 'claude-code' })).status
    ).toBe(200);
    expect(await aiFiles()).toEqual([]);
    const t = await hook('/_api/agent/edit/touched', {
      session: 's1',
      toolUseId: 't1',
      via: 'tool',
      path: 'ui/card.tsx',
    });
    expect(t.status).toBe(200);
    expect(await aiFiles()).toEqual(['.design/ui/card.tsx']);
    expect((await hook('/_api/agent/run/end', { session: 's1', outcome: 'done' })).status).toBe(
      200
    );
    expect(await aiFiles()).toEqual([]);
  });
});
