// S9.11 — V2-1.16 L13: AI activity on B is invisible to an A-only session.
//   - `GET /_api/ai` (main AND canvas origin) lists no B entry;
//   - `GET /_api/ai/runs` (V2-1.15) lists a run only when everything it names is visible; a
//     run spanning B shows on A's artboards with no label (U4); counts follow (U5);
//   - project sessions get today's bodies (U7).

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { filterRunsView, type Seer } from '../access/filters.ts';
import { filterAiEntries } from '../collab/ai-activity.ts';
import { A_ONLY, type AclCell, B_REL, bootAclCell, get, hasCanary, OWNER } from './_acl-cell.ts';
import { killProc } from './_helpers.ts';

const B_FILE = `.design/${B_REL}`;

describe('booted cell', () => {
  let cell: AclCell;
  beforeAll(async () => {
    cell = await bootAclCell();
    const r = await fetch(`${cell.base}/_api/ai/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: cell.base, ...OWNER },
      body: JSON.stringify({ file: B_FILE, author: 'Claude' }),
    });
    if (r.status !== 200) throw new Error(`ai/start ${r.status}: ${await r.text()}`);
  }, 60000);
  afterAll(async () => {
    if (cell) await killProc(cell.proc);
  });

  test('the owner sees the AI working on B (not vacuous)', async () => {
    expect(hasCanary((await get(`${cell.base}/_api/ai`, OWNER)).text)).toBe(true);
    expect(hasCanary((await get(`${cell.base}/_api/ai/runs`, OWNER)).text)).toBe(true);
  });

  test('an A-only session: /_api/ai lists nothing of B, on both origins', async () => {
    for (const base of [cell.base, cell.canvasBase]) {
      const r = await get(`${base}/_api/ai`, A_ONLY);
      expect(r.status).toBe(200);
      expect(hasCanary(r.text)).toBe(false);
      expect(JSON.parse(r.text).entries).toEqual([]);
    }
  });

  test('an A-only session: /_api/ai/runs lists nothing of B and counts nothing of it', async () => {
    const r = await get(`${cell.base}/_api/ai/runs`, A_ONLY);
    expect(r.status).toBe(200);
    expect(hasCanary(r.text)).toBe(false);
    const view = JSON.parse(r.text);
    expect(view.mine).toEqual([]);
    expect(view.live).toBe(0);
  });
});

// ---------------------------------------------------------------------------

const D = '.design';
const seeA: Seer = (rel) => rel === 'ui/a.tsx';
const key = (canvas: string, artboard = 'ab1') => ({ canvas: `path:.design/${canvas}`, artboard });

describe('filterRunsView', () => {
  const runA = {
    runId: 'r-a',
    label: 'Claude edited a',
    state: 'running',
    scope: { canvas: 'ui/a.tsx', artboards: ['ab1'] },
    leases: [key('ui/a.tsx')],
    waiting: [],
    touched: { 'ui/a.tsx': ['ab1'] },
    objects: [],
    doing: 'tightening a',
  };
  const runAB = {
    ...runA,
    runId: 'r-ab',
    label: 'Claude edited canary-b-zx',
    state: 'needs-you',
    question: 'Which canary-b colour?',
    leases: [key('ui/a.tsx'), key('ui/canary-b-zx.tsx')],
    touched: { 'ui/a.tsx': ['ab1'], 'ui/canary-b-zx.tsx': ['ab2'] },
  };
  const runB = {
    ...runA,
    runId: 'r-b',
    label: 'canary-b',
    scope: { canvas: 'ui/canary-b-zx.tsx', artboards: '*' },
    leases: [key('ui/canary-b-zx.tsx')],
    touched: {},
  };
  const other = (canvas: string, label: string) => ({
    runId: `o-${canvas}`,
    label,
    state: 'running',
    artboards: [key(canvas)],
    waitingFor: [],
    objects: [],
  });
  const view = {
    seq: 7,
    mine: [runA, runAB, runB],
    others: [other('ui/a.tsx', 'Ana on a'), other('ui/canary-b-zx.tsx', 'Ana on canary-b')],
    needsYou: 1,
    live: 3,
  };

  test('identity for a project session (U7)', () => {
    expect(filterRunsView(view, null, D)).toBe(view);
  });

  test('canvas-only: whole when visible, unlabelled when spanning, absent when invisible', () => {
    const out = filterRunsView(view, seeA, D);
    expect(hasCanary(JSON.stringify(out))).toBe(false);
    expect(out.mine.map((r) => (r as { runId: string }).runId)).toEqual(['r-a', 'r-ab']);
    expect(out.mine[0]).toBe(runA);
    const spanning = out.mine[1] as Record<string, unknown>;
    expect(spanning.label).toBe('');
    expect(spanning.question).toBeUndefined();
    expect(spanning.leases).toEqual([key('ui/a.tsx')]);
    expect(out.others).toHaveLength(1);
    expect(out.needsYou).toBe(1);
    expect(out.live).toBe(2);
  });

  test('a lease key that is a kernel entry (not placeable) is invisible', () => {
    const entry = { ...other('ui/a.tsx', 'x'), artboards: [{ canvas: 'e-123', artboard: 'a' }] };
    expect(filterRunsView({ ...view, mine: [], others: [entry] }, seeA, D).others).toEqual([]);
  });
});

test('filterAiEntries: identity for a project session; visible canvases only otherwise', () => {
  const entries = [
    { file: '.design/ui/a.tsx', author: 'Claude', startedAt: 1, lastHeartbeat: 1 },
    { file: B_FILE, author: 'Claude', startedAt: 1, lastHeartbeat: 1 },
  ];
  expect(filterAiEntries(entries, null, D)).toBe(entries);
  expect(filterAiEntries(entries, seeA, D)).toEqual([entries[0]]);
  expect(filterAiEntries([{ ...entries[0], file: '.design/../ui/a.tsx' }], seeA, D)).toEqual([]);
});
