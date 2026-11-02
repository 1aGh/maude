// S5.1b — U21 at the route: a local project (no hub) answers
// `/_api/project/{history,undo,restore}` from its own store instead of
// `{ ok: false, reason: 'legacy' }`, and a second studio on the same folder is
// refused by the lock. Real studios, booted on a scratch project.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Subprocess } from 'bun';

import { bootServer, killProc, makeSandbox, nextPort } from './_helpers.ts';

const tsx = (text: string) => `export default () => <p>${text}</p>;\n`;

let root = '';
let designRoot = '';
let a: Subprocess | null = null;
let b: Subprocess | null = null;
let portA = 0;
let portB = 0;

async function boot(): Promise<{ proc: Subprocess; port: number }> {
  for (let i = 0; i < 4; i++) {
    const port = nextPort();
    try {
      const proc = await bootServer(root, port, {
        MAUDE_NO_AUTOBUILD: '1',
        XDG_CONFIG_HOME: join(root, '.config'),
      });
      return { proc, port };
    } catch (err) {
      if (i === 3) throw err;
    }
  }
  throw new Error('unreachable');
}

const history = async (port: number, q = '') =>
  (await (await fetch(`http://localhost:${port}/_api/project/history${q}`)).json()) as {
    ok: boolean;
    reason?: string;
    history?: { actionId: string; kind: string; revision: number; canvases: string[] }[];
  };

const post = async (port: number, route: string, body: unknown) => {
  const r = await fetch(`http://localhost:${port}${route}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: `http://localhost:${port}` },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 8000): Promise<T> {
  const start = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - start < ms) {
    await Bun.sleep(100);
    v = await fn();
  }
  return v;
}

beforeAll(async () => {
  ({ root, designRoot } = makeSandbox());
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'card.tsx'), tsx('v0'));
  ({ proc: a, port: portA } = await boot());
}, 30_000);

afterAll(async () => {
  if (b) await killProc(b);
  if (a) await killProc(a);
  rmSync(root, { recursive: true, force: true });
});

describe('a local project has version history (U21)', () => {
  test('history answers from the store, not legacy; an edit on disk is an outside row', async () => {
    const first = await history(portA);
    expect(first.ok).toBe(true);
    expect(first.history?.map((r) => [r.kind, r.canvases])).toEqual([
      ['migration.import', ['ui/card.tsx']],
    ]);
    writeFileSync(join(designRoot, 'ui', 'card.tsx'), tsx('v1'));
    const after = await until(
      () => history(portA),
      (h) => (h.history?.length ?? 0) >= 2
    );
    expect(after.history?.[0].kind).toBe('outside');
  }, 20_000);

  test('undo and restore are answered and change the file', async () => {
    const h = await history(portA, '?path=.design/ui/card.tsx');
    const edit = h.history?.[0];
    const base = h.history?.at(-1);
    expect(edit?.kind).toBe('outside');
    const undo = await post(portA, '/_api/project/undo', { actionId: edit?.actionId });
    expect(undo.status).toBe(200);
    expect(undo.json.ok).toBe(true);
    expect(readFileSync(join(designRoot, 'ui', 'card.tsx'), 'utf8')).toBe(tsx('v0'));

    writeFileSync(join(designRoot, 'ui', 'card.tsx'), tsx('v2'));
    await until(
      () => history(portA),
      (x) => x.history?.[0].kind === 'outside'
    );
    const restore = await post(portA, '/_api/project/restore', {
      path: '.design/ui/card.tsx',
      revision: base?.revision,
    });
    expect(restore.json.ok).toBe(true);
    expect(readFileSync(join(designRoot, 'ui', 'card.tsx'), 'utf8')).toBe(tsx('v0'));
  }, 20_000);

  test('a second studio on the same folder reads history but its writes are refused by the lock', async () => {
    ({ proc: b, port: portB } = await boot());
    const h = await history(portB);
    expect(h.ok).toBe(true);
    expect((h.history?.length ?? 0) >= 4).toBe(true);
    const undo = await post(portB, '/_api/project/undo', { actionId: h.history?.[0].actionId });
    expect(undo.status).toBe(409);
    expect(undo.json).toMatchObject({ ok: false, status: 'rejected', code: 'store-locked' });
  }, 30_000);
});
