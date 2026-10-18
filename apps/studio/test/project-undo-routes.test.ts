// S5.5 — routes/project-undo.ts over the one op log (V2-1.5 §5.3): the local home answers
// `actionIds` as ONE action, the undo-stack folds history through the projection reducer, an
// old hub's `invalid` becomes the disabled line, and the canvas origin never sees either route.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createProjectUndoRoutes, NEEDS_HUB_UPDATE } from '../routes/project-undo.ts';
import type { RouteSpec } from '../routes/table.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';
import { parseUndoTarget } from '../sync/undo-target.ts';

const dirs: string[] = [];
const homes: LocalHome[] = [];
afterAll(() => {
  for (const h of homes) h.close();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const tsx = (p: string, s: string, t = 't0') =>
  `export default () => (<>\n<section id="P">${p}</section>\n<section id="S">${s}</section>\n<h1>${t}</h1>\n</>);\n`;

function localProject() {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-undo-routes-'));
  dirs.push(root);
  const designRoot = path.join(root, '.design');
  mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
  const file = path.join(designRoot, 'ui', 'a.tsx');
  writeFileSync(file, tsx('p0', 's0'));
  const home = openLocalHome({
    designRoot,
    designRel: '.design',
    canvasGroups: () => [{ path: 'ui' }],
    machine: { id: 'm_undo', name: 'Mac' },
    bootId: 'boot-u',
    lockRetryMs: 0,
    settleMs: 5,
    log: { warn() {}, error() {} },
  });
  homes.push(home);
  return {
    home,
    read: () => readFileSync(file, 'utf8'),
    write: async (body: string) => {
      writeFileSync(file, body);
      home.observe('ui/a.tsx');
      await home.flush();
    },
  };
}

const route = (specs: RouteSpec[], method: string, p: string) => {
  const s = specs.find((x) => x.method === method && x.path === p);
  if (!s) throw new Error(`no ${method} ${p}`);
  return s;
};
const post = (body: unknown) =>
  new Request('http://localhost/_api/project/undo', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
  });

describe('POST /_api/project/undo', () => {
  test('parseUndoTarget: exactly one of actionId / actionIds / chatId; 1–50 distinct ids', () => {
    expect(parseUndoTarget({ actionId: 'a_1' })).toMatchObject({ ok: true });
    expect(parseUndoTarget({ actionIds: ['a', 'b'] })).toMatchObject({ ok: true });
    expect(parseUndoTarget({ chatId: 'c1' })).toMatchObject({ ok: true });
    for (const bad of [
      {},
      { actionId: 'a', chatId: 'c' },
      { actionIds: [] },
      { actionIds: ['a', 'a'] },
      { actionIds: Array.from({ length: 51 }, (_, i) => `a${i}`) },
      { actionId: 'has space' },
      { chatId: 'c', redo: true },
    ])
      expect(parseUndoTarget(bad).ok).toBe(false);
  });

  test('a local project undoes two of your actions as ONE new action (U6 shape, local)', async () => {
    const p = localProject();
    await p.home.ready();
    await p.write(tsx('p1', 's0'));
    await p.write(tsx('p1', 's1'));
    await p.write(tsx('p1', 's1', 'Title'));
    const rows = await p.home.runtime.acceptedHistory({});
    const [title, s1, p1] = rows;
    const events: unknown[] = [];
    const specs = createProjectUndoRoutes({
      control: () => p.home.runtime,
      designRel: '.design',
      emit: (e, x) => events.push([e, x]),
    });
    const before = rows.length;
    const res = await route(specs, 'POST', '/_api/project/undo').handle(
      post({ actionIds: [s1.actionId, p1.actionId] }),
      {}
    );
    const body = (await res.json()) as { ok: boolean; undoes: string[] };
    expect(res.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.undoes).toEqual([s1.actionId, p1.actionId]);
    // as if p1 / s1 never happened; the later title edit is kept
    expect(p.read()).toBe(tsx('p0', 's0', 'Title'));
    const after = await p.home.runtime.acceptedHistory({});
    expect(after.length).toBe(before + 1);
    expect(after[0]).toMatchObject({ kind: 'undo', label: 'Undo 2 changes' });
    expect(title.kind).toBe('outside');
    // the bus hears it, with the log's own row
    await new Promise((r) => setTimeout(r, 20));
    expect(events[0]).toMatchObject(['project:action', { kind: 'undo', mine: true }]);
  });

  test('GET undo-stack folds your history through the projection reducer', async () => {
    const p = localProject();
    await p.home.ready();
    await p.write(tsx('p1', 's0'));
    await p.write(tsx('p1', 's1'));
    const [s1] = await p.home.runtime.acceptedHistory({});
    const specs = createProjectUndoRoutes({ control: () => p.home.runtime, designRel: '.design' });
    // outside writes are not entries (V2-1.5 §5.4) — the stack starts empty…
    const get = () =>
      route(specs, 'GET', '/_api/project/undo-stack').handle(
        new Request('http://localhost/_api/project/undo-stack?canvas=.design/ui/a.tsx'),
        {}
      );
    expect(await (await get()).json()).toEqual({ ok: true, entries: [], redo: [] });
    // …a panel undo IS an entry (⌘Z takes it back)
    await route(specs, 'POST', '/_api/project/undo').handle(
      post({ actionId: s1.actionId, via: 'panel' }),
      {}
    );
    const v = (await (await get()).json()) as { entries: { label: string; state: string }[] };
    expect(v.entries).toHaveLength(1);
    expect(v.entries[0]).toMatchObject({ label: 'Undo one change', state: 'done' });
  });

  test('U22: an old hub refuses actionIds — Undo this chat is disabled with the line', async () => {
    const specs = createProjectUndoRoutes({
      control: () => ({
        acceptedUndo: async () => ({ status: 'rejected', code: 'invalid' }) as const,
      }),
      designRel: '.design',
    });
    const res = await route(specs, 'POST', '/_api/project/undo').handle(post({ chatId: 'c1' }), {});
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      ok: false,
      reason: 'needs-hub-update',
      line: NEEDS_HUB_UPDATE,
    });
  });

  test('no home answers → legacy; both routes are main origin, the write refused read-only', async () => {
    const specs = createProjectUndoRoutes({ control: () => null, designRel: '.design' });
    const res = await route(specs, 'POST', '/_api/project/undo').handle(
      post({ actionId: 'a' }),
      {}
    );
    expect(await res.json()).toEqual({ ok: false, reason: 'legacy' });
    expect(specs.every((s) => s.origin === 'main')).toBe(true);
    expect(route(specs, 'POST', '/_api/project/undo').readOnly).toBe('refused');
  });
});
