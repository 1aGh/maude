// S7.11b — `video.title.style` (07 ve-text "Font" and "Colour"): a title's own font and colour, written into the
// `style` literal of the element that holds its words. The Title inspector's two rows write it; an agent writes the
// same literal props itself (registry agent path `canvas-tsx`).
//
//   - the op: font = a DS `--font-*` token as `var(--font-…)`, colour = a token or a plain CSS colour; null takes
//     one off again; same value = no write; anything else is refused with words, not a broken file;
//   - the read: `enumerateClips` gives the inspector what the file says (`titleStyle`);
//   - the rows: Font and Colour sit between Text and Motion, in the 07 canvas's words, and each writes ONE op.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { enumerateClips } from '../canvas-edit.ts';
import { EDIT_OPS } from '../edit-ops/dispatch.ts';

const FILE = 'ui/Reel.tsx';
const comp = (title: string) =>
  [
    "import { DCArtboard, DesignCanvas, VideoComp } from '@maude/canvas-lib';",
    "import { Sequence } from 'remotion';",
    'const TOTAL = 240;',
    'const Comp = () => (',
    '  <>',
    `    ${title}`,
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel" label="Recap" kind="video" width={1080} height={1920}><VideoComp component={Comp} durationInFrames={TOTAL} fps={30} width={1080} height={1920} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
    '',
  ].join('\n');

const WITH_STYLE = comp(
  '<Sequence name="title" from={20} durationInFrames={66}><div data-cd-id="t" style={{ color: "white", fontSize: 64 }}>{"PROČ ALLIGATORS"}</div></Sequence>'
);
const NO_STYLE = comp(
  '<Sequence name="title" from={20} durationInFrames={66}><div data-cd-id="t">{"PROČ ALLIGATORS"}</div></Sequence>'
);

function run(source: string, params: Record<string, unknown>) {
  const o = EDIT_OPS.find((x) => x.id === 'video.title.style');
  if (!o) throw new Error('no op video.title.style');
  return o.apply(source, {
    file: FILE,
    op: 'video.title.style',
    targets: [],
    params: { artboard: 'reel', stableId: 'name:title', ...params },
  });
}
const style = (source: string, params: Record<string, unknown>) => run(source, params).source;
const styleOf = (source: string) =>
  enumerateClips(FILE, source, 'reel').clips.find((c) => c.stableId === 'name:title')?.titleStyle;

describe('video.title.style — the op', () => {
  test('is registered, held to the artboard like every clip op', () => {
    const o = EDIT_OPS.find((x) => x.id === 'video.title.style');
    expect(o?.scope).toBe('artboard');
  });

  test('Font adds fontFamily to the style the words already have, and keeps the rest', () => {
    const out = style(WITH_STYLE, { font: 'var(--font-display)' });
    expect(out).toContain('fontFamily: "var(--font-display)"');
    expect(out).toContain('color: "white"');
    expect(out).toContain('fontSize: 64');
    expect(styleOf(out)).toEqual({ font: 'var(--font-display)', color: 'white' });
  });

  test('Colour rewrites the colour that is there', () => {
    const out = style(WITH_STYLE, { color: 'var(--accent)' });
    expect(out).toContain('color: "var(--accent)"');
    expect(out).not.toContain('"white"');
    expect(styleOf(out)).toEqual({ font: null, color: 'var(--accent)' });
  });

  test('both at once is one write; a title with no style gets one', () => {
    const out = style(NO_STYLE, { font: 'var(--font-display)', color: '#2fbf71' });
    expect(out).toContain('style={{ fontFamily: "var(--font-display)", color: "#2fbf71" }}');
    expect(styleOf(out)).toEqual({ font: 'var(--font-display)', color: '#2fbf71' });
  });

  test('null takes one off; the last one off takes the empty style off too', () => {
    const both = style(NO_STYLE, { font: 'var(--font-display)', color: '#fff' });
    const noFont = style(both, { font: null });
    expect(noFont).not.toContain('fontFamily');
    expect(styleOf(noFont)).toEqual({ font: null, color: '#fff' });
    const none = style(noFont, { color: null });
    expect(none).not.toContain('style=');
    expect(none).toBe(NO_STYLE);
  });

  test('the same value writes nothing', () => {
    const out = style(WITH_STYLE, { color: 'white' });
    expect(out).toBe(WITH_STYLE);
    expect(style(NO_STYLE, { font: null })).toBe(NO_STYLE);
  });

  test('a title wrapped in a Place and a TitleMotion is styled at its words, not at the wrapper', () => {
    const wrapped = comp(
      '<Sequence name="title" from={20} durationInFrames={66}><Place at={[0.5, 0.2]}><TitleMotion preset="fade"><div>{"PROČ"}</div></TitleMotion></Place></Sequence>'
    );
    const out = style(wrapped, { color: '#fff' });
    expect(out).toContain('<div style={{ color: "#fff" }}>{"PROČ"}</div>');
    expect(out).toContain('<Place at={[0.5, 0.2]}>');
    expect(out).toContain('<TitleMotion preset="fade">');
  });

  test('a Font is a DS font token and nothing else', () => {
    for (const font of [
      'Comic Sans',
      'var(--color-ink)',
      'var(--font-x); background: red',
      'var(--font-)',
      'url(x)',
      '"Inter", sans-serif',
      7,
    ])
      expect(() => style(WITH_STYLE, { font })).toThrow('font');
  });

  test('a Colour is a token or a plain CSS colour, never an expression', () => {
    for (const ok of [
      'var(--accent)',
      '#fff',
      '#2fbf71cc',
      'rgb(10, 20, 30)',
      'oklch(0.7 0.1 150)',
    ])
      expect(() => style(WITH_STYLE, { color: ok })).not.toThrow();
    for (const color of [
      'red; background: url(//evil)',
      'url(x)',
      'expression(alert(1))',
      'var(--accent) !important',
      'calc(1px)',
      '',
      5,
    ])
      expect(() => style(WITH_STYLE, { color })).toThrow('colour');
  });

  test('asking for nothing is refused', () => {
    expect(() => style(WITH_STYLE, {})).toThrow('font or a colour');
  });

  test('a style written in code is not rewritten', () => {
    const coded = comp(
      '<Sequence name="title" from={20} durationInFrames={66}><div style={titleStyle}>{"PROČ"}</div></Sequence>'
    );
    expect(() => style(coded, { color: '#fff' })).toThrow('style');
  });

  test('a clip with no words (a picture, an AI slate) has nothing to style', () => {
    const pic = comp(
      '<Sequence name="title" from={20} durationInFrames={66}><OffthreadVideo src="assets/aaaaaaaa.mp4" /></Sequence>'
    );
    expect(() => style(pic, { color: '#fff' })).toThrow('no text');
    const slate = comp(
      '<Sequence name="title" from={20} durationInFrames={66}><AIPlaceholder prompt={"a drone shot"} kind="video" /></Sequence>'
    );
    expect(() => style(slate, { color: '#fff' })).toThrow('no text');
  });

  test('an unknown clip and a missing id are refused with the clip ops’ words', () => {
    expect(() => style(WITH_STYLE, { stableId: 'name:nope', color: '#fff' })).toThrow(
      'not on the timeline'
    );
    expect(() => style(WITH_STYLE, { stableId: undefined, color: '#fff' })).toThrow(
      'names no clip'
    );
  });
});

// ── the rows ─────────────────────────────────────────────────────────────────────────────────────────────
const realFetch = globalThis.fetch;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    if (String(url).endsWith('.css'))
      return new Response(
        ':root{--bg-1:#fff;--font-display:"Club Display";--font-body:Inter;--accent:#2fbf71;--ink:#111}',
        { status: 200 }
      );
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});
let restoreSlots: (() => void) | null = null;
const seated: Array<() => void> = [];
afterAll(() => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
const calls: unknown[][] = [];
const TITLE_SEQ = (titleStyle: unknown) => ({
  from: 20,
  duration: 66,
  label: 'Title',
  series: false,
  mediaTag: null,
  mediaSrc: null,
  mediaProps: null,
  placeholder: null,
  text: 'PROČ ALLIGATORS',
  titleMotion: null,
  titleStyle,
  fit: null,
  rowKind: 'jsx',
});
const selection = (titleStyle: unknown) => ({
  kind: 'title' as const,
  canvas: '.design/ui/Reel.tsx',
  artboardId: 'reel',
  fps: 30,
  stableId: 'name:title',
  label: 'PROČ ALLIGATORS',
  seq: TITLE_SEQ(titleStyle),
  transitionAfter: null,
  onVerb: (...a: unknown[]) => calls.push(['verb', ...a]),
  onOp: (...a: unknown[]) => calls.push(['op', ...a]),
  onJoin: () => {},
  onRemoveJoin: () => {},
  deselect: () => {},
});

async function frame(sel: ReturnType<typeof selection>) {
  if (!seated.length) {
    const clip = await import('../client/v2/inspector/kinds/clip.jsx');
    const { stashSlots } = await import('../client/v2/inspector/slots.js');
    restoreSlots = stashSlots();
    seated.push(clip.registerClipSlots());
  }
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
  calls.length = 0;
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () =>
    root.render(
      h(InspectorFrame, {
        selected: timelineSelectionElement(sel as never),
        layersTree: null,
        cfg: {
          designRel: '.design',
          defaultDesignSystem: 'club',
          designSystems: [{ name: 'club', tokensCssRel: 'system/club/tokens.css' }],
        },
        canvasFile: '.design/ui/Reel.tsx',
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
      } as never)
    )
  );
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const rowsOf = (host: HTMLElement, section: string) =>
  [...(q(host, `insp-sec-${section}`)?.querySelectorAll('[data-testid^="insp-row-"]') ?? [])].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );

describe('the Title inspector’s Font and Colour rows', () => {
  test('Text · Font · Colour · Motion · Length, in the canvas’s words', async () => {
    const host = await frame(selection({ font: null, color: null }));
    expect(rowsOf(host, 'title-motion')).toEqual([
      'clip-text = Text',
      'title-font = Font',
      'title-colour = Colour',
      'title-motion = Motion',
      'clip-length = Length',
    ]);
  });

  test('Font lists the design system’s font tokens and writes var(--font-…) as one video.title.style', async () => {
    const host = await frame(selection({ font: null, color: null }));
    const sel = q(host, 'insp-title-font') as HTMLSelectElement;
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Default', 'Display', 'Body']);
    await act(async () => {
      sel.value = 'var(--font-display)';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();
    expect(calls).toEqual([['op', 'title.style', { font: 'var(--font-display)' }]]);
  });

  test('Default takes the font off (null); a font the file has but the system lacks stays listed', async () => {
    const host = await frame(selection({ font: 'var(--font-display)', color: null }));
    const sel = q(host, 'insp-title-font') as HTMLSelectElement;
    expect(sel.value).toBe('var(--font-display)');
    await act(async () => {
      sel.value = '';
      sel.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    await settle();
    expect(calls).toEqual([['op', 'title.style', { font: null }]]);
    const other = await frame(selection({ font: 'var(--font-old)', color: null }));
    expect(
      [...(q(other, 'insp-title-font') as HTMLSelectElement).options].map((o) => o.value)
    ).toContain('var(--font-old)');
  });

  test('Colour shows the colour the file has and offers the system’s tokens; a pick is one op', async () => {
    const host = await frame(selection({ font: null, color: 'var(--accent)' }));
    expect(q(host, 'insp-chip-title-colour')?.textContent).toContain('Accent');
    await act(async () => {
      host
        .querySelector<HTMLElement>('[data-testid="insp-ctl-title-colour"] button')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();
    const ink = q(host, 'insp-color-title-colour-ink');
    expect(ink).not.toBeNull();
    await act(async () => {
      ink?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();
    expect(calls).toEqual([['op', 'title.style', { color: 'var(--ink)' }]]);
  });

  test('Default takes the colour off (null)', async () => {
    const host = await frame(selection({ font: null, color: '#2fbf71' }));
    await act(async () => {
      host
        .querySelector<HTMLElement>('[data-testid="insp-ctl-title-colour"] button')
        ?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await settle();
    await act(async () => {
      q(host, 'insp-none-title-colour')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
    });
    await settle();
    expect(calls).toEqual([['op', 'title.style', { color: null }]]);
  });
});
