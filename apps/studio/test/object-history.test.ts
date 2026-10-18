// S1.16 — object-scoped history (V2-1.9 §5.9, H9): derived by ElementRef / annotation id from the cached
// descriptions; the pre-stamp chain stops where matching is not a clear mutual best; an aside kept inside an
// edit action is listed; reading writes nothing; 100 versions cold stay inside the 2 s budget.

import { describe, expect, test } from 'bun:test';

import { resolveAccess } from '../access/scope.ts';
import { type ObjectHistoryRuntime, objectHistory } from '../history/object-history.ts';
import { parseObjectKey } from '../history/restore-object.ts';
import type { HistoryRowLike } from '../history/versions.ts';
import { createHistoryRoutes, type HistoryRuntime } from '../routes/history.ts';

const MIN = 60_000;
const T0 = new Date(2026, 9, 18, 9, 0).getTime();

const canvasOf = (inner: string) =>
  `export default () => (<DesignCanvas>\n<DCArtboard id="hero" label="Hero" width={400} height={300}>${inner}</DCArtboard>\n</DesignCanvas>);\n`;

const stickyBoard = (...els: Array<Record<string, unknown>>) =>
  JSON.stringify({ format: 'maude.annotations', v: 2, elements: els });
const sticky = (id: string, text: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  x: 10,
  y: 10,
  w: 120,
  h: 80,
  text,
  ...extra,
});

interface Step {
  tsx?: string;
  annotations?: string;
  asideAnnotations?: string;
  actor?: string;
  kind?: string;
}

/** r<n> = steps[n-1]; a lane a step leaves out keeps the previous step's. */
function world(steps: Step[]) {
  const rows: HistoryRowLike[] = [];
  const state: Array<{ tsx: string; annotations: string | null }> = [];
  const asides = new Map<number, string>();
  let tsx = canvasOf('');
  let annotations: string | null = null;
  steps.forEach((s, i) => {
    const rev = i + 1;
    if (s.tsx !== undefined) tsx = s.tsx;
    if (s.annotations !== undefined) annotations = s.annotations;
    state.push({ tsx, annotations });
    const lanes = [
      ...(s.tsx !== undefined ? ['html'] : []),
      ...(s.annotations !== undefined ? ['annotations'] : []),
      ...(s.asideAnnotations !== undefined ? ['@aside'] : []),
    ];
    if (s.asideAnnotations !== undefined) asides.set(rev, s.asideAnnotations);
    rows.push({
      revision: rev,
      actionId: `a${rev}`,
      actor: s.actor ?? 'jonas',
      mine: false,
      kind: s.kind ?? 'edit',
      label: null,
      committedAt: T0 + i * 20 * MIN,
      madeAt: T0 + i * 20 * MIN,
      undoes: null,
      canvases: ['ui/a.tsx'],
      lanes: { 'ui/a.tsx': lanes.length ? lanes : ['html'] },
    });
  });
  const calls = { acceptedHistory: 0, acceptedVersion: 0, writes: [] as string[] };
  const rt: HistoryRuntime & ObjectHistoryRuntime = {
    async acceptedHistory(q) {
      calls.acceptedHistory++;
      return rows
        .filter((r) => !q.before || r.revision < q.before)
        .filter((r) => !q.kind || r.kind === q.kind)
        .sort((a, b) => b.revision - a.revision)
        .slice(0, q.limit ?? 50);
    },
    async acceptedVersion(_repoRel, rev, lane = 'html', opts) {
      calls.acceptedVersion++;
      const at = state[rev - 1];
      if (!at) return null;
      if (opts?.aside) return lane === 'annotations' ? (asides.get(rev) ?? null) : null;
      if (lane === 'html') return at.tsx;
      if (lane === 'annotations') return at.annotations;
      return null;
    },
    async acceptedName() {
      calls.writes.push('name');
      return { status: 'accepted', actionId: 'x' };
    },
    async acceptedAside() {
      calls.writes.push('aside');
      return { status: 'accepted', actionId: 'x' };
    },
    async acceptedRestore() {
      calls.writes.push('restore');
      return { status: 'accepted', actionId: 'x' };
    },
  } as HistoryRuntime & ObjectHistoryRuntime;
  return { rt, calls };
}

const ask = (rt: ObjectHistoryRuntime, key: string) =>
  objectHistory({
    runtime: rt,
    repoRel: '.design/ui/a.tsx',
    canvas: 'ui/a.tsx',
    key: parseObjectKey(key) as NonNullable<ReturnType<typeof parseObjectKey>>,
    clock: (ms) => new Date(ms).toISOString().slice(11, 16),
  });

describe('object history — canvas element with an authored id', () => {
  const btn = (label: string, extra = '') =>
    `<h1>Title</h1><button data-cd-id="cta" className="primary"${extra}>${label}</button><p>Footer line</p>`;

  test('exact in every version that carries the id; other changes are not its rows', async () => {
    const { rt } = world([
      { tsx: canvasOf(btn('Buy')) }, // r1: created
      { tsx: canvasOf(btn('Buy now')) }, // r2: its text
      { tsx: canvasOf(btn('Buy now').replace('Footer line', 'Footer line 2')) }, // r3: somebody else
      {
        tsx: canvasOf(
          btn('Buy now', ' style={{ color: "red" }}').replace('Footer line', 'Footer line 2')
        ),
      }, // r4
    ]);
    const a = await ask(rt, 'hero/cta');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.header).toBe('this object');
    expect(a.rows.map((r) => r.ref)).toEqual(['r4', 'r2']);
    expect(a.rows.every((r) => !r.matched && r.restore === 'ok')).toBe(true);
    expect(a.rows[1]?.value).toBe('“Buy now”');
    expect(a.rows[1]?.who.name).toBe('Someone');
    expect(a.rows[0]?.sub).toMatch(/ · \d\d:\d\d$/);
  });

  test('a removed element lists its removal (no Restore on that row)', async () => {
    const { rt } = world([
      { tsx: canvasOf(btn('Buy')) },
      { tsx: canvasOf(btn('Buy now')) },
      { tsx: canvasOf('<h1>Title</h1><p>Footer line</p>') },
    ]);
    const a = await ask(rt, 'hero/cta');
    expect(a.ok && a.rows.map((r) => `${r.ref}:${r.what}:${r.restore}`)).toEqual([
      'r3:removed:none',
      'r2:changed:ok',
    ]);
  });
});

describe('object history — before the id was stamped (found by matching)', () => {
  test('a unique element is followed back; those rows are marked and offer the artboard instead', async () => {
    const intro = (text: string, id = '') =>
      canvasOf(`<h1>Title</h1><p className="lead"${id}>${text}</p><footer>Footer</footer>`);
    const { rt } = world([
      { tsx: intro('We make small shoes') }, // r1
      { tsx: intro('We make small shoes for big feet') }, // r2: the paragraph's text
      { tsx: intro('We make small shoes for big feet', ' data-cd-id="lead"') }, // r3: stamped
    ]);
    const a = await ask(rt, 'hero/lead');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const r2 = a.rows.find((r) => r.ref === 'r2');
    expect(r2?.matched).toBe(true);
    expect(r2?.restore).toBe('artboard');
    expect(r2?.chips).toContain('Found by matching');
    expect(a.stoppedAt).toEqual({ reason: 'start' });
  });

  test('matching stops on no mutual best: two identical siblings are never told apart', async () => {
    const two = (b: string, id = '') =>
      canvasOf(`<h1>Title</h1><p className="note">Same</p><p className="note"${id}>${b}</p>`);
    const { rt } = world([
      { tsx: two('Same') }, // r1: two identical paragraphs
      { tsx: two('Same!') }, // r2: the second one's text
      { tsx: two('Same!', ' data-cd-id="second"') }, // r3: stamped
    ]);
    const a = await ask(rt, 'hero/second');
    // nothing exact before the stamp, and the chain refuses to guess which paragraph r2 touched
    if (a.ok) {
      expect(a.rows.some((r) => r.matched)).toBe(false);
      expect(a.stoppedAt?.reason).toBe('ambiguous');
    } else expect(a.reason).toBe('not-found');
  });
});

describe('object history — annotation elements', () => {
  const steps: Step[] = [
    {
      annotations: stickyBoard(
        sticky('s1', 'Číslo na zádech?', { author: 'tereza' }),
        sticky('s2', 'Other')
      ),
      actor: 'tereza',
    },
    {
      annotations: stickyBoard(
        sticky('s1', 'Číslo na zádech větší — 30 cm'),
        sticky('s2', 'Other')
      ),
      actor: 'you',
    },
    {
      annotations: stickyBoard(
        sticky('s1', 'Číslo na zádech větší — 30 cm'),
        sticky('s2', 'Other!')
      ),
    }, // s2 only
    {
      annotations: stickyBoard(sticky('s1', 'Číslo 25 cm — jinak se nad…'), sticky('s2', 'Other!')),
      actor: 'jonas',
    },
  ];

  test('rows by id with the value then; header says sticky; another sticky is not a row', async () => {
    const { rt } = world(steps);
    const a = await ask(rt, 's1');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    expect(a.header).toBe('this sticky');
    expect(a.rows.map((r) => `${r.ref}:${r.what}`)).toEqual([
      'r4:changed',
      'r2:changed',
      'r1:added',
    ]);
    expect(a.rows[0]?.value).toBe('“Číslo 25 cm — jinak se nad…”');
    expect(a.rows[0]?.lines[0]).toContain('Sticky:');
    expect(a.rows.map((r) => r.restore)).toEqual(['ok', 'ok', 'ok']);
  });

  test('a version kept aside inside an edit action (S9.24 Keep both) is listed, without a Restore', async () => {
    const s = [...steps];
    s.splice(2, 0, {
      annotations: stickyBoard(
        sticky('s1', 'Číslo na zádech větší — 30 cm'),
        sticky('s2', 'Other')
      ),
      asideAnnotations: stickyBoard(sticky('s1', 'Číslo 28 cm'), sticky('s2', 'Other')),
      actor: 'tereza',
    });
    const { rt } = world(s);
    const a = await ask(rt, 's1');
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const aside = a.rows.find((r) => r.aside);
    expect(aside?.ref).toBe('r3');
    expect(aside?.title).toBe(
      'Tereza’s version, not kept'.replace('Tereza', aside?.who.name ?? '')
    );
    expect(aside?.value).toBe('“Číslo 28 cm”');
    expect(aside?.restore).toBe('none');
    expect(aside?.chips).toContain('Not kept');
  });
});

describe('object history — reading', () => {
  test('writes nothing for any role, and Can view / observer get the same rows as an editor', async () => {
    const { rt, calls } = world([
      { annotations: stickyBoard(sticky('s1', 'a')) },
      { annotations: stickyBoard(sticky('s1', 'b')) },
    ]);
    let who = resolveAccess({ v: 1, role: 'member' });
    const specs = createHistoryRoutes({
      control: () => rt,
      designRel: '.design',
      access: () => who,
    });
    const spec = specs.find((s) => s.method === 'GET' && s.path === '/_api/project/object-history');
    expect(spec).toBeTruthy();
    const get = async () => {
      const res = await (spec as NonNullable<typeof spec>).handle(
        new Request(
          `http://localhost/_api/project/object-history?${new URLSearchParams({ path: 'ui/a.tsx', object: 's1' })}`
        ),
        {}
      );
      const { ms: _ms, ...body } = (await res.json()) as {
        ms?: number;
        rows?: Array<{ ref: string }>;
      };
      return { status: res.status, body };
    };
    const editor = await get();
    who = resolveAccess({ v: 1, role: 'viewer' });
    const viewer = await get();
    who = resolveAccess({ v: 1, role: 'observer' });
    const observer = await get();
    expect(editor.status).toBe(200);
    expect(viewer.body.rows?.map((r) => r.ref)).toEqual(['r2', 'r1']);
    expect(observer.body).toEqual(viewer.body);
    expect(calls.writes).toEqual([]);
  });

  test('a canvas-only session is refused a canvas it was not granted; a bad object is a 400', async () => {
    const { rt } = world([{ annotations: stickyBoard(sticky('s1', 'a')) }]);
    let who = resolveAccess({ v: 1, role: null, grants: [{ c: 'ui/other.tsx', r: 'member' }] });
    const specs = createHistoryRoutes({
      control: () => rt,
      designRel: '.design',
      access: () => who,
    });
    const spec = specs.find((s) => s.path === '/_api/project/object-history');
    const call = async (q: Record<string, string>) =>
      (spec as NonNullable<typeof spec>).handle(
        new Request(`http://localhost/_api/project/object-history?${new URLSearchParams(q)}`),
        {}
      );
    const refused = await call({ path: 'ui/a.tsx', object: 's1' });
    expect(refused.status).toBe(403);
    expect(((await refused.json()) as { reason: string }).reason).toBe('not-in-scope');
    who = resolveAccess({ v: 1, role: 'member' });
    expect((await call({ path: 'ui/a.tsx', object: 'a/b/c' })).status).toBe(400);
    expect((await call({ path: 'ui/a.tsx' })).status).toBe(400);
  });

  test('100 versions, cold, inside 2 s', async () => {
    const steps: Step[] = [];
    for (let i = 0; i < 100; i++)
      steps.push({
        tsx: canvasOf(
          `<h1>Title</h1><button data-cd-id="cta">Buy ${i % 7 === 0 ? i : 0}</button><p>Footer ${i}</p>`
        ),
      });
    const { rt } = world(steps);
    const t0 = performance.now();
    const a = await ask(rt, 'hero/cta');
    expect(performance.now() - t0).toBeLessThan(2000);
    expect(a.ok).toBe(true);
  });
});
