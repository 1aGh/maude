// S7.6 — every clip verb is an edit op (`clip.<verb>`, edit-ops/clip/), and `/_api/clip-edit` is an
// ALIAS of the dispatcher (S7-slices Q2): the old body shape writes the same bytes as the pure
// applier, an AI cut on the same artboard refuses with 409 `held-by-ai`, a locked video refuses with
// `locked`, and the alias sits in the one table (main origin, read-only refused, no canvas origin).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { applySetPlaybackRate, applySplitClip, applyTrimIn } from '../clip-ops.ts';
import { CLIP_EDIT_VERBS, CLIP_OPS } from '../edit-ops/clip/index.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { CANVAS_SAFE_API } from '../http.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { allSpecs } from '../routes/index.ts';
import { mountRoutes } from '../routes/table.ts';
import { stubDeps } from './_route-stubs.ts';

const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 270;',
  'const Comp = () => (',
  '  <TransitionSeries>',
  '    <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="two" durationInFrames={120}><Video src="b.mp4" trimBefore={30} /></TransitionSeries.Sequence>',
  '    <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '  </TransitionSeries>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
  '      <DCArtboard id="still" width={400} height={300}><div data-cd-id="hi">hi</div></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');
const FILE = 'ui/Reel.tsx';

const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

function sandbox(source = SRC) {
  const root = mkdtempSync(join(tmpdir(), 'maude-clip-op-'));
  dirs.push(root);
  const designRoot = join(root, '.design');
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  writeFileSync(join(designRoot, 'ui', 'Reel.tsx'), source);
  return { root, designRoot, read: () => readFileSync(join(designRoot, 'ui', 'Reel.tsx'), 'utf8') };
}

type Lease = { canvas: string; artboard: string };
function routes(designRoot: string, root: string, leases: Lease[] = [], state = 'running') {
  // `holderOf` is the one lease lookup the dispatcher uses (v2-lead-artboard-hold-one-check): a run holds
  // what it leased once it is running; a waiting run holds nothing yet.
  const runs = {
    canvasKey: (rel: string) => `path:.design/${rel}`,
    live: () => [{ runId: 'r1', state, objects: [], scope: null, leases }],
    holderOf: (k: { canvas: string; artboard: string }) =>
      state !== 'waiting' && leases.some((l) => l.canvas === k.canvas && l.artboard === k.artboard)
        ? { runId: 'r1' }
        : null,
    view: () => ({ others: [] }),
  } as never;
  const specs = createEditRoutes({
    designRoot,
    designRel: '.design',
    repoRoot: root,
    emit: () => {},
    runs,
  });
  const by = (p: string) => specs.find((s) => s.path === p) as (typeof specs)[number];
  return { editOp: by('/_api/edit-op'), alias: by('/_api/clip-edit') };
}
const post = (path: string, body: unknown) =>
  new Request(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

describe('clip ops in the op table', () => {
  test('every legacy /_api/clip-edit verb has a clip.<verb> op, artboard-scoped, in EDIT_OPS', () => {
    expect([...CLIP_EDIT_VERBS.keys()]).toEqual([
      'speed',
      'trim-in',
      'audio',
      'detach-audio',
      'framing',
      'grade',
      'transition',
      'split',
      'insert-transition',
      'remove-transition',
      'set-text',
      'to-overlay',
      'to-storyline',
      'layer-order',
      'resolve-placeholder',
    ]);
    for (const op of CLIP_OPS) {
      expect(op.scope).toBe('artboard');
      expect(EDIT_OPS).toContain(op);
    }
    const ids = EDIT_OPS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('/_api/clip-edit is an alias of the dispatcher', () => {
  test('old body shape → the same bytes as the pure applier and as clip.<verb> through /_api/edit-op', async () => {
    const cases: Array<[Record<string, unknown>, (s: string) => string]> = [
      [
        { verb: 'split', atFrame: 150 },
        (s) => applySplitClip(FILE, s, 'reel', 'name:two', undefined, 150).source,
      ],
      [
        { verb: 'trim-in', deltaFrames: 10 },
        (s) => applyTrimIn(FILE, s, 'reel', 'name:two', undefined, 10).source,
      ],
      [
        { verb: 'speed', rate: 2 },
        (s) => applySetPlaybackRate(FILE, s, 'reel', 'name:two', undefined, 2).source,
      ],
    ];
    for (const [verbBody, pure] of cases) {
      const a = sandbox();
      const { alias } = routes(a.designRoot, a.root);
      const r = await alias.handle(
        post('/_api/clip-edit', {
          canvas: '.design/ui/Reel.tsx',
          artboardId: 'reel',
          stableId: 'name:two',
          ...verbBody,
        }),
        {}
      );
      expect(r.status).toBe(200);
      const j = (await r.json()) as Record<string, unknown>;
      expect(j.ok).toBe(true);
      expect(typeof j.writeId).toBe('string');
      expect(j.seq).toBeUndefined(); // no timeline-local revert any more
      const want = pure(SRC);
      expect(a.read()).toBe(want);

      const b = sandbox();
      const { editOp } = routes(b.designRoot, b.root);
      const { verb, ...params } = verbBody;
      const r2 = await editOp.handle(
        post('/_api/edit-op', {
          file: FILE,
          op: `clip.${verb}`,
          targets: [],
          params: { artboard: 'reel', stableId: 'name:two', ...params },
        }),
        {}
      );
      expect(r2.status).toBe(200);
      expect(b.read()).toBe(want);
    }
  });

  test('the applier’s facts come back: a split names its second half', async () => {
    const a = sandbox();
    const { alias } = routes(a.designRoot, a.root);
    const j = (await (
      await alias.handle(
        post('/_api/clip-edit', {
          canvas: FILE,
          artboardId: 'reel',
          stableId: 'name:two',
          verb: 'split',
          atFrame: 150,
        }),
        {}
      )
    ).json()) as Record<string, unknown>;
    expect(j.secondStableId).toBe('name:two-150');
  });

  test('an unknown verb is 400 and writes nothing; a bad clip is the applier’s refusal', async () => {
    const a = sandbox();
    const { alias } = routes(a.designRoot, a.root);
    const r = await alias.handle(
      post('/_api/clip-edit', { canvas: FILE, stableId: 'name:two', verb: 'explode' }),
      {}
    );
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: string }).error).toBe('unknown clip verb "explode"');
    const r2 = await alias.handle(
      post('/_api/clip-edit', {
        canvas: FILE,
        artboardId: 'reel',
        stableId: 'name:nope',
        verb: 'split',
        atFrame: 10,
      }),
      {}
    );
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { ok: boolean; code: string }).code).toBe('invalid');
    expect(a.read()).toBe(SRC);
  });
});

describe('refusals before the writer (S2 order, artboard-scoped)', () => {
  const split = {
    file: FILE,
    op: 'clip.split',
    targets: [],
    params: { artboard: 'reel', stableId: 'name:two', atFrame: 150 },
  };

  test('a split during an AI cut on the same artboard → 409 held-by-ai, file untouched', async () => {
    const a = sandbox();
    const { editOp, alias } = routes(a.designRoot, a.root, [
      { canvas: 'path:.design/ui/Reel.tsx', artboard: 'reel' },
    ]);
    const r = await editOp.handle(post('/_api/edit-op', split), {});
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({
      ok: false,
      code: 'held-by-ai',
      message: "reel is AI's until it's done · Stop in the AI chat",
    });
    const r2 = await alias.handle(
      post('/_api/clip-edit', {
        canvas: FILE,
        artboardId: 'reel',
        stableId: 'name:two',
        verb: 'split',
        atFrame: 150,
      }),
      {}
    );
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { code: string }).code).toBe('held-by-ai');
    expect(a.read()).toBe(SRC);
  });

  test('an AI run on another artboard, or a waiting one, holds nothing here', async () => {
    const a = sandbox();
    const other = routes(a.designRoot, a.root, [
      { canvas: 'path:.design/ui/Reel.tsx', artboard: 'still' },
    ]);
    expect((await other.editOp.handle(post('/_api/edit-op', split), {})).status).toBe(200);
    const b = sandbox();
    const waiting = routes(
      b.designRoot,
      b.root,
      [{ canvas: 'path:.design/ui/Reel.tsx', artboard: 'reel' }],
      'waiting'
    );
    expect((await waiting.editOp.handle(post('/_api/edit-op', split), {})).status).toBe(200);
  });

  test('no artboard named: any AI lease on the canvas refuses', async () => {
    const a = sandbox();
    const { editOp } = routes(a.designRoot, a.root, [
      { canvas: 'path:.design/ui/Reel.tsx', artboard: 'still' },
    ]);
    const { artboard: _a, ...params } = split.params;
    const r = await editOp.handle(post('/_api/edit-op', { ...split, params }), {});
    expect(r.status).toBe(409);
  });

  test('an artboard that is not on the canvas → 400; a locked video → 409 locked', async () => {
    const a = sandbox();
    const { editOp } = routes(a.designRoot, a.root);
    const r = await editOp.handle(
      post('/_api/edit-op', { ...split, params: { ...split.params, artboard: 'gone' } }),
      {}
    );
    expect(r.status).toBe(400);
    const b = sandbox(SRC.replace('<DCArtboard id="reel"', '<DCArtboard id="reel" data-cd-locked'));
    const lockedRoutes = routes(b.designRoot, b.root);
    const r2 = await lockedRoutes.editOp.handle(post('/_api/edit-op', split), {});
    expect(r2.status).toBe(409);
    expect(((await r2.json()) as { code: string }).code).toBe('locked');
  });
});

describe('the alias in the one table', () => {
  test('POST, main origin only, read-only refused; in neither canvas allowlist', () => {
    const specs = allSpecs(stubDeps()).filter((s) => s.path === '/_api/clip-edit');
    expect(specs.map((s) => [s.method, s.origin, s.readOnly])).toEqual([
      ['POST', 'main', 'refused'],
    ]);
    const mounted = mountRoutes(allSpecs(stubDeps()));
    expect(mounted.canvasPaths).not.toContain('/_api/clip-edit');
    expect(CANVAS_SAFE_API.has('/_api/clip-edit')).toBe(false);
  });
});
