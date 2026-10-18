// S2.20 — the shell's ⌘Z / ⇧⌘Z / Undo history over the op log (V2-1.5 §5.4, §7 — the U-key rows
// S2 owns: ⌘Z order across you + your AI (U1, U2), stale skip + toast (U4), redo cleared by an AI
// landing, ⌘Z on a pending entry, the stack outliving a canvas reload (HMR), undo-to-here as ONE
// action (U18), the comment that is not an entry (U20), a project off the op log falling back to the
// canvas stack).
//
// The server half is REAL: `routes/project-undo.ts` (the same reducer folded over history) over a
// fake op log whose undo semantics mirror the kernel's at the level the projection reads — an undo
// row names its targets, ⌘Z rows are labelled "Undo"/"Redo", panel undos by what they undid.

import { describe, expect, test } from 'bun:test';
import {
  createUndoProjection,
  runUndoKey,
  undoWords,
} from '../client/v2/undo/use-undo-projection.jsx';
import { createProjectUndoRoutes } from '../routes/project-undo.ts';

const CANVAS = 'ui/Combine.tsx';
const REPO = `.design/${CANVAS}`;

type Row = {
  revision: number;
  actionId: string;
  actor: string;
  mine: boolean;
  kind: string;
  label: string | null;
  committedAt: number;
  madeAt?: number;
  undoes: string | string[] | null;
  canvases: string[];
  runId?: string;
};

function fakeHome(opts: { legacy?: boolean } = {}) {
  const rows: Row[] = [];
  const conflicts = new Set<string>();
  const skips = new Map<string, number>();
  let rev = 0;
  let clock = 1_000;
  const add = (r: Partial<Row> & { actionId: string; kind: string }) => {
    const row: Row = {
      revision: ++rev,
      actor: 'you',
      mine: true,
      label: null,
      committedAt: ++clock,
      undoes: null,
      canvases: [CANVAS],
      ...r,
    };
    rows.push(row);
    return row;
  };
  let n = 0;
  const runtime = {
    async acceptedHistory(q: { mine?: boolean }) {
      if (opts.legacy) return null;
      return rows.filter((r) => !q.mine || r.mine).map((r) => ({ ...r }));
    },
    async acceptedUndo(
      target: { actionId?: string; actionIds?: string[] },
      redo = false,
      o?: { via?: 'keys' | 'panel' }
    ) {
      if (opts.legacy) return null;
      const ids = target.actionIds ?? [target.actionId as string];
      if (ids.some((id) => conflicts.has(id)))
        return { status: 'rejected' as const, code: 'undo-conflict' };
      const via = o?.via ?? 'keys';
      const label = via === 'keys' ? (redo ? 'Redo' : 'Undo') : `Undo ${ids.length} changes`;
      const row = add({
        actionId: `u${++n}`,
        kind: redo ? 'redo' : 'undo',
        label,
        undoes: target.actionIds ? ids : ids[0],
      });
      const skipped = Array.from({ length: skips.get(ids[0]) ?? 0 }, () => ({
        doc: 'd',
        lane: 'html',
        reason: 'changed by someone else since',
      }));
      return {
        status: 'accepted' as const,
        actionId: row.actionId,
        undoes: row.undoes ?? undefined,
        ...(skipped.length ? { skipped } : {}),
      };
    },
  };
  const specs = createProjectUndoRoutes({ control: () => runtime, designRel: '.design' });
  const posts: unknown[] = [];
  const request = async (method: string, url: string, body?: unknown) => {
    const u = new URL(url, 'http://studio.test');
    if (u.pathname === '/_api/project/history') {
      return { status: 200, body: { ok: true, history: rows.slice().reverse() } };
    }
    if (method === 'POST') posts.push(body);
    const spec = specs.find((s) => s.method === method && s.path === u.pathname);
    if (!spec) return { status: 404, body: null };
    const res = await spec.handle(
      new Request(u, {
        method,
        ...(body !== undefined
          ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }
          : {}),
      }),
      {} as never
    );
    return { status: res.status, body: await res.json().catch(() => null) };
  };
  return { rows, add, conflicts, skips, request, posts, setClock: (t: number) => (clock = t) };
}

function setup(o: { legacy?: boolean } = {}) {
  const home = fakeHome(o);
  const toasts: string[] = [];
  let now = 500;
  const store = createUndoProjection({
    request: home.request,
    now: () => now,
    announce: (t) => toasts.push(t),
    designRel: () => '.design',
  });
  return { home, store, toasts, setNow: (t: number) => (now = t) };
}

const ids = (posts: unknown[]) => posts.map((p) => JSON.stringify(p));

describe('S2.20 ⌘Z projection — the U-keys S2 owns', () => {
  test('U1: ⌘Z takes back your AI run first (one step), then your edit; ⇧⌘Z re-applies in order', async () => {
    const { home, store, toasts } = setup();
    await store.open(REPO);
    home.add({ actionId: 'title', kind: 'edit', label: 'Headline text', madeAt: 600 });
    home.add({ actionId: 'run1', kind: 'ai', label: 'Restyle story', madeAt: 700, runId: 'r1' });

    expect((await store.undo(REPO)).undid).toBe('run1');
    expect((await store.undo(REPO)).undid).toBe('title');
    expect((await store.redo(REPO)).redid).toBe('title');
    expect((await store.redo(REPO)).redid).toBe('run1');
    expect(ids(home.posts)).toEqual([
      JSON.stringify({ actionId: 'run1', via: 'keys' }),
      JSON.stringify({ actionId: 'title', via: 'keys' }),
      // ⇧⌘Z names THE UNDO it re-applies (`redo takes the undo`)
      JSON.stringify({ actionId: 'u2', redo: true, via: 'keys' }),
      JSON.stringify({ actionId: 'u1', redo: true, via: 'keys' }),
    ]);
    expect(toasts).toEqual([
      'Undo: Restyle story',
      'Undo: Headline text',
      'Redo: Headline text',
      'Redo: Restyle story',
    ]);
  });

  test('U2: gesture time orders, not acceptance — an edit made during the run is undone after it', async () => {
    const { home, store } = setup();
    await store.open(REPO);
    // The run landed at 900 and was accepted FIRST; your headline (made at 800, during the run)
    // was published right behind it.
    home.add({ actionId: 'run1', kind: 'ai', label: 'Footer', madeAt: 900 });
    home.add({ actionId: 'head', kind: 'edit', label: 'Headline text', madeAt: 800 });
    expect((await store.undo(REPO)).undid).toBe('run1');
    expect((await store.undo(REPO)).undid).toBe('head');
  });

  test('U4: a fully conflicting ⌘Z marks the entry stale, names who changed it, and the next ⌘Z continues below', async () => {
    const { home, store, toasts } = setup();
    await store.open(REPO);
    home.add({ actionId: 'red', kind: 'edit', label: 'Colour', madeAt: 600 });
    home.add({ actionId: 'title', kind: 'edit', label: 'Headline text', madeAt: 610 });
    home.add({
      actionId: 'blue',
      kind: 'edit',
      label: 'Edit canvas',
      mine: false,
      actor: 'Tereza',
      madeAt: 620,
    });
    home.conflicts.add('title');

    const r = await store.undo(REPO);
    expect(r).toMatchObject({ handled: true, ok: false, stale: true });
    expect(toasts).toEqual([undoWords.stale('Headline text', 'Tereza')]);
    expect(store.rows(REPO).find((e) => e.actionId === 'title')?.state).toBe('stale');

    // skipped from now on — survives the next refresh (the server's fold does not know it)
    expect((await store.undo(REPO)).undid).toBe('red');
    expect(ids(home.posts)).toEqual([
      JSON.stringify({ actionId: 'title', via: 'keys' }),
      JSON.stringify({ actionId: 'red', via: 'keys' }),
    ]);
  });

  test('a partly conflicting ⌘Z undoes what is still yours and says how many parts it kept', async () => {
    const { home, store, toasts } = setup();
    await store.open(REPO);
    home.add({ actionId: 'p', kind: 'edit', label: 'Card padding', madeAt: 600 });
    home.add({
      actionId: 't',
      kind: 'edit',
      label: 'Edit canvas',
      mine: false,
      actor: 'Tereza',
      madeAt: 610,
    });
    home.skips.set('p', 2);
    await store.undo(REPO);
    expect(toasts).toEqual(['Undo: Card padding', undoWords.skipped('Card padding', 2, 'Tereza')]);
  });

  test('redo is cleared by your AI run landing (a new entry)', async () => {
    const { home, store } = setup();
    await store.open(REPO);
    home.add({ actionId: 'e1', kind: 'edit', label: 'Headline text', madeAt: 600 });
    await store.undo(REPO);
    home.add({ actionId: 'run', kind: 'ai', label: 'Footer', madeAt: 700 });
    store.onAction({ actionId: 'run', mine: true, kind: 'ai', canvases: [CANVAS] });
    const r = await store.redo(REPO);
    expect(r).toMatchObject({ handled: true, ok: false, reason: 'empty' });
    expect(home.posts.length).toBe(1); // only the ⌘Z
  });

  test('⌘Z on a pending entry (your edit behind your AI run) sends nothing — never an older entry, never the run', async () => {
    const { home, store } = setup();
    await store.open(REPO);
    home.add({ actionId: 'old', kind: 'edit', label: 'Headline text', madeAt: 600 });
    store.notePending(REPO, { pendingTx: 'tx1', label: 'Moved See pricing 10 px', madeAt: 700 });
    const r = await store.undo(REPO);
    expect(r).toMatchObject({ handled: true, ok: false, reason: 'pending', pendingTx: 'tx1' });
    expect(home.posts).toEqual([]);
    expect(store.rows(REPO)[0]).toMatchObject({ actionId: null, pendingTx: 'tx1', top: true });
  });

  test('HMR keeps the stack: re-opening the canvas keeps its session scope (shell-owned, keyed by canvas)', async () => {
    const { home, store, setNow } = setup();
    setNow(500);
    await store.open(REPO);
    home.add({ actionId: 'e1', kind: 'edit', label: 'Headline text', madeAt: 600 });
    setNow(5_000); // the iframe reloaded (a text edit's HMR) and the canvas re-announced itself
    await store.open(REPO);
    expect(store.rows(REPO).map((e) => e.actionId)).toEqual(['e1']);
    expect((await store.undo(REPO)).undid).toBe('e1');
  });

  test('membership: before the canvas opened, other people, outside writes and comments are not entries (U20)', async () => {
    const { home, store, setNow } = setup();
    home.add({ actionId: 'early', kind: 'edit', label: 'Before', madeAt: 100 });
    setNow(500);
    await store.open(REPO);
    home.add({ actionId: 'c', kind: 'comment', label: 'Comment', madeAt: 600 });
    home.add({ actionId: 'o', kind: 'outside', label: 'Combine', madeAt: 610 });
    home.add({
      actionId: 'z',
      kind: 'edit',
      label: 'Edit canvas',
      mine: false,
      actor: 'Tereza',
      madeAt: 620,
    });
    home.add({ actionId: 'ann', kind: 'edit', label: 'Edit annotations', madeAt: 630 });
    await store.refresh(REPO);
    expect(store.rows(REPO).map((e) => e.actionId)).toEqual(['ann']);
    expect(await store.loadOthers(REPO)).toEqual(['Tereza']);
  });

  test('U18: undo to here is ONE multi-target undo; the panel undo is the new top row ⌘Z takes back', async () => {
    const { home, store, toasts } = setup();
    await store.open(REPO);
    home.add({ actionId: 'a', kind: 'edit', label: 'Duplicated Desktop at Tablet', madeAt: 600 });
    home.add({ actionId: 'b', kind: 'ai', label: 'Hero picture', madeAt: 610 });
    home.add({ actionId: 'c', kind: 'edit', label: 'Moved See pricing 10 px', madeAt: 620 });
    home.add({ actionId: 'd', kind: 'edit', label: 'Headline text', madeAt: 630 });
    home.setClock(2_000);
    await store.refresh(REPO);
    // newest first: d, c, b, a — click the 3rd row (k = 2)
    const r = await store.undoToHere(REPO, 2);
    expect(r).toMatchObject({ ok: true, undid: ['d', 'c', 'b'] });
    expect(ids(home.posts)).toEqual([JSON.stringify({ actionIds: ['d', 'c', 'b'], via: 'panel' })]);
    expect(toasts).toEqual(['Undo: Hero picture']);
    const rows = store.rows(REPO);
    expect(rows[0]).toMatchObject({ actionId: 'u1', top: true });
    expect(rows.filter((e) => e.covered).map((e) => e.actionId)).toEqual(['d', 'c', 'b']);
    // ⌘Z takes the panel undo back (one step), not row 'a'
    expect((await store.undo(REPO)).undid).toBe('u1');
  });

  test('⇧⌘Z redoes an undo the store did not send (Version history row, another window): the server view names the undo', async () => {
    const { home, store } = setup();
    await store.open(REPO);
    home.add({ actionId: 'e1', kind: 'edit', label: 'Headline text', madeAt: 600 });
    // a single-id undo from Version history is labelled like a ⌘Z (via: keys) — a flip of e1
    home.add({ actionId: 'vh1', kind: 'undo', label: 'Undo', undoes: 'e1' });
    const r = await store.redo(REPO);
    expect(r).toMatchObject({ ok: true, redid: 'e1' });
    expect(ids(home.posts)).toEqual([JSON.stringify({ actionId: 'vh1', redo: true, via: 'keys' })]);
  });

  test('presses are serialized: two ⌘Z at once undo two different entries', async () => {
    const { home, store } = setup();
    await store.open(REPO);
    home.add({ actionId: 'e1', kind: 'edit', label: 'One', madeAt: 600 });
    home.add({ actionId: 'e2', kind: 'edit', label: 'Two', madeAt: 610 });
    const [a, b] = await Promise.all([store.undo(REPO), store.undo(REPO)]);
    expect([a.undid, b.undid]).toEqual(['e2', 'e1']);
  });

  test('a project off the op log answers legacy: the canvas stack runs (the dgn lane), the store sends nothing', async () => {
    const { home, store } = setup({ legacy: true });
    let fellBack = 0;
    const r = await runUndoKey(REPO, false, () => fellBack++, store);
    expect(r.handled).toBe(false);
    expect(fellBack).toBe(1);
    expect(store.mode(REPO)).toBe('legacy');
    expect(home.posts).toEqual([]);
  });

  test('op-log mode never falls back to the canvas stack — even with nothing to undo', async () => {
    const { store } = setup();
    let fellBack = 0;
    const r = await runUndoKey(REPO, false, () => fellBack++, store);
    expect(r).toMatchObject({ handled: true, reason: 'empty' });
    expect(fellBack).toBe(0);
  });
});
