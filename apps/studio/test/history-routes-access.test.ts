// S1.12b — routes/history.ts (V2-1.9 §5.11 / §5.12): who may read rows, words and raw source, who may
// name / set aside / restore, the canvas-only scope, the legacy hub's git rows, the offline line and
// paging that agrees with the full history. Plus both homes' additive history fields (`lanes`,
// `named`) and `acceptedName` on the local home.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { type AccessClaim, resolveAccess } from '../access/scope.ts';
import type { HistoryRowLike } from '../history/versions.ts';
import { listVersions } from '../history/versions.ts';
import { createHistoryRoutes, type HistoryRuntime } from '../routes/history.ts';
import type { RouteSpec } from '../routes/table.ts';
import { canvasLanes, namedField } from '../sync/history-fields.ts';
import { type LocalHome, openLocalHome } from '../sync/local-kernel.ts';

const MIN = 60_000;
const T0 = new Date(2026, 9, 18, 9, 0).getTime();

const board = (text: string) =>
  `export default () => (<DesignCanvas>\n<DCArtboard id="hero" label="Hero" width={100} height={100}><h1>${text}</h1></DCArtboard>\n</DesignCanvas>);\n`;

/** One canvas `ui/a.tsx` (+ `ui/b.tsx`): rev n's source says "v<n>". */
function fakeRuntime(rows: HistoryRowLike[], o: { fail?: () => boolean } = {}) {
  const calls: { name: unknown[][]; aside: unknown[][]; restore: unknown[][] } = {
    name: [],
    aside: [],
    restore: [],
  };
  const rt: HistoryRuntime = {
    async acceptedHistory(q) {
      if (o.fail?.()) throw new Error('unreachable');
      const canvas = q.path ? q.path.replace(/^\.design\//, '') : null;
      return rows
        .filter((r) => !canvas || r.canvases.includes(canvas))
        .filter((r) => !q.before || r.revision < q.before)
        .filter((r) => !q.kind || r.kind === q.kind)
        .sort((a, b) => b.revision - a.revision)
        .slice(0, q.limit ?? 50);
    },
    async acceptedVersion(_repoRel, rev, lane = 'html') {
      if (lane !== 'html') return null;
      const last = rows
        .filter((r) => r.revision <= rev && r.kind !== 'name' && r.kind !== 'comment')
        .sort((a, b) => b.revision - a.revision)[0];
      return last ? board(`v${last.revision}`) : null;
    },
    async acceptedName(...args) {
      calls.name.push(args);
      return { status: 'accepted', actionId: 'a_name' };
    },
    async acceptedAside(...args) {
      calls.aside.push(args);
      return { status: 'accepted', actionId: 'a_aside' };
    },
    async acceptedRestore(...args) {
      calls.restore.push(args);
      return { status: 'accepted', actionId: 'a_restore' };
    },
  };
  return { rt, calls };
}

let rev = 0;
function row(p: Partial<HistoryRowLike> & { at: number }): HistoryRowLike {
  rev += 1;
  const canvases = p.canvases ?? ['ui/a.tsx'];
  return {
    revision: rev,
    actionId: `a${rev}`,
    actor: 'jonas',
    mine: false,
    kind: 'edit',
    label: null,
    committedAt: p.at,
    madeAt: p.at,
    undoes: null,
    canvases,
    lanes: Object.fromEntries(canvases.map((c) => [c, ['html']])),
    ...p,
  };
}

function history(): HistoryRowLike[] {
  rev = 0;
  return [
    row({ at: T0 }), // r1  ┐ one edit row (Jonas, within 10 min)
    row({ at: T0 + 5 * MIN }), // r2  ┘
    row({ at: T0 + 30 * MIN, kind: 'ai', label: 'Make the hero bolder', actor: 'tereza' }), // r3
    row({ at: T0 + 31 * MIN, kind: 'comment', lanes: { 'ui/a.tsx': ['comments'] } }), // r4 not a version
    row({ at: T0 + 32 * MIN, lanes: { 'ui/a.tsx': ['comments'] } }), // r5 comments-only: not a version
    row({ at: T0 + 50 * MIN, canvases: ['ui/a.tsx', 'ui/b.tsx'] }), // r6
    row({ at: T0 + 90 * MIN, actor: 'tereza' }), // r7
  ];
}

const claim = (c: AccessClaim) => resolveAccess(c);
const OBSERVER = claim({ v: 1, role: 'observer' });
const VIEWER = claim({ v: 1, role: 'viewer' });
const MEMBER = claim({ v: 1, role: 'member' });
const ONLY_A = claim({ v: 1, role: null, grants: [{ c: 'ui/a.tsx', r: 'member' }] });

function routes(rt: HistoryRuntime | null, access = MEMBER, extra = {}) {
  let who = access;
  const specs = createHistoryRoutes({
    control: () => rt,
    designRel: '.design',
    access: () => who,
    ...extra,
  });
  return {
    specs,
    as: (a: typeof MEMBER) => {
      who = a;
    },
  };
}

const spec = (specs: RouteSpec[], method: string, p: string) => {
  const s = specs.find((x) => x.method === method && x.path === p);
  if (!s) throw new Error(`no ${method} ${p}`);
  return s;
};
// biome-ignore lint/suspicious/noExplicitAny: a test reads arbitrary answer JSON
type Body = Record<string, any>;
const answer = async (res: Response) => ({ status: res.status, body: (await res.json()) as Body });
const get = async (specs: RouteSpec[], p: string, q: Record<string, string>) => {
  const res = await spec(specs, 'GET', p).handle(
    new Request(`http://localhost${p}?${new URLSearchParams(q)}`),
    {}
  );
  return answer(res);
};
const post = async (specs: RouteSpec[], p: string, body: unknown) => {
  const text = JSON.stringify(body);
  const res = await spec(specs, 'POST', p).handle(
    new Request(`http://localhost${p}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': String(text.length) },
      body: text,
    }),
    {}
  );
  return answer(res);
};

describe('every history route is main-origin only', () => {
  test('none is canvas-safe; writes are refused to read-only sessions', () => {
    const { specs } = routes(null);
    expect(specs.map((s) => `${s.method} ${s.path}`).sort()).toEqual([
      'GET /_api/project/changes',
      'GET /_api/project/history',
      'GET /_api/project/source',
      'GET /_api/project/versions',
      'POST /_api/project/aside',
      'POST /_api/project/name',
      'POST /_api/project/restore',
    ]);
    for (const s of specs) expect(s.origin).toBe('main');
    for (const s of specs.filter((x) => x.method === 'POST')) expect(s.readOnly).toBe('refused');
  });
});

describe('Can view (observer): rows and words, never raw source or a write (§5.12)', () => {
  test('versions answers rule G rows; comments-only actions are not versions', async () => {
    const { rt } = fakeRuntime(history());
    const { specs } = routes(rt, OBSERVER);
    const r = await get(specs, '/_api/project/versions', { path: '.design/ui/a.tsx' });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.source).toBe('accepted');
    // r7 (Tereza) · r6 (Jonas) · r3 (AI) · r1+r2 (Jonas) — r4 / r5 never show
    expect(r.body.rows.map((x: { actions: string[] }) => x.actions)).toEqual([
      ['a7'],
      ['a6'],
      ['a3'],
      ['a1', 'a2'],
    ]);
    expect(r.body.rows[2].title).toBe('Make the hero bolder');
    expect(r.body.rows[1].alsoOn).toBe(1);
    expect(r.body.now).toEqual({ canvas: 'ui/a.tsx', ref: 'r7', status: null, canName: false });
  });

  test('changes answers the words between two versions', async () => {
    const { rt } = fakeRuntime(history());
    const { specs } = routes(rt, OBSERVER);
    const r = await get(specs, '/_api/project/changes', {
      path: 'ui/a.tsx',
      from: 'r1',
      to: 'now',
    });
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
    expect(r.body.to).toBe('r7');
    expect(r.body.changes.length).toBeGreaterThan(0);
    // the text changed last in r7 → blamed on r7's row
    expect(Object.values(r.body.blame)).toContain('a7');
  });

  test('raw source at a version is refused; Can comment gets it', async () => {
    const { rt } = fakeRuntime(history());
    const { specs, as } = routes(rt, OBSERVER);
    const refused = await get(specs, '/_api/project/source', { path: 'ui/a.tsx', at: 'r2' });
    expect(refused.status).toBe(403);
    expect(refused.body.reason).toBe('forbidden');
    as(VIEWER);
    const ok = await get(specs, '/_api/project/source', { path: 'ui/a.tsx', at: 'r2' });
    expect(ok.status).toBe(200);
    expect(ok.body.source).toContain('v2');
  });

  test('name, aside and restore are refused to Can view and Can comment', async () => {
    const { rt, calls } = fakeRuntime(history());
    const { specs, as } = routes(rt, OBSERVER);
    for (const who of [OBSERVER, VIEWER]) {
      as(who);
      const n = await post(specs, '/_api/project/name', {
        path: 'ui/a.tsx',
        at: 'r2',
        name: 'Final',
      });
      const a = await post(specs, '/_api/project/aside', {
        path: 'ui/a.tsx',
        lane: 'html',
        content: board('mine'),
      });
      const r = await post(specs, '/_api/project/restore', { path: 'ui/a.tsx', at: 'r2' });
      expect([n.status, a.status, r.status]).toEqual([403, 403, 403]);
    }
    expect(calls).toEqual({ name: [], aside: [], restore: [] });
  });
});

describe('Can edit: name, aside, restore reach the home', () => {
  test('name at a version and at now; null clears; a bad name is 400', async () => {
    const { rt, calls } = fakeRuntime(history());
    const { specs } = routes(rt, MEMBER);
    expect(
      (await post(specs, '/_api/project/name', { path: 'ui/a.tsx', at: 'r2', name: ' Final ' }))
        .body
    ).toEqual({ ok: true, actionId: 'a_name' });
    await post(specs, '/_api/project/name', { path: 'ui/a.tsx', at: 'now', name: null });
    expect(calls.name).toEqual([
      ['.design/ui/a.tsx', 2, 'Final'],
      ['.design/ui/a.tsx', 7, null],
    ]);
    const bad = await post(specs, '/_api/project/name', {
      path: 'ui/a.tsx',
      at: 'r2',
      name: 'a\u0007b',
    });
    expect(bad.status).toBe(400);
  });

  test('aside and restore', async () => {
    const { rt, calls } = fakeRuntime(history());
    const { specs } = routes(rt, MEMBER);
    const a = await post(specs, '/_api/project/aside', {
      path: 'ui/a.tsx',
      lane: 'html',
      content: board('mine'),
      label: 'Your version',
    });
    expect(a.body).toEqual({ ok: true, actionId: 'a_aside' });
    expect(calls.aside[0]?.slice(0, 2)).toEqual(['.design/ui/a.tsx', 'html']);
    const r = await post(specs, '/_api/project/restore', { path: 'ui/a.tsx', at: 'r2' });
    expect(r.status).toBe(200);
    expect(calls.restore).toEqual([['.design/ui/a.tsx', 2]]);
    // v1 body shape still accepted (maude design history restore)
    await post(specs, '/_api/project/restore', { path: '.design/ui/a.tsx', revision: 1 });
    expect(calls.restore[1]).toEqual(['.design/ui/a.tsx', 1]);
  });

  test('a hub without history.name: 409 hub-too-old with the line', async () => {
    const { rt } = fakeRuntime(history());
    rt.acceptedName = async () => ({ status: 'rejected', code: 'hub-too-old' });
    const { specs } = routes(rt, MEMBER);
    const r = await post(specs, '/_api/project/name', { path: 'ui/a.tsx', at: 'r2', name: 'x' });
    expect(r.status).toBe(409);
    expect(r.body).toEqual({
      ok: false,
      reason: 'hub-too-old',
      line: 'Naming versions needs the team server to be updated',
    });
  });
});

describe('a canvas-only session (V2-1.16 L4)', () => {
  test('a canvas it was not granted reads exactly like a missing one', async () => {
    const { rt, calls } = fakeRuntime(history());
    const { specs } = routes(rt, ONLY_A);
    for (const r of [
      await get(specs, '/_api/project/versions', { path: 'ui/b.tsx' }),
      await get(specs, '/_api/project/versions', { path: 'ui/nope.tsx' }),
      await get(specs, '/_api/project/changes', { path: 'ui/b.tsx', from: 'r1' }),
      await post(specs, '/_api/project/name', { path: 'ui/b.tsx', at: 'r6', name: 'x' }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.body.reason).toBe('not-in-scope');
    }
    expect(calls.name).toEqual([]);
  });

  test('its AI rows read as their words; "also on N" is dropped; history names only its canvases', async () => {
    const { rt } = fakeRuntime(history());
    const { specs } = routes(rt, ONLY_A);
    const v = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx' });
    const ai = v.body.rows.find((x: { kind: string }) => x.kind === 'ai');
    expect(ai.title).not.toBe('Make the hero bolder');
    expect(v.body.rows.some((x: { alsoOn?: number }) => x.alsoOn)).toBe(false);
    const h = await get(specs, '/_api/project/history', {});
    expect(h.body.ok).toBe(true);
    for (const r of h.body.history) expect(r.canvases).toEqual(['ui/a.tsx']);
  });

  test('S9.10 (U4) — /_api/project/history labels are rewritten from the visible canvases only', async () => {
    rev = 0;
    const rows = [
      row({ at: T0, label: 'Moved the hero onto b', canvases: ['ui/a.tsx', 'ui/b.tsx'] }),
      // repo-relative paths (a hub's rows) are judged the same way
      row({ at: T0 + MIN, label: 'Edited b only', canvases: ['.design/ui/b.tsx'] }),
      row({ at: T0 + 2 * MIN, label: 'Edit canvas', canvases: ['.design/ui/a.tsx'] }),
    ];
    const { rt } = fakeRuntime(rows);
    const { specs } = routes(rt, ONLY_A);
    const h = await get(specs, '/_api/project/history', {});
    expect(h.body.ok).toBe(true);
    expect(h.body.history.map((r: { label: string }) => r.label)).toEqual([
      'Changed a',
      'Changed a',
    ]);
    expect(JSON.stringify(h.body)).not.toContain('b.tsx');
    expect(JSON.stringify(h.body)).not.toMatch(/onto b|b only/);
  });
});

describe('sources (§5.2) and the offline line (§5.14)', () => {
  test('a legacy hub answers git rows', async () => {
    const legacy: HistoryRuntime = { acceptedHistory: async () => null };
    const { specs } = routes(legacy, OBSERVER, {
      gitHistory: async () => [
        {
          sha: 'abc1234',
          message: 'Hero copy\n\nbody',
          author: 'Jonas',
          date: '2026-10-18T09:00:00Z',
        },
      ],
    });
    const r = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx' });
    expect(r.body.source).toBe('git');
    expect(r.body.rows[0]).toMatchObject({ ref: 'git:abc1234', title: 'Hero copy', kind: 'edit' });
    const named = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx', filter: 'named' });
    expect(named.body.rows).toEqual([]);
  });

  test('offline: the last answer, with "Offline — showing versions up to HH:MM"; naming greyed', async () => {
    let down = false;
    const { rt } = fakeRuntime(history(), { fail: () => down });
    const { specs } = routes(rt, MEMBER, { now: () => new Date(2026, 9, 18, 14, 5).getTime() });
    const live = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx' });
    expect(live.body.offline).toBeUndefined();
    down = true;
    const off = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx' });
    expect(off.body.ok).toBe(true);
    expect(off.body.rows).toEqual(live.body.rows);
    expect(off.body.offline).toEqual({ line: 'Offline — showing versions up to 14:05' });
    expect(off.body.now.canName).toBe(false);
    const cold = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx', filter: 'ai' });
    expect(cold.body).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('paging agrees with the full history', () => {
  test('pages of 1 walk the same rows as one page of 100', async () => {
    rev = 0;
    const rows: HistoryRowLike[] = [];
    // 12 edits by Jonas 4 min apart (span rule splits them), then Tereza, then a name
    for (let i = 0; i < 12; i++) rows.push(row({ at: T0 + i * 8 * MIN }));
    rows.push(row({ at: T0 + 200 * MIN, actor: 'tereza' }));
    rows.push(
      row({
        at: T0 + 201 * MIN,
        kind: 'name',
        named: { rev: 5, name: 'Checkpoint' },
        lanes: { 'ui/a.tsx': ['@name'] },
      })
    );
    const { rt } = fakeRuntime(rows);
    const base = { runtime: rt, repoRel: '.design/ui/a.tsx', canvas: 'ui/a.tsx' };
    const all = await listVersions({ ...base, limit: 100 });
    if (!all.ok || all.source !== 'accepted') throw new Error('no rows');
    expect(all.rows.some((r) => r.named?.name === 'Checkpoint')).toBe(true);
    const paged: string[][] = [];
    let before: number | null = null;
    for (let i = 0; i < 20; i++) {
      const p = await listVersions({ ...base, limit: 1, before });
      if (!p.ok || p.source !== 'accepted') throw new Error('no page');
      paged.push(...p.rows.map((r) => r.actions));
      if (!p.next) break;
      before = p.next;
    }
    expect(paged).toEqual(all.rows.map((r) => r.actions));
  });
});

describe('both homes carry lanes + named (additive)', () => {
  test('canvasLanes / namedField', () => {
    expect(
      canvasLanes(
        [
          { doc: 'd1', lane: 'html', beforePath: null, afterPath: null },
          { doc: 'd1', lane: 'comments', beforePath: null, afterPath: null },
          { doc: null, lane: '@manifest', beforePath: null, afterPath: 'ui/b.tsx' },
          { doc: 'd9', lane: 'html', beforePath: null, afterPath: 'assets/x.png' },
        ],
        (d) => (d === 'd1' ? 'ui/a.tsx' : null),
        (p) => p.endsWith('.tsx')
      )
    ).toEqual({
      canvases: ['ui/a.tsx', 'ui/b.tsx'],
      lanes: { 'ui/a.tsx': ['comments', 'html'], 'ui/b.tsx': ['@manifest'] },
    });
    expect(namedField('name', { named: { entry: 'n', rev: 3, name: 'Final' } })).toEqual({
      rev: 3,
      name: 'Final',
    });
    expect(namedField('name', { named: { rev: 3, name: null } })).toEqual({ rev: 3, name: null });
    expect(namedField('edit', { named: { rev: 3, name: 'x' } })).toBeUndefined();
    expect(namedField('name', { named: { rev: 'x', name: 'x' } })).toBeUndefined();
  });

  const dirs: string[] = [];
  const homes: LocalHome[] = [];
  afterAll(() => {
    for (const h of homes) h.close();
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('local home: acceptedName lands a name the versions route shows; aside moves no head', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-history-routes-'));
    dirs.push(root);
    const designRoot = path.join(root, '.design');
    mkdirSync(path.join(designRoot, 'ui'), { recursive: true });
    writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), board('one'));
    const home = openLocalHome({
      designRoot,
      designRel: '.design',
      canvasGroups: () => [{ path: 'ui' }],
      machine: { id: 'm_hist', name: 'Mac' },
      bootId: 'boot-h',
      lockRetryMs: 0,
      settleMs: 5,
      log: { warn() {}, error() {} },
    });
    homes.push(home);
    await home.ready();
    writeFileSync(path.join(designRoot, 'ui', 'a.tsx'), board('two'));
    home.observe('ui/a.tsx');
    await home.flush();
    const [edit] = await home.runtime.acceptedHistory({ path: '.design/ui/a.tsx', limit: 1 });
    expect(edit?.lanes['ui/a.tsx']).toContain('html');
    const named = await home.runtime.acceptedName('.design/ui/a.tsx', edit?.revision ?? 0, 'Two');
    expect(named.status).toBe('accepted');
    const [nameRow] = await home.runtime.acceptedHistory({ path: '.design/ui/a.tsx', limit: 1 });
    expect(nameRow?.kind).toBe('name');
    expect(nameRow?.named).toEqual({ rev: edit?.revision as number, name: 'Two' });
    const aside = await home.runtime.acceptedAside('.design/ui/a.tsx', 'html', board('kept'));
    expect(aside.status).toBe('accepted');
    expect(await home.runtime.acceptedVersion('.design/ui/a.tsx', 1_000_000)).toBe(board('two'));

    const { specs } = routes(home.runtime as unknown as HistoryRuntime, OBSERVER);
    const v = await get(specs, '/_api/project/versions', { path: 'ui/a.tsx' });
    expect(v.body.ok).toBe(true);
    const top = v.body.rows.find((r: { named?: unknown }) => r.named);
    expect(top?.title).toBe('Two');
    expect(top?.chips).toContain('Named');
  });
});
