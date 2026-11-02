// S9.24 — `GET /_api/sync/conflicts` + `POST /_api/sync/conflicts/resolve` (routes/sync-conflicts.ts).
// A pick is ONE lane edit on the current head (one op batch — one undo step); Keep theirs changes
// nothing; every pick drops the card. Both directions: the loser may be either side of the race.
import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { resolveAccess } from '../access/scope.ts';
import { applyOps, type Op } from '../annotations/ops.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import { createSyncConflictRoutes } from '../routes/sync-conflicts.ts';
import { readConflicts, recordConflicts } from '../sync/conflict-record.ts';

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sticky = (
  id: string,
  text: string,
  extra: Record<string, unknown> = {}
): AnnotationElement => ({
  id,
  type: 'sticky',
  index: 'a0',
  x: 630,
  y: 460,
  w: 190,
  h: 120,
  text,
  ...extra,
});
const YOURS = 'Číslo na zádech větší — 30 cm';
const JONAS = 'Číslo 25 cm — jinak se nad něj nevejde sponzor';

function rig(o: {
  mine: string;
  theirs: string;
  access?: ReturnType<typeof resolveAccess> | null;
}) {
  const root = mkdtempSync(path.join(tmpdir(), 'maude-conflict-route-'));
  dirs.push(root);
  const files: Record<string, string> = { 'ui-a': '.design/ui/a.tsx', 'ui-b': '.design/ui/b.tsx' };
  const boards = new Map<string, string>([
    [
      '.design/ui/a.tsx',
      serializeBoard([sticky('s1', o.theirs), sticky('s2', 'other', { index: 'a1' })]),
    ],
    ['.design/ui/b.tsx', serializeBoard([sticky('s9', o.theirs)])],
  ]);
  const batches: Op[][] = [];
  for (const slug of ['ui-a', 'ui-b'])
    recordConflicts(root, slug, [
      {
        id: slug === 'ui-a' ? 's1' : 's9',
        type: 'sticky',
        fields: ['text'],
        mine: sticky(slug === 'ui-a' ? 's1' : 's9', o.mine),
        theirs: sticky(slug === 'ui-a' ? 's1' : 's9', o.theirs),
      },
    ]);
  const specs = createSyncConflictRoutes({
    designRoot: root,
    designRel: '.design',
    fileForSlug: async (s) => files[s] ?? null,
    readBoard: async (f) => ({ ok: true, text: boards.get(f) ?? null }),
    applyAnnotationOps: async (f, ops) => {
      batches.push([...ops]);
      const els = parseBoard(boards.get(f) ?? '').elements;
      const r = applyOps(new Map(els.map((e) => [e.id, e])), ops);
      boards.set(f, serializeBoard([...r.state.values()]));
      return { ok: true, changed: r.touched.size > 0, rejected: r.rejected };
    },
    access: () => o.access ?? null,
  });
  const get = specs.find((s) => s.method === 'GET') as (typeof specs)[number];
  const post = specs.find((s) => s.method === 'POST') as (typeof specs)[number];
  const resolve = (body: unknown) =>
    post.handle(
      new Request('http://x/_api/sync/conflicts/resolve', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
      {}
    );
  const board = (f = '.design/ui/a.tsx') => parseBoard(boards.get(f) ?? '').elements;
  return { root, get, post, resolve, board, batches };
}

describe('GET /_api/sync/conflicts', () => {
  test('lists every held element with its canvas file; a canvas-only session sees only its grants', async () => {
    const r = rig({ mine: YOURS, theirs: JONAS });
    const all = await (await r.get.handle(new Request('http://x/_api/sync/conflicts'), {})).json();
    expect(
      all.conflicts.map((c: { slug: string; file: string; id: string }) => [c.slug, c.file, c.id])
    ).toEqual([
      ['ui-a', '.design/ui/a.tsx', 's1'],
      ['ui-b', '.design/ui/b.tsx', 's9'],
    ]);
    const only = rig({
      mine: YOURS,
      theirs: JONAS,
      access: resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/b.tsx', r: 'member' }] }),
    });
    const some = await (
      await only.get.handle(new Request('http://x/_api/sync/conflicts'), {})
    ).json();
    expect(some.conflicts.map((c: { slug: string }) => c.slug)).toEqual(['ui-b']);
  });
});

describe('POST /_api/sync/conflicts/resolve — one lane edit per pick, in both directions', () => {
  for (const [who, mine, theirs] of [
    ['you lost', YOURS, JONAS],
    ['Jonas lost', JONAS, YOURS],
  ] as const) {
    test(`${who}: Keep yours puts the proposal's version on the head, as one batch`, async () => {
      const r = rig({ mine, theirs });
      const res = await r.resolve({ slug: 'ui-a', id: 's1', choice: 'mine' });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ ok: true, choice: 'mine', changed: true });
      expect(r.batches.length).toBe(1);
      expect(r.board().find((e) => e.id === 's1')?.text).toBe(mine);
      expect(r.board().find((e) => e.id === 's2')?.text).toBe('other');
      expect(readConflicts(r.root, 'ui-a')).toEqual([]);
      expect(readConflicts(r.root, 'ui-b').length).toBe(1);
    });

    test(`${who}: Keep theirs changes nothing and drops the card`, async () => {
      const r = rig({ mine, theirs });
      const res = await r.resolve({ slug: 'ui-a', id: 's1', choice: 'theirs' });
      expect(await res.json()).toMatchObject({ ok: true, choice: 'theirs', changed: false });
      expect(r.batches.length).toBe(0);
      expect(r.board().find((e) => e.id === 's1')?.text).toBe(theirs);
      expect(readConflicts(r.root, 'ui-a')).toEqual([]);
    });

    test(`${who}: Keep both adds the proposal's version beside theirs under a fresh id`, async () => {
      const r = rig({ mine, theirs });
      const res = await r.resolve({ slug: 'ui-a', id: 's1', choice: 'both' });
      const body = await res.json();
      expect(body).toMatchObject({ ok: true, choice: 'both', changed: true });
      expect(r.batches.length).toBe(1);
      const els = r.board();
      expect(els.find((e) => e.id === 's1')?.text).toBe(theirs);
      const copy = els.find((e) => e.id === body.copyId);
      expect(copy?.text).toBe(mine);
      expect(copy?.x).toBe(630 + 190 + 24);
      expect(readConflicts(r.root, 'ui-a')).toEqual([]);
    });
  }

  test('unknown entry → 404 gone; bad choice → 400; a Can comment session → 403, nothing written', async () => {
    const r = rig({ mine: YOURS, theirs: JONAS });
    expect((await r.resolve({ slug: 'ui-a', id: 'nope', choice: 'mine' })).status).toBe(404);
    expect((await r.resolve({ slug: 'ui-zz', id: 's1', choice: 'mine' })).status).toBe(404);
    expect((await r.resolve({ slug: 'ui-a', id: 's1', choice: 'yours' })).status).toBe(400);
    const viewer = rig({
      mine: YOURS,
      theirs: JONAS,
      access: resolveAccess({ v: 1, role: 'viewer' }),
    });
    expect((await viewer.resolve({ slug: 'ui-a', id: 's1', choice: 'mine' })).status).toBe(403);
    expect(viewer.batches.length).toBe(0);
    expect(readConflicts(viewer.root, 'ui-a').length).toBe(1);
  });

  test('the gate judges the canvas the slug names', async () => {
    const r = rig({ mine: YOURS, theirs: JONAS });
    const req = new Request('http://x/_api/sync/conflicts/resolve', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': '40' },
      body: JSON.stringify({ slug: 'ui-b', id: 's9', choice: 'mine' }),
    });
    expect(await r.post.target?.(req)).toBe('ui/b.tsx');
  });
});
