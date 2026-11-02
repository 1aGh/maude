// S7.21 — the kind inspectors (08 ak-web-hug, ak-web-widths, ak-social, ak-video): the rows a web page, a fixed size and a
// video artboard show, per kind, in the 08 canvas's words. Real markup, real registry; only fetch is faked. The golden is
// the row list + the words each row says; what an edit sends stays in v2-inspector-artboard.test.tsx (S2.8).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
let clips: unknown[] = [];
let media: unknown[] = [];
const fetched: string[] = [];
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string) => {
    fetched.push(String(url));
    if (String(url).endsWith('.css'))
      return new Response(':root{--space-4:16px;--bg-1:#fff;--ink:#111}', { status: 200 });
    if (String(url).startsWith('/_api/comp-clips'))
      return new Response(JSON.stringify({ ok: true, clips, media }), { status: 200 });
    if (String(url).startsWith('/_api/canvas-meta'))
      return new Response(JSON.stringify({ artboardMeta: { hype: { poster: 120 } } }), {
        status: 200,
      });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

let restoreSlots: (() => void) | null = null;
afterAll(async () => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  clips = [];
  media = [];
  fetched.length = 0;
});
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const settle = () => act(async () => new Promise((r) => setTimeout(r, 20)));
async function mount(el: React.ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(el));
  await settle();
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const must = (el: Element | null, what: string) => {
  if (!el) throw new Error(`missing ${what}`);
  return el as HTMLElement;
};
const click = async (el: Element | null, what = 'element') => {
  await act(async () => {
    must(el, what).dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
  await settle();
};
const openMenu = (btn: Element | null) => click(btn, 'menu button');
const pick = async (el: Element | null, value: string) => {
  const e = must(el, 'select') as HTMLSelectElement;
  await act(async () => {
    e.value = value;
    e.dispatchEvent(new window.Event('change', { bubbles: true }));
  });
  await settle();
};
const shown = (host: HTMLElement) => {
  const sel = host.querySelector<HTMLSelectElement>('[data-testid="insp-ab-preset"]');
  return sel?.options[sel.selectedIndex]?.textContent;
};
/** The rows of the Artboard section, in order, as `name = label`. */
const rowsOf = (host: HTMLElement) =>
  [...(q(host, 'insp-sec-size')?.querySelectorAll('[data-testid^="insp-row-"]') ?? [])].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );

// every row of the card, whichever section it sits in (Layout and Fill are headless sections of the one Artboard card)
const cardRows = (host: HTMLElement) =>
  [...host.querySelectorAll('[data-testid^="insp-row-"]')].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );

const FILE = '.design/ui/Homepage.tsx';
const CFG = {
  designRel: '.design',
  designSystems: [{ name: 'Studio', tokensCssRel: 'system/studio/colors_and_type.css' }],
  defaultDesignSystem: 'Studio',
};
const board = (
  id: string,
  kind: string,
  w: number,
  h2: number,
  attrs: Record<string, string> = {}
) => ({
  selector: `[data-dc-screen="${id}"]`,
  tag: 'article',
  artboardId: id,
  file: FILE,
  attrs: { 'data-dc-kind': kind, ...attrs } as Record<string, string>,
  bounds: { x: 0, y: 0, w, h: h2 },
  worldW: w,
  worldH: h2,
});
const WEB = board('desktop', 'web', 1440, 1573, { 'data-dc-layout': 'flex-col' });
const STORY = board('story', 'digital', 1080, 1920, { 'data-dc-fixed': 'true' });
const REELS = board('hype', 'video', 1080, 1920, { 'data-dc-fixed': 'true' });

type Call = unknown[];
const calls: Call[] = [];
const handlers = () => ({
  onResizeArtboard: (...a: unknown[]) => calls.push(['resize', ...a]),
  onSetArtboardHug: (...a: unknown[]) => calls.push(['hug', ...a]),
  onSetArtboardStyle: (...a: unknown[]) => calls.push(['style', ...a]),
  onSetArtboardKind: (...a: unknown[]) => calls.push(['kind', ...a]),
  onSetArtboardPrint: (...a: unknown[]) => calls.push(['print', ...a]),
  onSetArtboardTheme: (...a: unknown[]) => calls.push(['theme', ...a]),
  onDuplicateArtboard: (...a: unknown[]) => calls.push(['duplicate', ...a]),
  onRunAction: (m: unknown) => calls.push(['run', m]),
  onShellAction: (id: string) => calls.push(['shell', id]),
});

const seated: Array<() => void> = [];
async function seat() {
  if (seated.length) return;
  const art = await import('../client/v2/inspector/kinds/artboard.jsx');
  const web = await import('../client/v2/inspector/kinds/artboard-web.jsx');
  const fixed = await import('../client/v2/inspector/kinds/artboard-fixed.jsx');
  const video = await import('../client/v2/inspector/kinds/artboard-video.jsx');
  const exp = await import('../client/v2/inspector/sections/export-slot.jsx');
  const { registerSlot, stashSlots } = await import('../client/v2/inspector/slots.js');
  // the registry is process-wide: set what other files left aside, seat exactly the artboard's sections
  restoreSlots = stashSlots();
  seated.push(art.registerArtboardSlots());
  seated.push(web.registerArtboardWebSlots());
  seated.push(fixed.registerArtboardFixedSlots());
  seated.push(video.registerArtboardVideoSlots());
  seated.push(registerSlot('export', exp.EXPORT_SLOT_ENTRY));
}

async function frame(el: Record<string, unknown>, over: Record<string, unknown> = {}) {
  await seat();
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  calls.length = 0;
  return mount(
    h(InspectorFrame, {
      selected: el,
      layersTree: null,
      cfg: CFG,
      canvasFile: FILE,
      onOptimistic: () => {},
      onRecordEdit: () => {},
      onReplaceMedia: () => {},
      onUndoRedo: () => {},
      ...handlers(),
      ...over,
    } as never)
  );
}

describe('Web page (ak-web-hug, ak-web-widths)', () => {
  test('chip, then Width · Height · Layout · Fill · Other widths (08 order) — and the page says how tall it is now', async () => {
    const host = await frame(WEB);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Web page');
    expect(cardRows(host).filter((r) => !r.startsWith('export-'))).toEqual([
      'ab-preset = Width',
      'ab-height = Height',
      'ab-content = Layout',
      'ab-background = Fill',
      'ab-add-width = Other widths',
    ]);
    expect(shown(host)).toBe('Desktop · 1440');
    expect(q(host, 'insp-ab-height')?.querySelector('[aria-checked="true"]')?.textContent).toBe(
      'Fits content'
    );
    expect(q(host, 'insp-ab-height-note')?.textContent).toBe('1573 now — grows as you add.');
  });

  test('a Fixed page has no growth note', async () => {
    const host = await frame(board('desktop', 'web', 1440, 900, { 'data-dc-fixed': 'true' }));
    expect(q(host, 'insp-ab-height-note')).toBeNull();
  });

  test('Add a width offers Tablet and Mobile in one go, then each width', async () => {
    const host = await frame(WEB);
    // V2-8.5 C2 — a small button that opens a menu (08 ak-web-widths), not a native select
    const btn = q(host, 'insp-ab-add-width') as HTMLElement;
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.textContent).toBe('Add a width');
    await openMenu(btn);
    expect(
      [...host.querySelectorAll('[data-testid="insp-ab-add-width-menu"] [role="menuitem"]')].map(
        (o) => o.textContent
      )
    ).toEqual(['Tablet and Mobile', 'Laptop · 1280', 'Tablet · 834', 'Mobile · 390']);
    const mobile = await frame(board('mobile', 'web', 390, 2185));
    await openMenu(q(mobile, 'insp-ab-add-width'));
    expect(
      [...mobile.querySelectorAll('[data-testid="insp-ab-add-width-menu"] [role="menuitem"]')].map(
        (o) => o.textContent
      )
    ).not.toContain('Tablet and Mobile');
  });

  test('Add a width asks the open canvas (one request) and files the toast it will owe', async () => {
    const { resetAddedWidths, settleAddedWidths } = await import(
      '../client/v2/inspector/kinds/add-width.js'
    );
    resetAddedWidths();
    const host = await frame(WEB);
    await openMenu(q(host, 'insp-ab-add-width'));
    await click(q(host, 'insp-ab-add-width-tablet+mobile'));
    expect(calls).toEqual([
      [
        'run',
        {
          dgn: 'run-action',
          v: 1,
          id: 'artboard.duplicate-at-width',
          params: { artboard: 'desktop', widths: [834, 390] },
        },
      ],
    ]);
    // the canvas's write comes back through the shell bridge: that is when the words are said
    const body = {
      op: 'artboard.duplicate-at-width',
      params: {
        items: [
          { artboard: 'desktop', width: 834 },
          { artboard: 'desktop', width: 390 },
        ],
      },
    };
    const toast = settleAddedWidths(body, { ok: true });
    expect(toast?.message).toBe(
      'Tablet and Mobile are beside Desktop. Their layout reflowed to fit.'
    );
    expect(toast?.action?.label).toBe('Undo');
    toast?.action?.onClick();
    expect(calls.at(-1)).toEqual(['shell', 'edit.undo']);
  });
});

describe('Fixed size (ak-social)', () => {
  test('chip, then Size (a catalogue preset) and the exact pixels; no Height mode, no Add a width', async () => {
    const host = await frame(STORY);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Fixed size');
    expect(rowsOf(host)).toEqual(['ab-preset = Size', 'ab-size = ']);
    expect(shown(host)).toBe('Story 9:16 (still)');
    const value = (id: string) =>
      (must(q(host, id)?.querySelector('input') ?? null, id) as HTMLInputElement).value;
    expect(value('insp-num-ab-w')).toBe('1080');
    expect(value('insp-num-ab-h')).toBe('1920');
    expect(q(host, 'insp-row-ab-height')).toBeNull();
    expect(q(host, 'insp-row-ab-add-width')).toBeNull();
  });

  test('a size that is no preset reads Custom; the Export row offers PNG · 1×', async () => {
    const host = await frame(board('x', 'digital', 1000, 1000, { 'data-dc-fixed': 'true' }));
    expect(shown(host)).toBe('Custom');
    expect(q(host, 'insp-export-preset')?.textContent).toBe('PNG · 1×');
  });

  test('picking a preset resizes to its whole size', async () => {
    const host = await frame(STORY);
    await pick(q(host, 'insp-ab-preset'), 'social-post-4-5');
    expect(calls).toEqual([['resize', 'story', 1080, 1350]]);
  });
});

describe('Video (ak-video)', () => {
  test('Size · Length · Poster frame · Sound, from what the comp announces', async () => {
    const { publishVideoComps, resetVideoFacts } = await import(
      '../client/v2/inspector/kinds/video-facts.js'
    );
    resetVideoFacts();
    publishVideoComps(FILE, [
      { id: 'hype-comp', artboardId: 'hype', fps: 30, durationInFrames: 450 },
    ]);
    clips = [
      { mediaTag: 'Video', mediaSrc: 'assets/a.mp4' },
      { mediaTag: 'Audio', mediaSrc: 'assets/Hype%20instrumental.mp3' },
    ];
    const host = await frame(REELS);
    expect(q(host, 'inspector-kind')?.textContent).toBe('Video');
    expect(rowsOf(host)).toEqual([
      'ab-preset = Size',
      'ab-length = Length',
      'ab-poster = Poster frame',
      'ab-sound = Sound',
      'ab-export = Export',
    ]);
    expect(shown(host)).toBe('Reels 9:16');
    expect(q(host, 'insp-ab-length')?.textContent?.trim()).toBe('0:15');
    // the meta says frame 120 → 0:04
    expect(q(host, 'insp-ab-poster')?.textContent).toBe('0:04');
    expect(q(host, 'insp-ab-sound')?.textContent).toBe('Hype instrumental');
    // 07 VideoInspector: Export is one row with an MP4 button, not a section with presets
    expect(q(host, 'insp-export-preset')).toBeNull();
    expect(q(host, 'insp-sec-export')).toBeNull();
    expect(q(host, 'insp-ab-export')?.textContent?.trim()).toBe('MP4');
  });

  test('07 VideoInspector (V2-8.5 c4-video): a flat card — no "Artboard" heading, an MP4 button that opens the export sheet', async () => {
    const host = await frame(REELS);
    // the board's video card has no section heading above Size
    expect(q(host, 'insp-sec-size')?.querySelector('.insp-sec-t')?.hasAttribute('hidden')).toBe(
      true
    );
    const btn = q(host, 'insp-ab-export');
    expect(btn?.tagName).toBe('BUTTON');
    await click(btn, 'MP4');
    expect(calls).toEqual([['shell', 'export.open']]);
  });

  test('07 VideoInspector: the poster frame row draws the 22×38 picture beside the time and a ghost Change', async () => {
    const host = await frame(REELS);
    const pic = q(host, 'insp-ab-poster-pic');
    expect(pic).not.toBeNull();
    expect(pic?.className).toContain('insp-poster-pic');
    const change = q(host, 'insp-ab-poster-change');
    // a quiet ghost button (the kit's .btn--ghost), not an underlined link
    expect(change?.className).toContain('btn--ghost');
    expect(change?.className).not.toContain('insp-quietlink');
  });

  test('08 ak-video: Length is a number well with the clock, Sound a pill with the music swatch', async () => {
    const { publishVideoComps, resetVideoFacts } = await import(
      '../client/v2/inspector/kinds/video-facts.js'
    );
    resetVideoFacts();
    publishVideoComps(FILE, [
      { id: 'hype-comp', artboardId: 'hype', fps: 30, durationInFrames: 450 },
    ]);
    clips = [{ mediaTag: 'Audio', mediaSrc: 'assets/Hype%20instrumental.mp3' }];
    const host = await frame(REELS);
    const len = q(host, 'insp-ab-length');
    expect(len?.className).toContain('insp-ro--well');
    expect(len?.querySelector('svg')).toBeTruthy();
    const snd = q(host, 'insp-ab-sound');
    expect(snd?.className).toContain('insp-ro--pill');
    expect(snd?.querySelector('.insp-ro-swatch')).toBeTruthy();
    // no music: the quiet note, not a pill
    clips = [];
    const none = q(
      await frame(board('other', 'video', 1920, 1080, { 'data-dc-fixed': 'true' })),
      'insp-ab-sound'
    );
    expect(none?.className).not.toContain('insp-ro--pill');
  });

  test('08 ak-video: a music bed that sits loose in the comp body (no Sequence) is the Sound too', async () => {
    const { publishVideoComps, resetVideoFacts } = await import(
      '../client/v2/inspector/kinds/video-facts.js'
    );
    resetVideoFacts();
    publishVideoComps(FILE, [
      { id: 'hype-comp', artboardId: 'hype', fps: 30, durationInFrames: 450 },
    ]);
    // the enumerator lists the Sequences as clips and the bare <Audio src="assets/music.mp3"> under `media`
    clips = [{ mediaTag: 'Video', mediaSrc: 'assets/a.mp4' }];
    media = [{ tag: 'Audio', src: 'assets/music.mp3' }];
    const host = await frame(REELS);
    expect(q(host, 'insp-ab-sound')?.textContent).toBe('music');
    expect(q(host, 'insp-ab-sound')?.className).toContain('insp-ro--pill');
  });

  test('before the comp has announced itself: no numbers invented; no music reads "None yet"', async () => {
    const { resetVideoFacts } = await import('../client/v2/inspector/kinds/video-facts.js');
    resetVideoFacts();
    const host = await frame(board('other', 'video', 1920, 1080, { 'data-dc-fixed': 'true' }));
    expect(q(host, 'insp-ab-length')?.textContent?.trim()).toBe('—');
    expect(q(host, 'insp-ab-sound')?.textContent).toBe('None yet');
    expect(shown(host)).toBe('Landscape 16:9');
  });

  test('Change sets the poster at the playhead through the registry action', async () => {
    const host = await frame(REELS);
    await click(q(host, 'insp-ab-poster-change'), 'Change');
    expect(calls).toEqual([['shell', 'video.poster.set']]);
  });
});

describe('Advanced holds the numbers (nothing deleted)', () => {
  test('a web page: exact size, Clip content, Kind and its facts; the testids kept', async () => {
    const host = await frame(WEB);
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    expect(q(host, 'insp-num-ab-w')).not.toBeNull();
    expect(q(host, 'insp-num-ab-h')).not.toBeNull();
    expect(q(host, 'insp-ctl-ab-clip')).not.toBeNull();
    expect((q(host, 'insp-ab-kind') as HTMLSelectElement).value).toBe('web');
    expect(q(host, 'insp-ab-fact-kind')?.textContent).toBe('web');
    expect(q(host, 'insp-ab-fact-width')?.textContent).toBe('1440px');
    expect(q(host, 'insp-ab-fact-height')?.textContent).toBe('auto · now 1573px');
    expect(q(host, 'insp-ab-fact-display')?.textContent).toBe('flex · column');
  });

  test('a video: kind video · fps · durationInFrames · codec · poster', async () => {
    const { publishVideoComps, resetVideoFacts } = await import(
      '../client/v2/inspector/kinds/video-facts.js'
    );
    resetVideoFacts();
    publishVideoComps(FILE, [{ id: 'c', artboardId: 'hype', fps: 30, durationInFrames: 450 }]);
    const host = await frame(REELS);
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    const facts = [...host.querySelectorAll('[data-testid^="insp-ab-fact-"]')].map(
      (n) => `${n.getAttribute('data-testid')?.replace('insp-ab-fact-', '')} ${n.textContent}`
    );
    expect(facts).toEqual([
      'kind video',
      'width 1080px',
      'height 1920px',
      'fps 30',
      'durationInFrames 450',
      'codec h264',
      'poster frame 120',
    ]);
  });

  test('a fixed size keeps its pixels in the section, not twice', async () => {
    const host = await frame(STORY);
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    expect(host.querySelectorAll('[data-testid="insp-num-ab-w"]').length).toBe(1);
    // 06 ad-pinned: the fold says the size once, as Exact size — no raw kind / width / height rows beside it
    expect(q(host, 'insp-ab-exact-size')?.textContent).toMatch(/\d+ × 1920 px$/);
    expect(q(host, 'insp-ab-fact-height')).toBeNull();
    expect(q(host, 'insp-ab-fact-kind')).toBeNull();
    expect(q(host, 'insp-ab-fact-width')).toBeNull();
    // Look and layout keeps Clip content and the Kind switch (the only place a board's kind is changed)
    expect(q(host, 'insp-ab-look')?.querySelector('[data-testid="insp-ab-kind"]')).not.toBeNull();
    expect(
      q(host, 'insp-ab-look')?.querySelector('[data-testid="insp-ctl-ab-clip"]')
    ).not.toBeNull();
    expect(q(host, 'insp-ab-code-text')?.textContent).toContain('<DCArtboard');
    const heads = [...(q(host, 'insp-ab-fixed-adv')?.querySelectorAll('.insp-adv-h') ?? [])].map(
      (h) => h.textContent
    );
    expect(heads).toEqual(['Exact size', 'Look and layout', 'In code']);
  });

  test('switching the kind from Advanced still writes it (Fixed size clears the prop)', async () => {
    const host = await frame(WEB);
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    await pick(q(host, 'insp-ab-kind'), 'digital');
    expect(calls[0]).toEqual(['kind', 'desktop', null, null]);
  });
});

describe('the pure parts', () => {
  test('one table for the Export defaults', async () => {
    const { exportDefaults, exportWords } = await import('../kinds/export-defaults.ts');
    expect(exportDefaults('digital').word).toBe('PNG · 1×');
    expect(exportDefaults('web').word).toBe('PNG · 1×');
    expect(exportDefaults('print').word).toBe('Print PDF');
    expect(exportDefaults('video').word).toBe('MP4');
    expect(exportDefaults(undefined).word).toBe('PNG · 1×');
    expect(exportDefaults('hologram').word).toBe('PNG · 1×');
    expect(exportWords(['digital', 'print'])).toBe('2 files…');
    expect(exportWords(['video'])).toBe('MP4');
  });

  test('the toast words: one width, two widths, a width that is no preset', async () => {
    const { addedWidthsWords } = await import(
      '../client/v2/inspector/kinds/artboard-kinds-model.js'
    );
    expect(addedWidthsWords([834, 390], 'Desktop')).toBe(
      'Tablet and Mobile are beside Desktop. Their layout reflowed to fit.'
    );
    expect(addedWidthsWords([834], 'Desktop')).toBe(
      'Tablet is beside Desktop. Its layout reflowed to fit.'
    );
    expect(addedWidthsWords([1000], 'Desktop')).toBe(
      '1000 px is beside Desktop. Its layout reflowed to fit.'
    );
  });

  test('an answer the inspector did not ask for says nothing; a refusal drops the toast', async () => {
    const { expectAddedWidths, settleAddedWidths, resetAddedWidths, pendingAddedWidths } =
      await import('../client/v2/inspector/kinds/add-width.js');
    resetAddedWidths();
    const body = {
      op: 'artboard.duplicate-at-width',
      params: { items: [{ artboard: 'a', width: 834 }] },
    };
    expect(settleAddedWidths(body, { ok: true })).toBeNull();
    expectAddedWidths({ artboardId: 'a', widths: [834], sourceWord: 'Desktop' });
    expect(settleAddedWidths(body, { ok: false })).toBeNull();
    expect(pendingAddedWidths()).toBe(0);
    expectAddedWidths({ artboardId: 'a', widths: [834], sourceWord: 'Desktop' }, 1000);
    expect(settleAddedWidths(body, { ok: true }, 1000 + 60_000)).toBeNull(); // expired
  });

  test('two widths of one board land one after the other, each with its own width', async () => {
    const { duplicatePlacesAtWidths } = await import('../editing/artboard-actions.ts');
    const boards = [{ id: 'desktop', x: 0, y: 0, w: 1440, h: 1573 }];
    const out = duplicatePlacesAtWidths(['desktop'], boards, [834, 390]);
    expect(out.map((p) => [p.artboard, p.width])).toEqual([
      ['desktop', 834],
      ['desktop', 390],
    ]);
    expect(out[0].at.x).toBe(1440 + 80);
    expect(out[1].at.x).toBe(1440 + 80 + 834 + 80);
    expect(out[0].at.y).toBe(0);
  });

  test('the growth tag: the first measurement is a baseline; a section added shows; a shrink clears', async () => {
    const { growthStep, growthWords } = await import('../artboard-growth-tag.tsx');
    expect(growthStep(null, 1200)).toBeNull();
    expect(growthStep(1200, 1573)).toBe(373);
    expect(growthStep(1200, 1204)).toBeNull();
    expect(growthStep(1573, 1200)).toBe('clear');
    expect(growthWords(373)).toBe('+ 373 px');
  });
});
