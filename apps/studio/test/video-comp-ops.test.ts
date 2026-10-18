// S7.6c — the comp-vocabulary edit ops (V2-1.10 §5.3 + §5.7, S7-slices Q4/Q5): video.reframe,
// video.fit, video.music.duck, video.captions.add, video.place, video.format.add / .unlink,
// video.take.swap. Each is ONE write through /_api/edit-op (so one undo step: `revert {writeId}`
// restores the bytes), writes literal props the enumerator reads back, and is not a legacy
// /_api/clip-edit verb (decision maude/v2-S7.6b-new-ops-no-alias).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CLIP_EDIT_VERBS } from '../edit-ops/clip/index.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';
import { createEditRoutes } from '../routes/edit.ts';
import { captionFixesOf, compClips, duckedSrcOf } from '../video/derive.ts';

const FILE = 'ui/Reel.tsx';
const SRC = [
  "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
  "import { Audio, Sequence } from 'remotion';",
  "import { TransitionSeries } from '@remotion/transitions';",
  "import { Video } from '@remotion/media';",
  'const TOTAL = 270;',
  'const Comp = () => (',
  '  <>',
  '    <TransitionSeries>',
  '      <TransitionSeries.Sequence name="one" durationInFrames={90}><Video src="a.mp4" /></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="two" durationInFrames={120}><div data-mframe="2,0,0" style={{ overflow: \'hidden\' }}><div style={{ transform: \'scale(2)\' }}><Video src="b.mp4" trimBefore={30} /></div></div></TransitionSeries.Sequence>',
  '      <TransitionSeries.Sequence name="three" durationInFrames={60}><Video src="c.mp4" /></TransitionSeries.Sequence>',
  '    </TransitionSeries>',
  '    <Sequence name="title" from={240} durationInFrames={20}><div data-cd-id="t">Konec</div></Sequence>',
  '    <Sequence name="vo" from={0} durationInFrames={90}><Audio src="vo.mp3" /></Sequence>',
  '    <Audio src="bed.mp3" volume={0.8} />',
  '  </>',
  ');',
  'export default function Canvas() {',
  '  return (',
  '    <DesignCanvas>',
  '      <DCArtboard id="reel" label="Recap · Reels" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
  '    </DesignCanvas>',
  '  );',
  '}',
  '',
].join('\n');

const NEW_OPS = [
  'video.reframe',
  'video.fit',
  'video.music.duck',
  'video.captions.add',
  'video.place',
  'video.format.add',
  'video.format.unlink',
  'video.take.swap',
];

function run(source: string, op: string, params: Record<string, unknown>) {
  const o = EDIT_OPS.find((x) => x.id === op);
  if (!o) throw new Error(`no op ${op}`);
  return o.apply(source, { file: FILE, op, targets: [], params: { artboard: 'reel', ...params } });
}
const src = (source: string, op: string, params: Record<string, unknown>) =>
  run(source, op, params).source;

describe('the S7.6c ops are edit ops, artboard-scoped, not alias verbs', () => {
  test('registered, artboard-scoped, and absent from /_api/clip-edit', () => {
    for (const id of NEW_OPS) {
      const o = EDIT_OPS.find((x) => x.id === id);
      expect({ id, scope: o?.scope }).toEqual({ id, scope: 'artboard' });
    }
    const aliased = new Set(CLIP_EDIT_VERBS.values());
    for (const id of NEW_OPS) expect(aliased.has(id)).toBe(false);
  });
});

describe('video.reframe / video.fit', () => {
  test('keyframes wrap the media in <Reframe>, sorted; per format; Reset unwraps to the old bytes', () => {
    const a = src(SRC, 'video.reframe', {
      stableId: 'name:one',
      focus: [
        [1.5, 0.55, 0.4],
        [0, 0.5, 0.42],
      ],
    });
    expect(a).toContain(
      '<Reframe focus={[[0,0.5,0.42],[1.5,0.55,0.4]]}><Video src="a.mp4" /></Reframe>'
    );
    expect(a).toContain(
      "import { DCArtboard, DesignCanvas, VideoComp, Reframe } from '@maude/canvas-lib';"
    );
    // the enumerator still sees the clip and its media through the wrapper
    expect(compClips(FILE, a, 'reel').clips.find((c) => c.stableId === 'name:one')?.src).toBe(
      'a.mp4'
    );
    const b = src(a, 'video.reframe', {
      stableId: 'name:one',
      format: '16:9',
      focus: [[0, 0.5, 0.55]],
    });
    expect(b).toContain('formats={{"16:9":[[0,0.5,0.55]]}}');
    expect(b).toContain('focus={[[0,0.5,0.42],[1.5,0.55,0.4]]}'); // "All formats" untouched
    const c = src(b, 'video.reframe', { stableId: 'name:one', focus: null, formats: null });
    expect(c).not.toContain('<Reframe');
    expect(c.replace(', Reframe', '')).toBe(SRC);
  });

  test('a legacy data-mframe crop wrapper is replaced; points outside the picture refuse', () => {
    const a = src(SRC, 'video.reframe', { stableId: 'name:two', zoom: 2 });
    expect(a).toContain(
      '<TransitionSeries.Sequence name="two" durationInFrames={120}><Reframe zoom={2}><Video src="b.mp4" trimBefore={30} /></Reframe></TransitionSeries.Sequence>'
    );
    expect(a).not.toContain('data-mframe');
    expect(() =>
      run(SRC, 'video.reframe', { stableId: 'name:one', focus: [[0, 1.2, 0.5]] })
    ).toThrow(/outside the picture/);
    expect(() => run(SRC, 'video.reframe', { stableId: 'name:one', zoom: 0.5 })).toThrow(/Zoom/);
  });

  test('video.fit writes fit on the clip’s Reframe; fill (the default) unwraps', () => {
    const a = src(SRC, 'video.fit', { stableId: 'name:three', fit: 'blur' });
    expect(a).toContain('<Reframe fit="blur"><Video src="c.mp4" /></Reframe>');
    expect(
      src(a, 'video.fit', { stableId: 'name:three', fit: 'fill' }).replace(', Reframe', '')
    ).toBe(SRC);
    expect(() => run(SRC, 'video.fit', { stableId: 'name:three', fit: 'stretch' })).toThrow(
      /fill, fit or blur/
    );
    expect(() => run(SRC, 'video.fit', { stableId: 'name:three' })).toThrow(/fill, fit or blur/);
  });
});

describe('video.music.duck', () => {
  test('the loose bed is wrapped in <Duck>, read back as the ducked bed; values merge; off unwraps', () => {
    const bed = compClips(FILE, SRC, 'reel').clips.find((c) => c.src === 'bed.mp3');
    expect(bed?.loose).toBe(true);
    const a = src(SRC, 'video.music.duck', { stableId: bed?.stableId });
    expect(a).toContain(
      '<Duck db={-12} attackMs={200} releaseMs={400}><Audio src="bed.mp3" volume={0.8} /></Duck>'
    );
    expect(duckedSrcOf(a)).toBe('bed.mp3');
    const bed2 = compClips(FILE, a, 'reel').clips.find((c) => c.src === 'bed.mp3');
    const b = src(a, 'video.music.duck', { stableId: bed2?.stableId, db: -18 });
    expect(b).toContain('<Duck db={-18} attackMs={200} releaseMs={400}>');
    const c = src(b, 'video.music.duck', { stableId: bed2?.stableId, off: true });
    expect(c.replace(', Duck', '')).toBe(SRC);
  });

  test('a clip’s own audio ducks too; a picture clip refuses; out-of-range values refuse', () => {
    expect(src(SRC, 'video.music.duck', { stableId: 'name:vo' })).toContain(
      '<Duck db={-12} attackMs={200} releaseMs={400}><Audio src="vo.mp3" /></Duck>'
    );
    expect(() => run(SRC, 'video.music.duck', { stableId: 'name:one' })).toThrow(/music track/);
    expect(() => run(SRC, 'video.music.duck', { stableId: 'name:vo', db: 6 })).toThrow(
      /between -60 and 0/
    );
  });
});

describe('video.captions.add', () => {
  test('one <Captions> after the series; fixes are JSON the derivation reads back; restyle in place', () => {
    const fixes = [
      { src: 'a.mp4', at: 3.45, text: 'jsem "to" </Captions>' },
      { src: 'a.mp4', at: 9.1, text: null },
    ];
    const a = src(SRC, 'video.captions.add', { fixes });
    expect(a).toContain(
      `    </TransitionSeries>\n    <Captions data-cd-id="captions" words="line" position="bottom" fixes={${JSON.stringify(fixes)}} />`
    );
    expect(captionFixesOf(a)).toEqual(fixes);
    const b = src(a, 'video.captions.add', {
      words: 3,
      position: 'top',
      highlight: 'var(--accent)',
    });
    expect(b.match(/<Captions/g)?.length).toBe(1);
    expect(b).toContain('<Captions data-cd-id="captions" words={3} position="top"');
    expect(b).toContain('highlight="var(--accent)"');
    expect(captionFixesOf(b)).toEqual(fixes);
    // dropping the last prop and adding one in the same edit keeps the new one
    const c = src(b, 'video.captions.add', {
      fixes: null,
      highlight: null,
      font: 'var(--font-display)',
    });
    expect(c).toContain(
      '<Captions data-cd-id="captions" words={3} position="top" font="var(--font-display)" />'
    );
    expect(captionFixesOf(c)).toEqual([]);
    expect(() => run(SRC, 'video.captions.add', { font: '"><script>' })).toThrow(/not a value/);
    expect(() => run(SRC, 'video.captions.add', { words: 2 })).toThrow(/1, 3 or line/);
  });

  test('a comp whose root is the series gets a fragment; a second <Captions> refuses', () => {
    const bare = SRC.replace('  <>\n', '')
      .replace('  </>\n', '')
      .replace(/ {4}<Sequence[^\n]*\n/g, '')
      .replace('    <Audio src="bed.mp3" volume={0.8} />\n', '');
    const a = src(bare, 'video.captions.add', {});
    expect(a).toMatch(
      /<>\n\s*<TransitionSeries>[\s\S]*<\/TransitionSeries>\n\s*<Captions data-cd-id="captions"[^>]*\/>\n\s*<\/>/
    );
    const two = a.replace('<Captions ', '<Captions words="line" /><Captions ');
    expect(() => run(two, 'video.captions.add', {})).toThrow(/two caption tracks/);
  });
});

describe('video.place', () => {
  test('the title’s content sits in <Place>; a format gets its own; back to centre unwraps', () => {
    const a = src(SRC, 'video.place', { stableId: 'name:title', at: [0.5, 0.8] });
    expect(a).toContain(
      '<Sequence name="title" from={240} durationInFrames={20}><Place at={[0.5,0.8]}><div data-cd-id="t">Konec</div></Place></Sequence>'
    );
    const b = src(a, 'video.place', { stableId: 'name:title', format: '16:9', at: [0.2, 0.7] });
    expect(b).toContain('<Place at={[0.5,0.8]} formats={{"16:9":[0.2,0.7]}}>');
    const c = src(b, 'video.place', { stableId: 'name:title', format: '16:9', at: null });
    expect(c).toContain('<Place at={[0.5,0.8]}>');
    expect(src(c, 'video.place', { stableId: 'name:title', at: null }).replace(', Place', '')).toBe(
      SRC
    );
    expect(() => run(SRC, 'video.place', { stableId: 'name:title', at: [2, 0] })).toThrow(
      /outside the frame/
    );
  });
});

describe('video.format.add / video.format.unlink (linked = same comp, derived)', () => {
  test('add copies the artboard at the new size, same comp; the cut is shared; a repeat aspect refuses', () => {
    const r = run(SRC, 'video.format.add', { width: 1920, height: 1080 });
    expect(r.detail).toEqual({ artboard: 'reel-16x9', aspect: '16:9' });
    expect(r.source).toContain(
      '<DCArtboard id="reel-16x9" label="Recap · Reels · 16:9" kind="video" width={1920} height={1080}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1920} height={1080} /></DCArtboard>'
    );
    const ids = (s: string, ab: string) => compClips(FILE, s, ab).clips.map((c) => c.stableId);
    expect(ids(r.source, 'reel-16x9')).toEqual(ids(r.source, 'reel'));
    expect(() => run(r.source, 'video.format.add', { width: 1280, height: 720 })).toThrow(
      /already has a 16:9/
    );
    expect(() => run(SRC, 'video.format.add', { width: 1080, height: 1920 })).toThrow(
      /already has a 9:16/
    );
    expect(() => run(SRC, 'video.format.add', { width: 4, height: 4 })).toThrow(/16 to 8192/);
  });

  test('unlink forks the comp for this artboard only; an unlinked format refuses', () => {
    const linked = run(SRC, 'video.format.add', { width: 1080, height: 1080 }).source;
    const r = run(linked, 'video.format.unlink', { artboard: 'reel-1x1' });
    expect(r.detail).toEqual({ comp: 'CompUnlinked' });
    expect(r.source).toContain('const CompUnlinked = () => (');
    expect(r.source).toContain('<DCArtboard id="reel-1x1"');
    expect(r.source).toMatch(/id="reel-1x1"[^\n]*<VideoComp component=\{CompUnlinked\}/);
    expect(r.source).toMatch(/id="reel" [^\n]*<VideoComp component=\{Comp\}/);
    // the fork has the same clips, and an edit to it no longer reaches the original
    const ids = (s: string, ab: string) => compClips(FILE, s, ab).clips.map((c) => c.src);
    expect(ids(r.source, 'reel-1x1')).toEqual(ids(r.source, 'reel'));
    const cut = src(r.source, 'video.take.swap', {
      artboard: 'reel-1x1',
      stableId: 'name:one',
      srcStart: 2,
    });
    expect(compClips(FILE, cut, 'reel').clips[0]?.trimBefore).toBe(0);
    expect(compClips(FILE, cut, 'reel-1x1').clips[0]?.trimBefore).toBe(60);
    expect(() => run(r.source, 'video.format.unlink', { artboard: 'reel-1x1' })).toThrow(
      /its own cut/
    );
  });
});

describe('video.take.swap', () => {
  test('a new in-point at the same length: nothing ripples; a take past the source end refuses', () => {
    const before = compClips(FILE, SRC, 'reel');
    const a = src(SRC, 'video.take.swap', { stableId: 'name:two', srcStart: 4, sourceSeconds: 10 });
    const after = compClips(FILE, a, 'reel');
    expect(after.clips.find((c) => c.stableId === 'name:two')?.trimBefore).toBe(120);
    expect(after.clips.map((c) => [c.from, c.durationInFrames])).toEqual(
      before.clips.map((c) => [c.from, c.durationInFrames])
    );
    expect(after.total).toBe(before.total);
    expect(() =>
      run(SRC, 'video.take.swap', { stableId: 'name:two', srcStart: 7, sourceSeconds: 10 })
    ).toThrow(/shorter than the clip/);
  });
});

describe('one write, one undo step (the writeId record path)', () => {
  const dirs: string[] = [];
  afterAll(() => {
    for (const d of dirs) rmSync(d, { recursive: true, force: true });
  });

  test('each op answers a writeId; revert {writeId} restores the bytes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'maude-video-ops-'));
    dirs.push(root);
    const designRoot = join(root, '.design');
    mkdirSync(join(designRoot, 'ui'), { recursive: true });
    const abs = join(designRoot, 'ui', 'Reel.tsx');
    writeFileSync(abs, SRC);
    const editOp = createEditRoutes({
      designRoot,
      designRel: '.design',
      repoRoot: root,
      emit: () => {},
    }).find((s) => s.path === '/_api/edit-op') as {
      handle: (r: Request, c: never) => Promise<Response> | Response;
    };
    const post = async (body: unknown) =>
      (
        await editOp.handle(
          new Request('http://localhost/_api/edit-op', {
            method: 'POST',
            body: JSON.stringify(body),
          }),
          {} as never
        )
      ).json() as Promise<{ ok: boolean; writeId?: string; message?: string }>;
    const bed = compClips(FILE, SRC, 'reel').clips.find((c) => c.src === 'bed.mp3')?.stableId;
    const cases: Array<[string, Record<string, unknown>]> = [
      ['video.reframe', { stableId: 'name:one', focus: [[0, 0.4, 0.5]] }],
      ['video.fit', { stableId: 'name:one', fit: 'fit' }],
      ['video.music.duck', { stableId: bed }],
      ['video.captions.add', {}],
      ['video.place', { stableId: 'name:title', at: [0.5, 0.9] }],
      ['video.format.add', { width: 1920, height: 1080 }],
      ['video.take.swap', { stableId: 'name:three', srcStart: 1 }],
    ];
    for (const [op, params] of cases) {
      const r = await post({
        file: FILE,
        op,
        targets: [],
        params: { artboard: 'reel', ...params },
      });
      expect({ op, ok: r.ok, message: r.message }).toEqual({ op, ok: true, message: undefined });
      expect(readFileSync(abs, 'utf8')).not.toBe(SRC);
      const u = await post({
        file: FILE,
        op: 'revert',
        targets: [],
        params: { writeId: r.writeId },
      });
      expect({ op, undo: u.ok }).toEqual({ op, undo: true });
      expect(readFileSync(abs, 'utf8')).toBe(SRC);
    }
  });
});
