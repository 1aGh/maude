// S8.16 — Generate with N takes (12 · ia-gen-ask, ia-gen-placed). No real provider anywhere: the takes come
// from the stub adapter (solid PNGs) through a fake queue and a fake asset store. Proves:
//   - the artboard sets the shape (1080×1350 → 4:5) and the consent line says how long and who pays;
//   - no egress without the consent line: a run with no quote, a used quote or a quote for other
//     parameters starts nothing (the provider is never called);
//   - N takes come back, each with its own `.gen.json` (one group, the same takes, a valid maude.gen v1);
//   - Can edit only (a viewer and a canvas-only session elsewhere get no quote);
//   - ← → is a src rewrite of the placed picture (one image.replace, one write) to the neighbour take.

import { describe, expect, test } from 'bun:test';
import type { Access } from '../access/scope.ts';
import { type DispatchDeps, dispatchEditOp } from '../edit-ops/dispatch.ts';
import { createWriteLog } from '../edit-ops/revert.ts';
import { GEMINI_DESCRIPTOR } from '../generation/adapters/gemini.ts';
import {
  createStubAdapter,
  STUB_DESCRIPTOR,
  STUB_MODELS,
  solidPng,
} from '../generation/adapters/stub.ts';
import { readGen } from '../generation/gen-sidecar.ts';
import {
  aspectFor,
  consentLines,
  createQuotes,
  createTakeGroups,
  estimateSeconds,
  neighbourTake,
} from '../generation/takes.ts';
import { createGenerateRoutes, type GenerateRouteDeps } from '../routes/generate.ts';

const CANVAS = 'ui/matchday.tsx';

function access(o: { edit?: boolean; canvasOnly?: string } = {}): Access {
  const edit = o.edit ?? true;
  return {
    role: o.canvasOnly ? null : edit ? 'edit' : 'view',
    canvasOnly: !!o.canvasOnly,
    grants: o.canvasOnly ? [{ c: o.canvasOnly, cap: 'edit' }] : [],
    can: (cap: string, c: string | null) =>
      o.canvasOnly ? c === o.canvasOnly : cap === 'read' || cap === 'comment' || edit,
    seesCanvas: (c: string) => (o.canvasOnly ? c === o.canvasOnly : true),
  } as unknown as Access;
}

async function sha8(bytes: Uint8Array): Promise<string> {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...d.slice(0, 4)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function harness(o: { access?: Access } = {}) {
  const files = new Map<string, string>();
  const assets = new Set<string>();
  let submits = 0;
  let jobs = 0;
  const groups = createTakeGroups({
    enqueue: (a) => {
      jobs += 1;
      const ctl = new AbortController();
      return {
        id: `gen_${jobs}`,
        result: a.run(ctl.signal).then((out) => ({ status: 'done', assets: out.assets })),
      };
    },
    writeSidecar: async (rel, text) => {
      files.set(rel, text);
    },
  });
  const adapter = createStubAdapter({ apiKey: null, localize: async () => '' } as never);
  const deps: GenerateRouteDeps = {
    access: () => o.access ?? access(),
    resolveCanvas: (f) => (f.replace(/^\.design\//, '') === CANVAS ? CANVAS : null),
    artboard: (_c, id) =>
      id === 'gw5' ? { w: 1080, h: 1350, label: 'Post 4:5 · Gameweek 5' } : null,
    imageProviders: () => [{ descriptor: STUB_DESCRIPTOR, models: STUB_MODELS, ready: true }],
    past: () => [],
    concurrency: 4,
    quotes: createQuotes(),
    groups,
    submit: async (req) => {
      submits += 1;
      const job = await adapter.submit(req);
      const r = await job.result();
      const bytes = r.assets[0]?.bytes as Uint8Array;
      const rel = `assets/${await sha8(bytes)}.png`;
      assets.add(rel.slice('assets/'.length));
      return { assets: [rel] };
    },
    readText: (rel) => files.get(rel) ?? null,
    assetNames: () => [...assets, ...[...files.keys()].map((k) => k.slice('assets/'.length))],
    displayName: () => 'Tereza',
  };
  const specs = createGenerateRoutes(deps);
  const call = async (method: string, path: string, body?: unknown) => {
    const url = new URL(path, 'http://localhost');
    const spec = specs.find((s) => s.method === method && s.path === url.pathname);
    if (!spec) throw new Error(`no route ${method} ${path}`);
    const res = await spec.handle(
      new Request(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }),
      {}
    );
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  return { call, files, groups, submits: () => submits };
}

const ASK = { canvas: CANVAS, artboard: 'gw5', prompt: 'touchdown, night stadium, fog' };

describe('the ask (ia-gen-ask)', () => {
  test('the artboard sets the shape', () => {
    expect(aspectFor(1080, 1350)).toBe('4:5');
    expect(aspectFor(1080, 1920)).toBe('9:16');
    expect(aspectFor(1920, 1080)).toBe('16:9');
    expect(aspectFor(1000, 1000)).toBe('1:1');
    expect(aspectFor(1080, 1350, ['1:1', '16:9', '9:16'])).toBe('1:1');
  });

  test('one line says how long and whose account pays; one line covers the licence', () => {
    const l = consentLines(GEMINI_DESCRIPTOR, estimateSeconds([], 4, 4));
    expect(l.time).toBe('About 30 s · billed to your Google key');
    expect(l.licence).toContain('SynthID');
    expect(consentLines(STUB_DESCRIPTOR, 2).time).toBe('About 2 s · nothing is billed');
    expect(estimateSeconds([{ ms: 20_000 }, { ms: 24_000 }, { ms: 90_000 }], 4, 2)).toBe(48);
  });

  test('the quote carries the shape, the artboard, and both lines', async () => {
    const h = harness();
    const q = await h.call('POST', '/_api/generate-takes/quote', ASK);
    expect(q.status).toBe(200);
    expect(q.body.aspect).toBe('4:5');
    expect(q.body.n).toBe(4);
    expect((q.body.artboard as { label: string }).label).toBe('Post 4:5 · Gameweek 5');
    expect((q.body.lines as { time: string }).time).toMatch(/^About \d+ s · /);
    expect(h.submits()).toBe(0);
  });
});

describe('no egress without the consent line', () => {
  test('no quote, a used quote, or a quote for other parameters: nothing is sent', async () => {
    const h = harness();
    const run = (extra: Record<string, unknown>) =>
      h.call('POST', '/_api/generate-takes', {
        ...ASK,
        provider: 'stub',
        model: 'stub-solid',
        n: 4,
        aspect: '4:5',
        ...extra,
      });
    expect((await run({})).body.reason).toBe('no-consent');
    expect((await run({ quote: 'q_made_up' })).status).toBe(409);
    const q = await h.call('POST', '/_api/generate-takes/quote', ASK);
    // the same quote for six takes instead of four
    expect((await run({ quote: q.body.quote, n: 6 })).body.reason).toBe('no-consent');
    // a refused redeem uses the quote up too
    expect((await run({ quote: q.body.quote })).status).toBe(409);
    expect(h.submits()).toBe(0);
  });
});

describe('four takes (ia-gen-placed)', () => {
  test('N parallel takes, one .gen.json each, one group; the best is the first good take', async () => {
    const h = harness();
    const q = await h.call('POST', '/_api/generate-takes/quote', ASK);
    const r = await h.call('POST', '/_api/generate-takes', {
      ...ASK,
      quote: q.body.quote,
      provider: q.body.provider,
      model: q.body.model,
      n: q.body.n,
      aspect: q.body.aspect,
    });
    expect(r.status).toBe(202);
    expect(r.body.jobIds).toHaveLength(4);
    const g = await h.groups.settled(r.body.group as string);
    expect(g?.status).toBe('done');
    expect(g?.takes).toHaveLength(4);
    expect(h.submits()).toBe(4);
    expect(g?.best).toBe(g?.takes[0] as string);
    const shas = (g?.takes ?? []).map((t) => t.slice(7, 15));
    for (const sha of shas) {
      const doc = readGen(h.files.get(`assets/${sha}.gen.json`) as string, { self: sha });
      expect(doc).not.toBeNull();
      expect(doc?.group).toBe(r.body.group as string);
      expect(doc?.takes).toEqual(shas);
      expect(doc?.prompt).toBe(ASK.prompt);
      expect(doc?.by).toBe('Tereza');
    }
    // a used quote cannot start a second group
    const again = await h.call('POST', '/_api/generate-takes', {
      ...ASK,
      quote: q.body.quote,
      provider: 'stub',
      model: 'stub-solid',
      n: 4,
      aspect: '4:5',
    });
    expect(again.status).toBe(409);
    expect(h.submits()).toBe(4);

    // the group answers its canvas, and the placed picture knows its takes + its Made by AI line
    const status = await h.call(
      'GET',
      `/_api/generate-takes?group=${r.body.group}&canvas=${CANVAS}`
    );
    expect(status.body.best).toBe(g?.best as string);
    const of = await h.call('GET', `/_api/generate-takes/of?asset=${g?.takes[2]}&canvas=${CANVAS}`);
    expect(of.body.takes).toEqual(g?.takes as string[]);
    expect(of.body.label).toBe('Take 3 of 4');
    expect((of.body.madeByAi as { provider: string }).provider).toBe('stub');
  });

  test('a picture with no sidecar is just a picture', async () => {
    const h = harness();
    const of = await h.call(
      'GET',
      `/_api/generate-takes/of?asset=assets/0a1b2c3d.png&canvas=${CANVAS}`
    );
    expect(of.body).toEqual({ ok: true, takes: [], madeByAi: null });
  });
});

describe('Can edit only', () => {
  test('a viewer gets no quote; a canvas-only session on another canvas learns nothing', async () => {
    const viewer = harness({ access: access({ edit: false }) });
    expect((await viewer.call('POST', '/_api/generate-takes/quote', ASK)).status).toBe(403);
    expect((await viewer.call('POST', '/_api/generate-takes', { ...ASK, quote: 'x' })).status).toBe(
      403
    );
    const other = harness({ access: access({ canvasOnly: 'ui/other.tsx' }) });
    const r = await other.call('POST', '/_api/generate-takes/quote', ASK);
    expect(r.status).toBe(403);
    expect(r.body.reason).toBe('not-in-scope');
    expect(viewer.submits() + other.submits()).toBe(0);
  });
});

describe('← → swaps the takes in place', () => {
  test('the neighbour wraps round; the switch is one src rewrite (one write, one undo record)', async () => {
    const takes = [
      'assets/aaaaaaa1.png',
      'assets/bbbbbbb2.png',
      'assets/ccccccc3.png',
      'assets/ddddddd4.png',
    ];
    expect(neighbourTake(takes, takes[2] as string, 'next')?.label).toBe('Take 4 of 4');
    expect(neighbourTake(takes, takes[3] as string, 'next')?.asset).toBe(takes[0] as string);
    expect(neighbourTake(takes, takes[0] as string, 'prev')?.asset).toBe(takes[3] as string);
    expect(neighbourTake(takes, 'assets/eeeeeeee.png', 'next')).toBeNull();
    expect(neighbourTake(['assets/aaaaaaa1.png'], 'assets/aaaaaaa1.png', 'next')).toBeNull();

    const FILE = 'ui/Post.tsx';
    const SRC = `import { DCArtboard, DesignCanvas } from '@maude/canvas-lib';
export default function Post() {
  return (
    <DesignCanvas>
      <DCArtboard id="gw5" label="Post 4:5 · Gameweek 5" width={1080} height={1350}>
        <img data-cd-id="hero" src="assets/ccccccc3.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
      </DCArtboard>
    </DesignCanvas>
  );
}
`;
    const files = new Map([[FILE, SRC]]);
    let writes = 0;
    const deps: DispatchDeps = {
      resolve: (f) => (files.has(f) ? f : null),
      read: (rel) => files.get(rel) ?? null,
      write: async (rel, _b, after) => {
        writes += 1;
        files.set(rel, after);
      },
      heldByAi: () => null,
      log: createWriteLog(),
    };
    const next = neighbourTake(takes, 'assets/ccccccc3.png', 'next');
    const res = await dispatchEditOp(
      {
        file: FILE,
        op: 'image.replace',
        targets: [{ artboard: 'gw5', element: 'hero' }],
        params: { asset: next?.asset },
      },
      deps
    );
    expect(res.ok).toBe(true);
    expect(writes).toBe(1);
    const after = files.get(FILE) as string;
    expect(after).toBe(SRC.replace('assets/ccccccc3.png', 'assets/ddddddd4.png'));
  });
});

test('the stub draws a real PNG in the asked shape, a different one per take', () => {
  const png = solidPng(4, 5, [1, 2, 3]);
  expect([...png.slice(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
});
