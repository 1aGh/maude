// `describeChanges` — the CSS, meta and annotations lanes (V2-1.9 §5.5.1 steps 6–8, S1.10). Two layers:
//   1. frozen cases on the fixture canvas (`describe-corpus/canvas.tsx` + `canvas.css`), exact words;
//   2. the CSS declaration edit kind on the synthetic corpus (the real v2 canvases get a generated
//      stylesheet, one declaration edited at a time, ground truth from an independent source scan).
//
// Rules pinned here: viewport and `last_modified` never count as a change; a canvas-only session's words
// never name another canvas (the lanes read only this canvas's files and name only its own parts, so the
// words are scope-independent and the attribution cache needs no scope key); a CSS line reads like a TSX
// line ("Fill black → white", never "background: #000 → #fff").

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, serializeBoard } from '../annotations/schema';
import { type Change, describeChanges, type Lanes } from '../history/describe';
import { annotationsLane } from '../history/describe-annotations';
import { cssLane, parseCss } from '../history/describe-css';
import { metaLane } from '../history/describe-meta';
import { describeVersion } from '../history/describe-version';
import { listCanvases } from './fixtures/describe-corpus/measure';
import { measureCss } from './fixtures/describe-corpus/measure-css';

const dir = join(import.meta.dir, 'fixtures', 'describe-corpus');
const tsx = readFileSync(join(dir, 'canvas.tsx'), 'utf8');
const css = readFileSync(join(dir, 'canvas.css'), 'utf8');

const lines = (cs: Change[]) => cs.map((c) => [c.kind, c.grade, c.artboards, c.words]);

function cssEdit(pairs: Array<[string, string]>, from = css): string {
  let out = from;
  for (const [a, b] of pairs) {
    if (!out.includes(a)) throw new Error(`fixture edit does not apply: ${a.slice(0, 50)}`);
    out = out.replace(a, b);
  }
  return out;
}

function run(before: Partial<Lanes>, after: Partial<Lanes>, opts = {}, lane = cssLane()) {
  return describeChanges(
    'fixture.tsx',
    { tsx, ...before },
    { tsx, ...after },
    { lanes: [lane], ...opts }
  );
}

const cssRun = (after: string, opts = {}, laneOpts = {}) =>
  run({ css }, { css: after }, opts, cssLane(laneOpts));

describe('CSS lane — fixture cases', () => {
  test('identical, comment-only, whitespace-only and rule-order edits are no change', () => {
    expect(cssRun(css).changes).toEqual([]);
    expect(cssRun(cssEdit([['Same-name stylesheet', 'The stylesheet']])).changes).toEqual([]);
    expect(cssRun(css.replace(/\n/g, '\n\n').replace(/: /g, ':')).changes).toEqual([]);
    const swapped = cssEdit([
      ['.fx-list {\n  margin: 0;\n  list-style: none;\n}\n', ''],
      ['.kit-only {', '.fx-list {\n  margin: 0;\n  list-style: none;\n}\n\n.kit-only {'],
    ]);
    expect(cssRun(swapped).changes).toEqual([]);
  });

  test('a colour: the element, the artboard, the property in the same words as TSX', () => {
    const r = cssRun(cssEdit([['background: #000000;', 'background: #ffffff;']]));
    expect(lines(r.changes)).toEqual([['css', 'W1', ['home'], 'Frame: Fill black → white']]);
  });

  test('a number with its unit', () => {
    const r = cssRun(cssEdit([['gap: 16px;', 'gap: 24px;']]));
    expect(lines(r.changes)).toEqual([['css', 'W1', ['home'], 'Frame: Gap 16 → 24 px']]);
  });

  test('a declaration added reads "set to", one removed reads "removed (was …)"', () => {
    const added = cssRun(cssEdit([['width: 120px;', 'width: 120px;\n  height: 40px;']]));
    expect(lines(added.changes)).toEqual([
      ['css', 'W1', ['home', 'pricing'], 'Frame: Height set to 40 px'],
    ]);
    const removed = cssRun(cssEdit([['  gap: 16px;\n', '']]));
    expect(lines(removed.changes)).toEqual([
      ['css', 'W1', ['home'], 'Frame: Gap removed (was 16 px)'],
    ]);
  });

  test('a class on two artboards reaches both, a "sb-role--" prefix reaches the one that renders it', () => {
    const shared = cssRun(cssEdit([['width: 120px;', 'width: 150px;']]));
    expect(shared.changes).toHaveLength(1);
    expect((shared.changes[0] as Change).artboards.sort()).toEqual(['home', 'pricing']);
    const prefixed = cssRun(cssEdit([['font-size: 12px;', 'font-size: 14px;']]));
    expect(prefixed.changes).toHaveLength(1);
    expect((prefixed.changes[0] as Change).artboards).toEqual(['pricing']);
    expect((prefixed.changes[0] as Change).words).toContain('Font size 12 → 14 px');
  });

  test('a mapped family keeps its one entry', () => {
    const r = cssRun(cssEdit([['opacity: 1;', 'opacity: 0.5;']]));
    expect(r.changes).toHaveLength(1);
    expect((r.changes[0] as Change).artboards).toEqual(['disc-*']);
  });

  test('state and media context are said once, in the element name', () => {
    const hover = cssRun(cssEdit([['background: #d9b237;', 'background: #000000;']]));
    expect(hover.changes).toHaveLength(1);
    expect((hover.changes[0] as Change).words).toMatch(/^“Buy now” \(hover\): Fill .+ → black$/);
    expect((hover.changes[0] as Change).artboards).toEqual(['home']);
    const media = cssRun(cssEdit([['.fx-hero {\n    gap: 8px;', '.fx-hero {\n    gap: 4px;']]));
    expect(lines(media.changes)).toEqual([
      ['css', 'W1', ['home'], 'Frame (up to 600 px): Gap 8 → 4 px'],
    ]);
  });

  test('a rule added or removed is one line', () => {
    const added = cssRun(`${css}\n.fx-list li {\n  padding: 4px;\n}\n`);
    expect(lines(added.changes)).toEqual([['css', 'W1', ['home'], 'List: style added']]);
    const removed = cssRun(cssEdit([['.fx-list {\n  margin: 0;\n  list-style: none;\n}\n', '']]));
    expect(lines(removed.changes)).toEqual([['css', 'W1', ['home'], 'List: style removed']]);
  });

  test('a selector renamed with the same declarations says nothing', () => {
    expect(cssRun(cssEdit([['.fx-list {', '.fx-list-2 {']])).changes).toEqual([]);
  });

  test('a custom property is a shared value: the token display name, at canvas level', () => {
    const r = cssRun(cssEdit([['--bg-1: #111111;', '--bg-1: #ffffff;']]));
    expect(r.changes).toHaveLength(1);
    expect((r.changes[0] as Change).artboards).toEqual([]);
    expect((r.changes[0] as Change).words).toMatch(/^Bg 1: .+ → white$/);
    const named = cssRun(cssEdit([['--bg-1: #111111;', '--bg-1: #ffffff;']]), {
      tokenName: (n: string) => (n === '--bg-1' ? 'Surface' : undefined),
    });
    expect((named.changes[0] as Change).words).toMatch(/^Surface: .+ → white$/);
  });

  test('a rule naming no element of the canvas is the one canvas-level fallback; the kit hook drops it', () => {
    const edited = cssEdit([['color: red;', 'color: blue;']]);
    const r = cssRun(edited);
    expect(lines(r.changes)).toEqual([['css', 'F', [], 'Changed the style of Kit only']]);
    const dropped = cssRun(edited, {}, { rendersClass: () => false });
    expect(dropped.changes).toEqual([]);
    const kept = cssRun(edited, {}, { rendersClass: (t: string) => t === 'kit-only' });
    expect(kept.changes).toHaveLength(1);
  });

  test('keyframes and font faces are named once', () => {
    const k = cssRun(cssEdit([['rotate(360deg)', 'rotate(180deg)']]));
    expect(lines(k.changes)).toEqual([['css', 'W2', [], 'Animation “fx-spin” changed']]);
    const f = cssRun(
      `${css}\n@font-face {\n  font-family: "Inter";\n  src: url(inter.woff2);\n}\n`
    );
    expect(lines(f.changes)).toEqual([['css', 'W1', [], 'Font “Inter” added']]);
  });

  test('a stylesheet that appears or goes away is one line; unparseable CSS is the fallback', () => {
    expect(lines(run({ css: null }, { css }).changes)).toEqual([
      ['css', 'W1', [], 'Style sheet added'],
    ]);
    expect(lines(run({ css }, { css: undefined }).changes)).toEqual([
      ['css', 'W1', [], 'Style sheet removed'],
    ]);
    const broken = css.replace('.fx-disc {', '.fx-disc {{');
    expect(lines(run({ css }, { css: `${broken}\n.x {` }).changes)).toEqual([
      ['css', 'F', [], 'Changed the style of this canvas'],
    ]);
    expect(run({ css: null }, { css: null }).changes).toEqual([]);
  });

  test('the TSX lane and the CSS lane run on one version, TSX first', () => {
    const r = describeChanges(
      'fixture.tsx',
      { tsx, css },
      {
        tsx: tsx.replace('padding: 24', 'padding: 32'),
        css: cssEdit([['gap: 16px;', 'gap: 24px;']]),
      },
      { lanes: [cssLane()] }
    );
    expect(r.changes.map((c) => c.kind)).toEqual(['style', 'css']);
  });

  test('a CSS-only version parses the TSX once, an unchanged side never twice', () => {
    const r = cssRun(cssEdit([['gap: 16px;', 'gap: 24px;']]));
    expect(r.ms).toBeLessThan(200);
  });

  test('parseCss reads nesting, strings and url() without losing a rule', () => {
    const p = parseCss(
      '.a { color: red; &:hover { color: blue } }\n.b::after { content: "}{"; background: url(a;b.png) }\n@import "x.css";\n'
    );
    expect(p.ok).toBe(true);
    expect(p.rules.map((r) => r.selector)).toEqual(['.a', '.a:hover', '.b::after']);
    expect(p.rules[2]?.decls.get('content')).toBe('"}{"');
    expect(p.rules[2]?.decls.get('background')).toBe('url(a;b.png)');
    expect(parseCss('.a { color: red').ok).toBe(false);
    expect(parseCss('.a { color: red } }').ok).toBe(false);
  });
});

const META = (extra: Record<string, unknown> = {}, layout: unknown[] = []) =>
  JSON.stringify({
    layout: {
      artboards: layout.length
        ? layout
        : [
            { id: 'home', x: 0, y: 0 },
            { id: 'pricing', x: 500, y: 0, w: 390, h: 800 },
            { id: 'disc-a', x: 0, y: 900 },
            { id: 'disc-b', x: 300, y: 900 },
          ],
      viewport: { x: 0, y: 0, zoom: 1 },
    },
    last_modified: '2026-10-08T19:00:00Z',
    ...extra,
  });

const metaRun = (before: string | null, after: string | null) =>
  run({ meta: before }, { meta: after }, {}, metaLane);

describe('Meta lane — fixture cases', () => {
  test('viewport, last_modified and sub-pixel jitter never count', () => {
    const base = META();
    const next = JSON.stringify({
      ...JSON.parse(base),
      last_modified: '2027-01-01T00:00:00Z',
      viewport: { x: 5, y: 5, zoom: 2 },
    });
    expect(metaRun(base, next).changes).toEqual([]);
    const jitter = JSON.parse(base);
    jitter.layout.viewport = { x: 1, y: 1, zoom: 0.5 };
    jitter.layout.artboards[0].x = 0.0000001;
    expect(metaRun(base, JSON.stringify(jitter)).changes).toEqual([]);
    expect(metaRun(base, base).changes).toEqual([]);
    expect(metaRun(null, null).changes).toEqual([]);
  });

  test('an artboard moved or resized, by its label', () => {
    const moved = JSON.parse(META());
    moved.layout.artboards[0].x = 120;
    expect(lines(metaRun(META(), JSON.stringify(moved)).changes)).toEqual([
      ['artboard-moved', 'W1', ['home'], 'Homepage moved on the canvas'],
    ]);
    const sized = JSON.parse(META());
    sized.layout.artboards[1].w = 1080;
    expect(lines(metaRun(META(), JSON.stringify(sized)).changes)).toEqual([
      ['artboard-resized', 'W1', ['pricing'], 'Pricing: size 390 × 800 → 1080 × 800'],
    ]);
  });

  test('a family is one entry with a count; an id the canvas does not know is named from the id', () => {
    const moved = JSON.parse(META());
    moved.layout.artboards[2].x = 50;
    moved.layout.artboards[3].x = 350;
    expect(lines(metaRun(META(), JSON.stringify(moved)).changes)).toEqual([
      ['artboard-moved', 'W1', ['disc-*'], 'Disc: 2 artboards moved on the canvas'],
    ]);
    const one = JSON.parse(META());
    one.layout.artboards[2].x = 50;
    expect(lines(metaRun(META(), JSON.stringify(one)).changes)).toEqual([
      ['artboard-moved', 'W1', ['disc-*'], 'Disc moved on the canvas'],
    ]);
    const ghost = JSON.parse(META());
    ghost.layout.artboards.push({ id: 'old-board', x: 0, y: 0 });
    const ghostMoved = JSON.parse(JSON.stringify(ghost));
    ghostMoved.layout.artboards[4].x = 9;
    expect(metaRun(JSON.stringify(ghost), JSON.stringify(ghostMoved)).changes[0]?.words).toBe(
      'Old board moved on the canvas'
    );
  });

  test('present: order and skipped artboards', () => {
    const a = META({ present: { order: ['home', 'pricing'], skip: [] } });
    const order = META({ present: { order: ['pricing', 'home'], skip: [] } });
    expect(lines(metaRun(a, order).changes)).toEqual([['meta', 'W1', [], 'Present order changed']]);
    const skip = META({ present: { order: ['home', 'pricing'], skip: ['pricing'] } });
    expect(lines(metaRun(a, skip).changes)).toEqual([
      ['meta', 'W1', ['pricing'], 'Pricing left out of Present'],
    ]);
    expect(lines(metaRun(skip, a).changes)).toEqual([
      ['meta', 'W1', ['pricing'], 'Pricing back in Present'],
    ]);
  });

  test('artboardMeta: a note quoted, other keys by their words', () => {
    const a = META({ artboardMeta: { home: { notes: 'First pass' } } });
    const b = META({ artboardMeta: { home: { notes: 'Second pass' } } });
    expect(lines(metaRun(a, b).changes)).toEqual([
      ['meta', 'W1', ['home'], 'Homepage: Note “First pass” → “Second pass”'],
    ]);
    const c = META({ artboardMeta: { home: { notes: 'First pass', maxFrames: 40 } } });
    expect(lines(metaRun(a, c).changes)).toEqual([
      ['meta', 'W1', ['home'], 'Homepage: Frame limit set to 40'],
    ]);
  });

  test('the canvas title, links by count (no canvas is ever named), design system, the rest', () => {
    expect(
      lines(metaRun(META({ title: 'Pricing' }), META({ title: 'Pricing 2' })).changes)
    ).toEqual([['meta', 'W1', [], 'Canvas renamed to “Pricing 2”']]);
    const links = META({
      links: [
        { from: 'home', to: 'Other Canvas.tsx#cta' },
        { from: 'pricing', to: '#home' },
      ],
    });
    const r = metaRun(META(), links);
    expect(lines(r.changes)).toEqual([['meta', 'W1', [], '2 links added']]);
    expect(JSON.stringify(r.changes)).not.toContain('Other');
    expect(lines(metaRun(META({ dsRev: 1 }), META({ dsRev: 2 })).changes)).toEqual([
      ['meta', 'W1', [], 'Design system updated'],
    ]);
    expect(lines(metaRun(META({ mystery: 1 }), META({ mystery: 2 })).changes)).toEqual([
      ['meta', 'W2', [], 'Changed canvas settings'],
    ]);
  });

  test('a meta file that appears reads as its parts; unparseable JSON is the fallback', () => {
    expect(metaRun(null, META()).changes).toEqual([]);
    expect(lines(metaRun(META(), '{"layout": ').changes)).toEqual([
      ['meta', 'F', [], 'Changed canvas settings'],
    ]);
  });
});

const el = (o: Record<string, unknown>) => canonical({ index: 'a0', ...o });
const board = (...els: Array<Record<string, unknown>>) =>
  serializeBoard(els.map((e, i) => el({ index: `a${i}`, ...e })));
const sticky = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  type: 'sticky',
  x: 10,
  y: 10,
  w: 120,
  h: 120,
  text: 'Fix header',
  ...extra,
});

const annRun = (before: string | null, after: string | null) =>
  run({ annotations: before }, { annotations: after }, {}, annotationsLane);

describe('Annotations lane — fixture cases', () => {
  test('added, removed, text, moved, resized, resolved — in the spec words', () => {
    const empty = board();
    expect(lines(annRun(empty, board(sticky('s1'))).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky added'],
    ]);
    expect(lines(annRun(board(sticky('s1')), empty).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky removed'],
    ]);
    expect(
      lines(annRun(board(sticky('s1')), board(sticky('s1', { text: 'Fix the header' }))).changes)
    ).toEqual([['annotation', 'W1', [], 'Sticky: “Fix header” → “Fix the header”']]);
    expect(lines(annRun(board(sticky('s1')), board(sticky('s1', { x: 300 }))).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky moved'],
    ]);
    expect(lines(annRun(board(sticky('s1')), board(sticky('s1', { w: 200 }))).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky resized'],
    ]);
    const done = { resolved: { by: 'Tereza', at: '2026-10-18T09:00:00Z' } };
    expect(lines(annRun(board(sticky('s1')), board(sticky('s1', done))).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky resolved'],
    ]);
    expect(lines(annRun(board(sticky('s1', done)), board(sticky('s1'))).changes)).toEqual([
      ['annotation', 'W1', [], 'Sticky reopened'],
    ]);
  });

  test('several of one kind are counted with the real noun; z-order alone is nothing', () => {
    const three = board(sticky('s1'), sticky('s2'), sticky('s3'));
    expect(lines(annRun(board(), three).changes)).toEqual([
      ['annotation', 'W1', [], '3 stickies added'],
    ]);
    const a = board(sticky('s1'), sticky('s2'));
    const reordered = serializeBoard([
      el({ ...sticky('s1'), index: 'a1' }),
      el({ ...sticky('s2'), index: 'a0' }),
    ]);
    expect(annRun(a, reordered).changes).toEqual([]);
  });

  test('parented to an artboard it rides with; a family id maps to its family key', () => {
    const r = annRun(board(), board(sticky('s1', { parentArtboard: 'home' })));
    expect(lines(r.changes)).toEqual([['annotation', 'W1', ['home'], 'Sticky added']]);
    const f = annRun(board(), board(sticky('s1', { parentArtboard: 'disc-a' })));
    expect((f.changes[0] as Change).artboards).toEqual(['disc-*']);
  });

  test('an arrow moves by its ends; identical boards and a file that is not a board', () => {
    const arrow = (extra: Record<string, unknown> = {}) => ({
      id: 'a1',
      type: 'arrow',
      start: { x: 0, y: 0 },
      end: { x: 100, y: 100 },
      ...extra,
    });
    expect(
      lines(annRun(board(arrow()), board(arrow({ end: { x: 160, y: 100 } }))).changes)
    ).toEqual([['annotation', 'W1', [], 'Arrow moved']]);
    expect(annRun(board(sticky('s1')), board(sticky('s1'))).changes).toEqual([]);
    expect(annRun(null, null).changes).toEqual([]);
    expect(lines(annRun(board(sticky('s1')), 'not json at all').changes)).toEqual([
      ['annotation', 'F', [], 'Changed the whiteboard'],
    ]);
  });
});

describe('describeVersion — every lane, collapsed', () => {
  test('one version, four lanes, one list', () => {
    const r = describeVersion(
      'fixture.tsx',
      { tsx, css, meta: META(), annotations: board() },
      {
        tsx: tsx.replace('padding: 24', 'padding: 32'),
        css: cssEdit([['gap: 16px;', 'gap: 24px;']]),
        meta: META({ title: 'Home' }),
        annotations: board(sticky('s1')),
      }
    );
    expect(r.changes.map((c) => c.kind)).toEqual(['style', 'css', 'meta', 'annotation']);
  });

  test('a canvas-only session: nothing names another canvas', () => {
    const r = describeVersion(
      'fixture.tsx',
      { tsx, css, meta: META(), annotations: board() },
      {
        tsx,
        css,
        meta: META({
          links: [{ from: 'home', to: 'Secret Pricing.tsx#cta' }],
          present: { order: ['home'], skip: [] },
        }),
        annotations: board(
          sticky('s1', { source: { kind: 'comment', author: 'Tereza', canvas: 'Secret Pricing' } })
        ),
      }
    );
    expect(r.changes.length).toBeGreaterThan(0);
    expect(JSON.stringify(r.changes)).not.toContain('Secret');
  });

  test('CONTRACT voice on every line: curly quotes, no backticks, no we/I', () => {
    const all: Change[] = [];
    all.push(...cssRun(cssEdit([['background: #000000;', 'background: #ffffff;']])).changes);
    all.push(...cssRun(cssEdit([['color: red;', 'color: blue;']])).changes);
    all.push(...metaRun(META({ title: 'Pricing' }), META({ title: 'Pricing 2' })).changes);
    all.push(...annRun(board(), board(sticky('s1'), sticky('s2'))).changes);
    expect(all.length).toBeGreaterThan(3);
    for (const c of all) {
      expect(c.words).not.toMatch(/["`]/);
      expect(c.words).not.toMatch(/\b(we|we're|I)\b/i);
      expect(c.words).not.toMatch(/\.fx-|--bg|background:/);
    }
  });
});

describe('CSS lane — the declaration edit kind on the synthetic corpus', () => {
  const root = join(import.meta.dir, '..', '..', '..', '.design');
  const files = listCanvases(root, true);

  test('words right ≥ 95 %, wrong artboard 0, fallback ≤ 1 %', () => {
    expect(files.length).toBeGreaterThan(10);
    const r = measureCss(files, 8);
    const pct = (r.all.right / r.all.n) * 100;
    if (pct < 95 || r.all.wrongArtboard > 0) console.log(r.misses.slice(0, 20));
    expect(r.all.n).toBeGreaterThan(100);
    expect(pct).toBeGreaterThanOrEqual(95);
    expect(r.all.wrongArtboard).toBe(0);
    expect(r.all.fallback / r.all.n).toBeLessThanOrEqual(0.01);
  }, 120_000);
});
