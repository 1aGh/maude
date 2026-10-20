// S7.13 — linked formats and the Re-frame island, as a person meets them (07 · ve-formats, ve-reframe). Real markup, real
// registry, real island; only fetch is faked (every route is a recorder). The server half (the derivation, the writes and
// the read-back) is pinned in linked-formats-derive.test.ts and reframe-keyframes.test.ts.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement as h } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const realFetch = globalThis.fetch;
type Req = { url: string; method: string; body: any };
const reqs: Req[] = [];
let media: Record<string, any> = {};
let editStatus = 200;
let editBody: Record<string, any> = { ok: true, writeId: 'w1' };
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.endsWith('.css')) return new Response(':root{--bg-1:#fff}', { status: 200 });
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    reqs.push({ url: u, method: init?.method ?? 'GET', body });
    if (u.startsWith('/_api/comp-media')) return Response.json(media);
    if (u.startsWith('/_api/comp-clips')) return Response.json({ ok: true, clips: [] });
    if (u.startsWith('/_api/canvas-meta')) return Response.json({ artboardMeta: {} });
    if (u === '/_api/edit-op')
      return new Response(JSON.stringify(editBody), { status: editStatus });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }) as unknown as typeof fetch;
});

let restoreSlots: (() => void) | null = null;
const seated: Array<() => void> = [];
afterAll(async () => {
  for (const off of seated.splice(0)) off();
  restoreSlots?.();
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});

const FILE = '.design/ui/Recap.tsx';
const row = (id: string, name: string, w: number, h2: number, aspect: string, over = {}) => ({
  artboardId: id,
  label: null,
  name,
  size: `${w} × ${h2}`,
  w,
  h: h2,
  aspect,
  current: false,
  linked: true,
  unlinkedCopy: false,
  ...over,
});
const threeFormats = () => ({
  fps: 30,
  clips: [],
  words: [],
  speech: [],
  beats: [],
  music: [],
  unresolved: [],
  transcripts: {},
  captions: null,
  formats: {
    comp: 'Recap',
    unlinkedFrom: null,
    formats: [
      row('reels', 'Reels 9:16', 1080, 1920, '9:16', { current: true }),
      row('wide', '16:9', 1920, 1080, '16:9'),
      row('square', '1:1', 1080, 1080, '1:1'),
    ],
    copies: [],
    free: [{ name: '4:5', w: 1080, h: 1350 }],
    canUnlink: true,
  },
});

const roots: Root[] = [];
beforeEach(async () => {
  const { foldStore } = await import('../client/v2/fold/use-fold.js');
  foldStore.set('inspector', false);
  const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
  compMediaStore.reset();
  const { reframeUi } = await import('../client/v2/timeline/reframe-island.jsx');
  reframeUi.reset();
  const { formatsUi } = await import('../client/v2/inspector/formats-ui.js');
  formatsUi.reset();
  media = threeFormats();
  editStatus = 200;
  editBody = { ok: true, writeId: 'w1' };
  reqs.length = 0;
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
const q = (host: ParentNode, id: string) =>
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
const rowsOf = (host: HTMLElement, section: string) =>
  [...(q(host, `insp-sec-${section}`)?.querySelectorAll('[data-testid^="insp-row-"]') ?? [])].map(
    (r) =>
      `${(r.getAttribute('data-testid') ?? '').replace('insp-row-', '')} = ${r.querySelector('.insp-row-k')?.textContent}`
  );
const edits = () => reqs.filter((r) => r.url === '/_api/edit-op');

// ── the inspector: Formats ───────────────────────────────────────────────────────────────────────────────
const REELS = {
  selector: '[data-dc-screen="reels"]',
  tag: 'article',
  artboardId: 'reels',
  file: FILE,
  attrs: { 'data-dc-kind': 'video', 'data-dc-fixed': 'true' } as Record<string, string>,
  bounds: { x: 0, y: 0, w: 1080, h: 1920 },
  worldW: 1080,
  worldH: 1920,
};
const recorded: unknown[] = [];
async function frame(over: Record<string, unknown> = {}) {
  if (!seated.length) {
    const art = await import('../client/v2/inspector/kinds/artboard.jsx');
    const video = await import('../client/v2/inspector/kinds/artboard-video.jsx');
    const formats = await import('../client/v2/inspector/sections/formats.jsx');
    const { stashSlots } = await import('../client/v2/inspector/slots.js');
    restoreSlots = stashSlots();
    seated.push(art.registerArtboardSlots());
    seated.push(video.registerArtboardVideoSlots());
    seated.push(formats.registerFormatsSlot());
  }
  const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
  recorded.length = 0;
  return mount(
    h(InspectorFrame, {
      selected: REELS,
      layersTree: null,
      cfg: { designRel: '.design' },
      canvasFile: FILE,
      onOptimistic: () => {},
      onRecordEdit: (p: unknown) => recorded.push(p),
      onReplaceMedia: () => {},
      onUndoRedo: () => {},
      onShellAction: () => {},
      // Advanced draws only where the panel can set the artboard's theme (the other handlers are the kinds' own)
      onSetArtboardTheme: () => {},
      onResizeArtboard: () => {},
      onSetArtboardKind: () => {},
      ...over,
    } as never)
  );
}

describe('the Formats rows (ve-formats)', () => {
  test('"Reels 9:16 · this one", then the others by size, + Add a format, and Make an unlinked copy', async () => {
    const host = await frame();
    expect(rowsOf(host, 'formats')).toEqual(['formats = Formats', 'format-unlink = ']);
    const rows = [...(q(host, 'insp-formats')?.children ?? [])].map((c) => c.textContent);
    expect(rows).toEqual([
      'Reels 9:16this one',
      '16:91920 × 1080',
      '1:11080 × 1080',
      'Add a format',
    ]);
    expect(q(host, 'insp-fmt-reels')?.getAttribute('data-on')).toBe('true');
    expect(q(host, 'insp-format-unlink')?.textContent?.trim()).toBe('Make an unlinked copy');
  });

  test('+ Add a format lists only the sizes this cut does not have; picking one is one video.format.add', async () => {
    const host = await frame();
    expect(q(host, 'insp-format-add-1080x1350')).toBeNull();
    await click(q(host, 'insp-format-add'), 'Add a format');
    expect(q(host, 'insp-format-add-1920x1080')).toBeNull(); // 16:9 is already here
    await click(q(host, 'insp-format-add-1080x1350'), '4:5');
    expect(edits().map((r) => r.body)).toEqual([
      {
        file: FILE,
        op: 'video.format.add',
        targets: [],
        params: { artboard: 'reels', width: 1080, height: 1350 },
      },
    ]);
    // the write lands on the canvas’s undo stack (a legacy link answers a write id and no action id)
    expect(recorded).toEqual([{ op: 'edit-op', writeId: 'w1', label: 'add a format' }]);
    // and the rows are read again from the canvas: the link is derived, never written here
    expect(reqs.filter((r) => r.url.startsWith('/_api/comp-media')).length).toBeGreaterThan(1);
  });

  test('Make an unlinked copy is one video.format.unlink on this artboard', async () => {
    const host = await frame();
    await click(q(host, 'insp-format-unlink'), 'Make an unlinked copy');
    expect(edits().map((r) => [r.body.op, r.body.params])).toEqual([
      ['video.format.unlink', { artboard: 'reels' }],
    ]);
  });

  test('⌘K reaches the rows: Add a format opens the size list, Make an unlinked copy runs on the selected video', async () => {
    const { formatsUi, NO_VIDEO_WORDS } = await import('../client/v2/inspector/formats-ui.js');
    expect(formatsUi.requestAdd()).toBe(NO_VIDEO_WORDS); // nothing selected: a sentence, not silence
    expect(formatsUi.unlink()).toBe(NO_VIDEO_WORDS);
    const host = await frame();
    expect(q(host, 'insp-format-add-1080x1350')).toBeNull();
    await act(async () => {
      expect(formatsUi.requestAdd()).toBeNull();
    });
    await settle();
    expect(q(host, 'insp-format-add-1080x1350')).not.toBeNull();
    await act(async () => {
      expect(formatsUi.unlink()).toBeNull();
    });
    await settle();
    expect(edits().map((r) => r.body.op)).toEqual(['video.format.unlink']);
    // the rows going away takes the door with them
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    expect(formatsUi.requestAdd()).toBe(NO_VIDEO_WORDS);
  });

  test('a refusal is a sentence under the rows, and nothing is recorded', async () => {
    editStatus = 403;
    editBody = { ok: false, code: 'forbidden' };
    const host = await frame();
    await click(q(host, 'insp-format-unlink'), 'Make an unlinked copy');
    expect(q(host, 'insp-formats-said')?.textContent).toBe(
      'Not changed. You can look here; ask to edit.'
    );
    expect(recorded).toEqual([]);
  });

  test('a video on its own has nothing to unlink; an unlinked copy says so and is listed under its cut', async () => {
    media.formats = {
      ...media.formats,
      formats: [row('reels', 'Reels 9:16', 1080, 1920, '9:16', { current: true })],
      copies: [row('wide', '16:9', 1920, 1080, '16:9', { linked: false, unlinkedCopy: true })],
      canUnlink: false,
    };
    const host = await frame();
    expect(q(host, 'insp-format-unlink')).toBeNull();
    expect(q(host, 'insp-fmt-wide')?.textContent).toContain('its own cut');
    media.formats = {
      ...media.formats,
      unlinkedFrom: 'Recap',
      comp: 'RecapUnlinked',
      formats: [row('wide', '16:9', 1920, 1080, '16:9', { current: true })],
      copies: [],
    };
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
    compMediaStore.reset();
    const copy = await frame();
    expect(q(copy, 'insp-format-own-cut')?.textContent).toBe('Unlinked copy — its own cut.');
  });

  test('Advanced names the cut and where framing lives', async () => {
    const host = await frame();
    await click(q(host, 'fold-inspector-toggle'), 'Advanced');
    expect(q(host, 'insp-ab-fact-linkedTo')?.textContent).toBe('Recap');
    expect(q(host, 'insp-ab-fact-framing')?.textContent).toBe('per format');
  });

  test('the Timeline says "Shared by 3 formats" only while others play this cut', async () => {
    const { SharedStatus } = await import('../client/v2/timeline/island-controls.jsx');
    const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
    await compMediaStore.load(FILE, 'reels');
    const host = await mount(h(SharedStatus, { canvas: FILE, artboardId: 'reels' }));
    expect(q(host, 'timeline-shared')?.textContent?.trim()).toBe('Shared by 3 formats');
    media.formats.formats = [row('reels', 'Reels 9:16', 1080, 1920, '9:16', { current: true })];
    await compMediaStore.load(FILE, 'reels');
    await settle();
    expect(q(host, 'timeline-shared')).toBeNull();
  });
});

// ── the Re-frame island ──────────────────────────────────────────────────────────────────────────────────
const OPTIONS = [
  { aspect: '9:16', label: 'Reels 9:16', w: 1080, h: 1920, artboardId: 'reels' },
  { aspect: '16:9', label: '16:9', w: 1920, h: 1080, artboardId: 'wide' },
];
const pointer = (type: string, x: number, y = 0) =>
  new window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
async function island(over: Record<string, unknown> = {}) {
  const { ReframeIsland } = await import('../client/v2/timeline/reframe-island.jsx');
  const calls: unknown[][] = [];
  const host = await mount(
    h(ReframeIsland, {
      name: 'Touchdown',
      url: 'assets/b.mp4',
      at: 2,
      src: { w: 1920, h: 1080 },
      options: OPTIONS,
      format: '9:16',
      onFormat: (a: string) => calls.push(['format', a]),
      scope: 'format',
      onScope: (s: string) => calls.push(['scope', s]),
      out: { w: 1080, h: 1920 },
      focus: [0.5, 0.5],
      zoom: 1,
      keyCount: 0,
      framed: false,
      canEdit: true,
      onDrop: (f: number[]) => calls.push(['drop', f]),
      onReset: () => calls.push(['reset']),
      onDone: () => calls.push(['done']),
      ...over,
    } as never)
  );
  return { host, calls };
}

describe('the Re-frame island (ve-reframe)', () => {
  test('the canvas’s words: Frame “Touchdown” for · the formats · This format / All formats · Reset · Done', async () => {
    const { host } = await island();
    expect(q(host, 'reframe-title')?.textContent).toBe('Frame “Touchdown” for');
    expect(
      [...host.querySelectorAll('[data-testid^="reframe-format-"]')].map((b) => b.textContent)
    ).toEqual(['Reels 9:16', '16:9']);
    expect(q(host, 'reframe-window-tag')?.textContent).toBe('Reels 9:16');
    expect(q(host, 'reframe-reset')?.textContent).toBe('Reset');
    expect(q(host, 'reframe-done')?.textContent).toBe('Done');
    expect(q(host, 'reframe-note')?.textContent).toBe(
      'Drag the window to frame it. Each format keeps its own.'
    );
    // B3: nothing about following a subject is drawn
    expect(host.textContent).not.toMatch(/follow|subject|#1/i);
  });

  test('the 9:16 window is 31.6 % of the 16:9 picture, centred; Reset waits for a keyframe', async () => {
    const { host } = await island();
    const w = must(q(host, 'reframe-window'), 'window');
    expect(parseFloat(w.style.width)).toBeCloseTo(31.64, 1);
    expect(parseFloat(w.style.left)).toBeCloseTo(34.18, 1);
    expect(parseFloat(w.style.height)).toBeCloseTo(100, 4);
    expect((q(host, 'reframe-reset') as HTMLButtonElement).disabled).toBe(true);
    expect(q(host, 'reframe-count')?.textContent).toBe('Centred. Drag the window to frame it.');
  });

  test('dragging the window and letting go is ONE drop, at the focus the hand left it on', async () => {
    const { host, calls } = await island();
    const w = must(q(host, 'reframe-window'), 'window');
    await act(async () => {
      w.dispatchEvent(pointer('pointerdown', 100));
      w.dispatchEvent(pointer('pointermove', 130));
      w.dispatchEvent(pointer('pointermove', 156));
    });
    // a live window while the hand is down, no write yet
    expect(calls.filter((c) => c[0] === 'drop')).toEqual([]);
    expect(must(q(host, 'reframe-window'), 'window').getAttribute('data-focus')).toBe('0.6,0.5');
    await act(async () => {
      w.dispatchEvent(pointer('pointerup', 156));
    });
    expect(calls).toEqual([['drop', [0.6, 0.5]]]);
  });

  test('a click that does not move the window writes nothing', async () => {
    const { host, calls } = await island();
    const w = must(q(host, 'reframe-window'), 'window');
    await act(async () => {
      w.dispatchEvent(pointer('pointerdown', 100));
      w.dispatchEvent(pointer('pointerup', 100));
    });
    expect(calls).toEqual([]);
  });

  test('the arrow keys move it too (⇧ is five times as far), and one pause is one drop', async () => {
    const { host, calls } = await island();
    const w = must(q(host, 'reframe-window'), 'window');
    const key = (k: string, shift = false) =>
      act(async () => {
        w.dispatchEvent(
          new window.KeyboardEvent('keydown', { key: k, shiftKey: shift, bubbles: true })
        );
      });
    await key('ArrowRight');
    await key('ArrowRight', true);
    expect(calls).toEqual([]);
    await act(async () => new Promise((r) => setTimeout(r, 420)));
    expect(calls).toEqual([['drop', [0.56, 0.5]]]);
  });

  test('someone who may only look cannot move it, and is told whom to ask', async () => {
    const { host, calls } = await island({ canEdit: false });
    const w = must(q(host, 'reframe-window'), 'window');
    await act(async () => {
      w.dispatchEvent(pointer('pointerdown', 100));
      w.dispatchEvent(pointer('pointermove', 200));
      w.dispatchEvent(pointer('pointerup', 200));
    });
    expect(calls).toEqual([]);
    expect(q(host, 'reframe-note')?.textContent).toBe('Ask the owner to change this.');
    expect((q(host, 'reframe-reset') as HTMLButtonElement).disabled).toBe(true);
  });

  test('the format, the scope, Reset and Done are the person’s to say', async () => {
    const { host, calls } = await island({ framed: true, keyCount: 2 });
    expect(q(host, 'reframe-count')?.textContent).toBe('2 keyframes');
    await click(q(host, 'reframe-format-16x9'), '16:9');
    await click(q(host, 'reframe-scope-all'), 'All formats');
    await click(q(host, 'reframe-reset'), 'Reset');
    await click(q(host, 'reframe-done'), 'Done');
    expect(calls).toEqual([['format', '16:9'], ['scope', 'all'], ['reset'], ['done']]);
  });

  test('Esc closes it', async () => {
    const { calls } = await island();
    await act(async () => {
      window.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(calls).toEqual([['done']]);
  });
});

describe('the island on the selected clip (the Timeline’s wiring)', () => {
  const SEQ = {
    stableId: 'name:two',
    from: 90,
    duration: 120,
    mediaTag: 'Video',
    mediaSrc: 'assets/b.mp4',
    mediaProps: { trimBefore: 30, playbackRate: 1 },
    reframe: null,
  };
  async function open(over: Record<string, unknown> = {}) {
    const { ReframeHost, reframeUi } = await import('../client/v2/timeline/reframe-island.jsx');
    const { probeSize } = await import('../client/v2/timeline/fit-model.js');
    const { compMediaStore } = await import('../client/v2/transcript/comp-media-store.js');
    // the picture is 1920 × 1080 (the metadata a real <video> reads)
    await probeSize('assets/b.mp4', {
      make: () => {
        const el: any = { videoWidth: 1920, videoHeight: 1080 };
        setTimeout(() => el.onloadedmetadata?.(), 0);
        return el;
      },
    });
    await compMediaStore.load(FILE, 'reels');
    const runs: unknown[] = [];
    const props = {
      seq: SEQ,
      index: 1,
      comp: { width: 1080, height: 1920 },
      fps: 30,
      frame: 120,
      name: 'Touchdown',
      canvas: FILE,
      artboardId: 'reels',
      canEdit: true,
      url: 'assets/b.mp4',
      run: async (p: unknown) => {
        runs.push(p);
        return { ok: true };
      },
      ...over,
    };
    const host = await mount(h(ReframeHost, props as never));
    await act(async () => reframeUi.open());
    await settle();
    return { host, runs, reframeUi };
  }

  test('closed until opened; opened on the video’s own format, with the playhead’s source second', async () => {
    const { ReframeHost } = await import('../client/v2/timeline/reframe-island.jsx');
    const closed = await mount(
      h(ReframeHost, {
        seq: SEQ,
        canvas: FILE,
        artboardId: 'reels',
        run: async () => ({}),
      } as never)
    );
    expect(q(document.body, 'reframe-island')).toBeNull();
    expect(closed.textContent).toBe('');
    // the closed one goes away first: two hosts would both answer the one open state
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await open();
    const isl = must(q(document.body, 'reframe-island'), 'island');
    expect(q(isl, 'reframe-format-9x16')?.getAttribute('aria-checked')).toBe('true');
    expect(q(isl, 'reframe-source')?.querySelector('video')?.getAttribute('src')).toBe(
      'assets/b.mp4#t=2'
    );
  });

  test('a drop writes the keyframe in SOURCE time for This format; All formats writes the shared focus', async () => {
    const { runs } = await open();
    const w = must(q(document.body, 'reframe-window'), 'window');
    const drag = async (dx: number) => {
      await act(async () => {
        w.dispatchEvent(pointer('pointerdown', 100));
        w.dispatchEvent(pointer('pointermove', 100 + dx));
        w.dispatchEvent(pointer('pointerup', 100 + dx));
      });
      await settle();
    };
    await drag(56);
    expect(runs).toEqual([{ focus: [[2, 0.6, 0.5]], format: '9:16' }]);
    await click(q(document.body, 'reframe-scope-all'), 'All formats');
    await drag(-56);
    expect(runs[1]).toEqual({ focus: [[2, 0.4, 0.5]] });
  });

  test('Reset clears this format’s framing', async () => {
    const framed = {
      ...SEQ,
      reframe: { focus: [], zoom: 1, fit: null, formats: { '9:16': [[2, 0.6, 0.5]] } },
    };
    const { runs } = await open({ seq: framed });
    await click(q(document.body, 'reframe-reset'), 'Reset');
    expect(runs).toEqual([{ focus: null, format: '9:16' }]);
  });

  test('a clip with no picture cannot be re-framed: it closes at once', async () => {
    const { reframeUi } = await open({ seq: { ...SEQ, mediaTag: 'Audio' } });
    expect(q(document.body, 'reframe-island')).toBeNull();
    expect(reframeUi.get()).toBeNull();
  });

  test('Done and selecting another clip both close it', async () => {
    const { host, reframeUi } = await open();
    await click(q(document.body, 'reframe-done'), 'Done');
    expect(reframeUi.get()).toBeNull();
    expect(q(document.body, 'reframe-island')).toBeNull();
    expect(host.textContent).toBe('');
  });
});

describe('the clip inspector offers it', () => {
  test('the Framing row offers Re-frame…, which asks the shell for video.reframe', async () => {
    const clip = await import('../client/v2/inspector/kinds/clip.jsx');
    const { stashSlots } = await import('../client/v2/inspector/slots.js');
    for (const off of seated.splice(0)) off();
    restoreSlots?.();
    restoreSlots = stashSlots();
    seated.push(clip.registerClipSlots());
    const { InspectorFrame } = await import('../client/v2/inspector/frame.jsx');
    const { timelineSelectionElement } = await import('../client/v2/timeline/selection.js');
    const asked: string[] = [];
    const host = await mount(
      h(InspectorFrame, {
        selected: timelineSelectionElement({
          kind: 'clip',
          canvas: FILE,
          artboardId: 'reels',
          fps: 30,
          stableId: 'name:two',
          label: 'Touchdown',
          seq: {
            from: 90,
            duration: 120,
            label: 'two',
            series: true,
            mediaTag: 'Video',
            mediaSrc: 'assets/b.mp4',
            mediaProps: {},
            rowKind: 'video',
            fit: null,
          },
          transitionAfter: null,
          onVerb: () => {},
          onOp: async () => ({ ok: true }),
          deselect: () => {},
        } as never),
        layersTree: null,
        cfg: { designRel: '.design' },
        canvasFile: FILE,
        onOptimistic: () => {},
        onRecordEdit: () => {},
        onReplaceMedia: () => {},
        onUndoRedo: () => {},
        onShellAction: (id: string) => asked.push(id),
      } as never)
    );
    const rows = rowsOf(host, 'clip');
    expect(rows.slice(-1)).toEqual(['clip-framing = Framing']);
    await click(q(host, 'insp-clip-reframe'), 'Re-frame…');
    expect(asked).toEqual(['video.reframe']);
  });
});
