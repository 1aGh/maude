// V2-5 A5 — the lead's patches on the merged wave (shared files no slice could edit). Each slice's
// component is tested in its own file; this pins the wiring, so a later merge that drops a line is a
// red test, not a silent dead feature.

import { describe, expect, test } from 'bun:test';
import { frameFor, type Seer } from '../access/filters.ts';
import { writeCapability } from '../access/request.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import type { Comment } from '../api.ts';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { type CommentRecord, sanitizeFrom } from '../comments/ops.ts';
import { createAnnotationRoutes } from '../routes/annotations.ts';

const read = (rel: string) => Bun.file(new URL(`../${rel}`, import.meta.url)).text();

describe('A5 shell wiring (app.jsx)', () => {
  test('S5.11 + S5.13 — ai:runs reaches the run store; its event is the one the needs-you store hears', async () => {
    const app = await read('client/app.jsx');
    expect(app).toMatch(/m\.type === 'ai:runs'\) \{(\s*\/\/[^\n]*)*\s*noteAiRuns\(m\.seq\);/);
    const store = await read('client/v2/ai/runs-store.js');
    expect(store).toContain("export const RUNS_EVENT = 'maude:ai-runs';");
    const needs = await read('client/v2/ai/needs-you-store.js');
    expect(needs).toContain("addEventListener?.('maude:ai-runs'");
  });

  test('S1.7b — trash:changed is relayed as maude:trash-changed with its payload', async () => {
    const app = await read('client/app.jsx');
    expect(app).toMatch(
      /m\.type === 'trash:changed'\) \{(\s*\/\/[^\n]*)*\s*window\.dispatchEvent\(new CustomEvent\(TRASH_CHANGED_EVENT, \{ detail: m\.payload \}\)\);/
    );
  });

  test('S5.11 — project:action settles a Done ring on every artboard it touched', async () => {
    const app = await read('client/app.jsx');
    expect(app).toMatch(
      /m\.type === 'project:action'\) \{(\s*\/\/[^\n]*)*\s*getRunsStore\(\)\.markDone\(\s*Object\.values\(m\.action\?\.artboards \?\? \{\}\)\.flat\(\)\s*\);/
    );
  });

  test('S5.13 / S5.10 — Open on a toast opens the AI chat; From Assets opens Assets', async () => {
    const app = await read('client/app.jsx');
    expect(app).toMatch(
      /addEventListener\(OPEN_AI_EVENT, [\s\S]{0,80}openRightPanel\('assistant'\)|const onOpenAi = \(\) => openRightPanel\('assistant'\);[\s\S]{0,120}addEventListener\(OPEN_AI_EVENT, onOpenAi\)/
    );
    expect(app).toMatch(
      /const onAttachAssets = \(\) => menuRunner\.run\('view\.assets'\);[\s\S]{0,120}addEventListener\(OPEN_ASSETS_EVENT, onAttachAssets\)/
    );
  });

  test('S2.8 — app.jsx no longer imports the retired artboard knobs', async () => {
    const app = await read('client/app.jsx');
    expect(app).not.toContain('artboard-knobs.jsx');
  });
});

describe('A5 server wiring', () => {
  test('S5.5b — the studio’s own run registry ends each run’s stage (not only the fallback)', async () => {
    const server = await read('server.ts');
    const at = server.indexOf('const runRegistry = createRunRegistry({');
    expect(at).toBeGreaterThan(-1);
    const call = server.slice(at, server.indexOf('\n});', at));
    expect(call).toMatch(/stage: runStageHooks\(\{/);
  });

  test('S1.18 — /_api/link/resolve reads the session’s access; S4.7 — conversions read its canvas scope', async () => {
    const http = await read('http.ts');
    const links = http.slice(http.indexOf('    linkResolve: {'));
    expect(links.slice(0, links.indexOf('\n    },'))).toContain('scope: (req) => accessOf(req)');
    const ann = http.slice(http.indexOf('    annotations: {'));
    expect(ann.slice(0, ann.indexOf('\n    },'))).toMatch(/scope: \(req, file\) =>/);
  });
});

describe('S1.7b — trash:changed on a canvas-only socket (U3)', () => {
  const seeA: Seer = Object.assign((rel: string) => rel === 'ui/a.tsx', {
    holds: (dir: string) => 'ui/a.tsx'.startsWith(`${dir}/`),
  });
  test('delivered: it carries only the Trash’s seq, and that session’s list is filtered by the route', () => {
    const f = { type: 'trash:changed', payload: { seq: 4 } };
    expect(frameFor(f, seeA, '.design')).toEqual(f);
  });
});

describe('S4.7 — the conversions are annotate writes', () => {
  test('to-comment, to-sticky and convert-undo need `annotate`', () => {
    for (const p of [
      '/_api/annotations/to-comment',
      '/_api/comments/to-sticky',
      '/_api/annotations/convert-undo',
    ])
      expect(writeCapability(p)).toBe('annotate');
  });
});

describe('S4.7 — a turned-back sticky keeps its look (decision v2-lead-from-carries-sticky-look)', () => {
  const actor = { name: 'Michal' };
  const NOW = '2026-10-18T10:00:00.000Z';

  test('sanitizeFrom keeps a palette fill and a bounded size, and drops anything else', () => {
    const base = { kind: 'sticky', id: 's_1', author: 'Jonas' };
    expect(sanitizeFrom({ ...base, fill: '#FFE89A', w: 240, h: 180 }, actor, NOW)).toMatchObject({
      fill: '#FFE89A',
      w: 240,
      h: 180,
    });
    const bad = sanitizeFrom(
      { ...base, fill: 'url(javascript:x)', w: Number.POSITIVE_INFINITY, h: 99999 },
      actor,
      NOW
    );
    expect(bad).toBeDefined();
    expect(bad).not.toHaveProperty('fill');
    expect(bad).not.toHaveProperty('w');
    expect(bad).not.toHaveProperty('h');
  });

  /** One conversion through the route, over an in-memory board + thread list. */
  async function convert(
    path: string,
    body: unknown,
    board: AnnotationElement[],
    comments: Comment[]
  ) {
    let out: { ops?: Array<{ op: string; el?: AnnotationElement }>; comments?: Comment[] } = {};
    const routes = createAnnotationRoutes({
      api: {
        fileSlug: () => 'ui-card',
        loadAllComments: async () => ({ 'ui-card': comments }),
        convertLanes: (async (_file: string, fn: (s: unknown) => Record<string, unknown>) => {
          const r = fn({ board, comments }) as Record<string, unknown> & { ok: boolean };
          if (!r.ok) return r;
          out = r as typeof out;
          return { ok: true, result: r.result, snapshot: { file: _file }, actionId: 'a1' };
        }) as never,
        restoreConversion: async () => ({ ok: true }),
      },
      control: () => null,
      person: async () => actor,
    });
    const spec = routes.specs.find((s) => s.path === path);
    if (!spec) throw new Error(`no ${path}`);
    const res = await spec.handle(
      new Request(`http://localhost${path}`, { method: 'POST', body: JSON.stringify(body) }),
      {} as never
    );
    return { status: res.status, out };
  }

  test('to-comment records the sticky’s fill and size; to-sticky gives them back', async () => {
    const sticky = {
      id: 's_hero',
      type: 'sticky',
      index: 'a0',
      x: 10,
      y: 20,
      w: 260,
      h: 140,
      fill: '#C9F0D2',
      text: 'Bigger hero',
      author: { kind: 'human', name: 'Jonas' },
    } as unknown as AnnotationElement;
    const one = await convert(
      '/_api/annotations/to-comment',
      { file: '.design/ui/card.tsx', id: 's_hero' },
      [sticky],
      []
    );
    expect(one.status).toBe(200);
    const c = one.out.comments?.at(-1) as CommentRecord & {
      from?: { fill?: string; w?: number; h?: number };
    };
    expect(c.from).toMatchObject({ fill: '#C9F0D2', w: 260, h: 140 });

    const back = await convert(
      '/_api/comments/to-sticky',
      { commentId: c.id },
      [],
      [{ ...c, file: '.design/ui/card.tsx' } as unknown as Comment]
    );
    expect(back.status).toBe(200);
    const el = back.out.ops?.[0]?.el as AnnotationElement & { fill?: string };
    expect(el).toMatchObject({ x: 10, y: 20, w: 260, h: 140, fill: '#C9F0D2' });
  });
});

describe('S3.6b — the canvas reports its Present run (dgn `present-run`)', () => {
  const row = (
    DGN_TABLE.c2s as Record<
      string,
      { gate: string; status: string; parse: (m: unknown) => unknown }
    >
  )['present-run'];

  test('a live, active-canvas row with bounded artboards', () => {
    expect(row).toBeDefined();
    expect(row.gate).toBe('active');
    expect(row.status).toBe('live');
    const ok = { artboards: [{ id: 'hero', label: 'Hero', x: 0, y: 0, w: 1440, h: 900 }] };
    expect(row.parse(ok)).toEqual(ok);
    expect(
      row.parse({ artboards: [{ id: 'x'.repeat(201), label: '', x: 0, y: 0, w: 1, h: 1 }] })
    ).toBeNull();
    expect(
      row.parse({ artboards: [{ id: 'a', label: 'A', x: Number.NaN, y: 0, w: 1, h: 1 }] })
    ).toBeNull();
    const many = Array.from({ length: 2001 }, (_, i) => ({
      id: `a${i}`,
      label: '',
      x: 0,
      y: 0,
      w: 1,
      h: 1,
    }));
    expect(row.parse({ artboards: many })).toBeNull();
  });

  test('presentRunReport: canvas order, label from the artboard, clamped and bounded', async () => {
    // imported here, so the other A5 pins stay readable while this export is missing
    const { presentRunReport } = (await import('../present/present-stage.tsx')) as unknown as {
      presentRunReport: (
        a: Array<{ id: string; x: number; y: number; w: number; h: number; kind: string }>,
        label: (id: string) => string | null
      ) => unknown[];
    };
    const list = presentRunReport(
      [
        { id: 'b', x: 2000, y: 0, w: 400, h: 300, kind: 'digital' },
        { id: 'a', x: 0, y: 0, w: 1440, h: 900, kind: 'digital' },
      ],
      (id) => (id === 'a' ? 'Hero' : null)
    );
    expect(list).toEqual([
      { id: 'b', label: 'b', x: 2000, y: 0, w: 400, h: 300 },
      { id: 'a', label: 'Hero', x: 0, y: 0, w: 1440, h: 900 },
    ]);
    expect(row.parse({ artboards: list })).toEqual({ artboards: list });
  });

  test('the stage posts it at Present start and when the artboard list changes', async () => {
    const src = await read('present/present-stage.tsx');
    expect(src).toMatch(/reportPresentRun\(\s*win,\s*presentRunReport\(/);
    expect(src).toMatch(/\}, \[active, opts\.artboards\]\);/);
  });
});
