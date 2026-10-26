// P8 stage C round 2 (C5 canvas chrome, the rest): the kind glyph on every label, the 16 px warn dot, the safe-zone /
// print-guide colours, the AI rim + finish ring, the Present material, the link chip, the comment pins. Each pin is a
// fail-first test of the visible difference the critics listed (08 RC-3 / RC-5, 03 ai-hero, 04 R5, 10 co-comment).
import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ArtboardWarnMark } from '../artboard-warn-mark.tsx';
import { DS_GLYPHS } from '../canvas-ds-icons.tsx';
import { finishedArtboards } from '../client/v2/ai/runs-model.js';
import { createRunsStore } from '../client/v2/ai/runs-store.js';
import { pinInitial } from '../comments-overlay.tsx';
import { shellCss } from './_shell-css';

const src = (f: string) => readFileSync(join(import.meta.dir, '..', f), 'utf8');

describe('08 RC-3 · every artboard label wears the DS kind glyph', () => {
  test('the DS family has all four kinds, and canvas-lib draws them (digital too)', () => {
    for (const k of ['web', 'digital', 'video', 'print']) expect(DS_GLYPHS[k]).toBeDefined();
    const lib = src('canvas-lib.tsx');
    expect(lib).toContain('<DsIcon name={kind} size={12} />');
    // the old hand-drawn globe, and the "digital draws nothing" gate, are gone
    expect(lib).not.toContain('M2 8h12M8 2c2 2 2 10 0 12');
    expect(lib).not.toContain(
      'resolvedKind !== \'digital\' ? (\n              <span className="dc-artboard-kind-chip"'
    );
  });
  test('the label row reads the chrome tokens, never the project DS names', () => {
    const lib = src('canvas-lib.tsx');
    const row = lib.slice(
      lib.indexOf('.dc-canvas .dc-artboard-label {'),
      lib.indexOf('.dc-canvas .dc-artboard-body {')
    );
    expect(row).not.toMatch(/var\(--(bg|fg|accent|font)-/);
    expect(row).toContain('--maude-chrome-bg-2');
  });
});

describe('08 ak-warnings · the label mark is the 16 px warn dot', () => {
  test('a status-warn pill with the DS problem glyph in object-ink', () => {
    const html = renderToStaticMarkup(createElement(ArtboardWarnMark, { count: 2 }));
    expect(html).toContain('width:16px');
    expect(html).toContain('height:16px');
    expect(html).toContain('var(--maude-hud-warn');
    expect(html).toContain('var(--maude-hud-object-ink');
    expect(html).not.toContain('oklch(62% 0.17 65)');
  });
});

describe('08 RC-5 · overlay colours come from the HUD tokens', () => {
  test('safe zones: accent bands, warn flag, no hard-coded red / yellow', () => {
    const s = src('safe-zones-overlay.tsx');
    expect(s).not.toContain('oklch(60% 0.2 25)');
    expect(s).not.toContain('oklch(82% 0.15 85)');
    expect(s).toContain('--maude-hud-accent');
    expect(s).toContain('--maude-hud-warn');
    // type-xs on screen at any zoom
    expect(s).toContain('calc(11px / var(--dc-zoom, 1))');
  });
  test('print guides: bleed coral, trim ink, margin lilac', () => {
    const s = src('print-overlay-content.tsx');
    expect(s).toContain('--maude-hud-object-coral');
    expect(s).toContain('--maude-hud-object-ink');
    expect(s).toContain('--maude-hud-object-lilac');
    expect(s).not.toContain('oklch(58% 0.24 340)');
  });
});

describe('03 ai-hero · the rim is the spark, and a run that ends well settles a ring', () => {
  const run = (state: string, outcome?: string) => ({
    runId: 'r_1aaaaaa',
    state,
    outcome,
    leases: [{ artboard: 'post', canvas: 'c' }],
  });
  test('finishedArtboards: live to ended/done names the leased artboards; stopped or vanished names none', () => {
    const live = { mine: [run('running')] };
    expect(finishedArtboards(live, { mine: [run('ended', 'done')] })).toEqual(['post']);
    expect(finishedArtboards(live, { mine: [run('ended', 'stopped')] })).toEqual([]);
    expect(finishedArtboards(live, { mine: [] })).toEqual([]);
    expect(
      finishedArtboards({ mine: [run('ended', 'done')] }, { mine: [run('ended', 'done')] })
    ).toEqual([]);
  });
  test('the store calls markDone when a read shows the run ended well (markDone had no caller)', async () => {
    const replies = [
      { seq: 1, mine: [run('running')], others: [] },
      { seq: 2, mine: [{ ...run('ended', 'done'), leases: [] }], others: [] },
    ];
    let i = 0;
    const fetchImpl = (async () =>
      new Response(JSON.stringify(replies[Math.min(i++, 1)]), {
        status: 200,
      })) as unknown as typeof fetch;
    const store = createRunsStore({
      fetchImpl,
      target: new EventTarget() as unknown as Window,
      setTimer: () => 0,
    });
    await store.refresh();
    expect(store.getSnapshot().done).toEqual({});
    await store.refresh();
    expect(store.getSnapshot().done).toEqual({ post: true });
  });
  test('the rings sheet reads HUD tokens (no own palette, no dark override) and wears Before / After', () => {
    const s = src('artboard-activity-overlay.tsx');
    expect(s).toContain('var(--maude-hud-spark');
    expect(s).not.toContain('data-maude-theme="dark"');
    expect(s).toContain('data-side="before"');
    expect(s).toContain('data-side="after"');
  });
  test('the file-activity rim is a dashed spark, not the v1 blue', () => {
    const s = src('inspect.ts');
    expect(s).not.toContain('hsl(210 90% 58%)');
    expect(s).toContain('1.5px dashed var(--mdcc-activity');
  });
});

describe('04 R5 · Present is the island material on an ink mask', () => {
  test('the stage mask is --object-ink, not the shell bg', () => {
    expect(src('present/present-stage.tsx')).toContain('var(--maude-hud-object-ink');
  });
  test('the controls card and the canvas pill are radius-lg island, the esc key a body-face kbd', () => {
    const present = src('client/v2/present/present.css');
    const controls = present.slice(
      present.indexOf('.maude .pr-controls {'),
      present.indexOf('.maude .pr-controls[data-shown="false"]')
    );
    expect(controls).toContain('var(--island-bg)');
    expect(controls).toContain('border-radius: var(--radius-lg)');
    const shell = shellCss();
    const exit = shell.slice(
      shell.indexOf('.pv-present-exit {'),
      shell.indexOf('.pv-present-exit:hover,')
    );
    expect(exit).toContain('var(--island-bg)');
    expect(exit).toContain('var(--radius-lg)');
    const at = shell.indexOf('.pv-present-exit-kbd {');
    const kbd = shell.slice(at, shell.indexOf('}', at));
    expect(kbd).toContain('var(--font-body)');
    expect(kbd).not.toContain('--font-mono');
  });
});

describe('04 / 10 · link chip and comment pins', () => {
  test('the link chip is a 26 px accent pill with the link glyph and a dashed run to it', () => {
    const s = src('link-chip-overlay.tsx');
    expect(s).toContain('height: 26px');
    expect(s).toContain('border-radius: 999px');
    expect(s).toContain('<DsIcon name="link" size={13} />');
    expect(s).toContain('ed-linkline');
  });
  test('a comment pin is 28 px, wears the author tone and their initial', () => {
    const css = src('client/comments-overlay.css');
    const pin = css.slice(css.indexOf('.cm-pin {'), css.indexOf('.cm-pin:hover'));
    expect(pin).toContain('width: 28px');
    expect(pin).toContain('--cm-pin-tone');
    expect(pin).toContain('999px 999px 999px 2px');
    expect(pinInitial('Tereza')).toBe('T');
    expect(pinInitial('  jan')).toBe('J');
    expect(pinInitial('unknown')).toBe('?');
    expect(pinInitial('')).toBe('?');
  });
});

describe('14 R3 · the object name tag hangs under the object, size regular after the name', () => {
  test('selection tag css and placement', () => {
    const s = src('editing/selection.tsx');
    expect(s).toContain('height: 20px');
    expect(s).toContain('r.bottom + 6');
    expect(s).toContain('ed-tag-q');
    expect(s).not.toContain('translateY(calc(-100% - 4px))');
  });
});

describe('08 RC-7 · a kind-dimmed artboard is the whole artboard at .45', () => {
  test('dimCss targets the article (name included) at the board opacity', async () => {
    const { dimCss, DIM_OPACITY } = await import('../editing/kind-dim.tsx');
    expect(DIM_OPACITY).toBe(0.45);
    const css = dimCss(['a']);
    expect(css).toContain('[data-dc-screen="a"] {');
    expect(css).not.toContain('dc-artboard-body');
  });
});

describe('15 an-tx · the annotation layer speaks the rounded face', () => {
  test('TEXT_FONT is the HUD rounded face, not mono', async () => {
    const { TEXT_FONT } = await import('../annotations/ui/text-style.ts');
    expect(TEXT_FONT).toContain('--maude-hud-font-rounded');
    expect(TEXT_FONT).not.toContain('mono');
  });
});
