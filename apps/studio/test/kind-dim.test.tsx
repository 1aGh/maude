// S7.24b — the Layers half of the kind filter (08 · ak-mixed-fit, 05 · es-filter). Pinned here:
//   the per-artboard counts the Layers chips show (21 artboards: 19 fixed size + 2 print), the ids the shell
//   tells the canvas to dim (`dim-artboards`), the sentence under the list and the way out, the kit block when a
//   filter hides every artboard of the open canvas; the dgn row (parent only, capped, junk refused whole); the
//   relay that tells the open canvas (and tells it again once it has loaded); the canvas layer that dims;
//   the ⌘K row that puts the cursor on the chips.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { acceptFromShell, DIM_IDS_MAX as BRIDGE_MAX, DGN_TABLE } from '../bridge/dgn-protocol.ts';
import {
  clearKindFilter,
  getKindFilter,
  setKindFilter,
} from '../client/v2/kinds/kind-filter-store.js';
import {
  artboardCounts,
  DIM_IDS_MAX,
  dimIds,
  layersFoot,
  noArtboardsOfKind,
  otherCount,
} from '../client/v2/kinds/layers-kind-model.js';

type Board = { id: string; kind: string; label?: string };

/** Combine-kampan as it is: 19 fixed size + 2 print. */
const KAMPAN: Board[] = [
  ...Array.from({ length: 18 }, (_, i) => ({ id: `d${i + 1}`, kind: 'digital' })),
  { id: 'old', kind: 'social' }, // the index's old name for digital
  { id: 'arch-1', kind: 'print', label: 'Arch 1' },
  { id: 'arch-2', kind: 'print', label: 'Arch 2' },
];
const INVITE: Board[] = [
  { id: 'a', kind: 'digital' },
  { id: 'b', kind: 'digital' },
  { id: 'c', kind: 'digital' },
  { id: 'd', kind: 'digital' },
  { id: 'e', kind: 'web' },
];

beforeEach(() => clearKindFilter());

describe('the model', () => {
  test('counts are per artboard: 21 = 19 fixed size + 2 print (`social` is fixed size)', () => {
    expect(artboardCounts(KAMPAN)).toEqual({ all: 21, digital: 19, web: 0, print: 2, video: 0 });
    expect(artboardCounts(undefined)).toEqual({ all: 0, digital: 0, web: 0, print: 0, video: 0 });
  });

  test('Print dims the other 19; no filter, an unknown kind or no artboards dims nothing', () => {
    const ids = dimIds(KAMPAN, 'print');
    expect(ids).toHaveLength(19);
    expect(ids).not.toContain('arch-1');
    expect(ids).not.toContain('arch-2');
    expect(ids).toContain('old');
    expect(dimIds(KAMPAN, 'all')).toBeNull();
    expect(dimIds(KAMPAN, 'sparkle')).toBeNull();
    expect(dimIds([], 'print')).toBeNull();
    expect(dimIds(undefined, 'print')).toBeNull();
  });

  test('a filter nothing matches dims every artboard', () => {
    expect(dimIds(INVITE, 'print')).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  test('the ids are capped at what the bridge accepts', () => {
    expect(DIM_IDS_MAX).toBe(BRIDGE_MAX);
    const many = Array.from({ length: DIM_IDS_MAX + 40 }, (_, i) => ({ id: `x${i}`, kind: 'web' }));
    expect(dimIds(many, 'print')).toHaveLength(DIM_IDS_MAX);
  });

  test('the foot says how many are dimmed (and nothing when nothing is)', () => {
    expect(otherCount(KAMPAN, 'print')).toBe(19);
    expect(layersFoot({ boards: KAMPAN, kind: 'print' })).toBe('19 other artboards are dimmed.');
    expect(layersFoot({ boards: [...KAMPAN.slice(0, 1), KAMPAN[19]], kind: 'print' })).toBe(
      '1 other artboard is dimmed.'
    );
    expect(layersFoot({ boards: [{ id: 'p', kind: 'print' }], kind: 'print' })).toBe('');
    expect(layersFoot({ boards: KAMPAN, kind: 'all' })).toBe('');
  });

  test('a filter that hides every artboard says which one, what is here, and the way out', () => {
    const w = noArtboardsOfKind({ kind: 'print', canvas: 'Combine-invite', boards: INVITE });
    expect(w.title).toBe('No print artboards in Combine-invite.');
    expect(w.next).toBe('The Print filter is on. All 5 artboards here are fixed size or web page.');
    expect(w.action).toBe('Clear filter');
    expect(
      noArtboardsOfKind({ kind: 'video', canvas: 'Solo', boards: [{ id: 'a', kind: 'web' }] }).next
    ).toBe('The Video filter is on. The one artboard here is a web page.');
  });
});

describe('the dgn row `dim-artboards`', () => {
  const win = { parent: { name: 'shell' } } as unknown as Window;
  const shell = (win as unknown as { parent: unknown }).parent;
  const ev = (data: unknown, source: unknown) => ({ data, source }) as unknown as MessageEvent;

  test('the shell may say it; nobody else; null clears', () => {
    const msg = { dgn: 'dim-artboards', ids: ['a', 'b'] };
    expect(acceptFromShell(ev(msg, shell), win)).toEqual(msg);
    expect(acceptFromShell(ev({ dgn: 'dim-artboards', ids: null }, shell), win)).toEqual({
      dgn: 'dim-artboards',
      ids: null,
    });
    expect(acceptFromShell(ev(msg, { name: 'sibling' }), win)).toBeNull();
    expect(acceptFromShell(ev(msg, win), win)).toBeNull();
    expect((DGN_TABLE.s2c as Record<string, { gate: string }>)['dim-artboards']?.gate).toBe(
      'parent'
    );
  });

  test('a planted payload is refused whole: too many ids, not strings, not a list', () => {
    const tooMany = Array.from({ length: DIM_IDS_MAX + 1 }, (_, i) => `x${i}`);
    expect(acceptFromShell(ev({ dgn: 'dim-artboards', ids: tooMany }, shell), win)).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'dim-artboards', ids: ['a', 7] }, shell), win)).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'dim-artboards', ids: 'a' }, shell), win)).toBeNull();
    expect(acceptFromShell(ev({ dgn: 'dim-artboards' }, shell), win)).toBeNull();
    expect(
      acceptFromShell(ev({ dgn: 'dim-artboards', ids: ['x'.repeat(200)] }, shell), win)
    ).toBeNull();
  });
});

// ── DOM ─────────────────────────────────────────────────────────────────────────────────────────────

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  clearKindFilter();
});
const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const click = (el: HTMLElement | null) =>
  act(async () => {
    el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
async function mount(node: React.ReactNode) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return { host, rerender: (n: React.ReactNode) => act(async () => root.render(n)) };
}

describe('the Layers chips', () => {
  async function filter(boards: Board[] | undefined, canvas = 'Combine-kampan') {
    const { LayersKindFilter } = await import('../client/v2/kinds/LayersKindFilter.jsx');
    const { ArtboardLayers } = await import('../client/v2/layers/artboard-layers.jsx');
    // the foot is the Layers list's (V2-8.5 C8, 08 ak-mixed-fit): chips above, list, the foot under it
    return mount(
      <>
        <LayersKindFilter boards={boards} canvasName={canvas} />
        <ArtboardLayers boards={boards} canvasName={canvas} />
      </>
    );
  }

  test('five chips with the per-artboard counts; each name is "<word>, <n>"', async () => {
    await filter(KAMPAN);
    const chips = Array.from(document.querySelectorAll('[data-testid^="layers-kind-chip-"]'));
    expect(chips.map((c) => c.getAttribute('aria-label'))).toEqual([
      'All, 21',
      'Fixed size, 19',
      'Web page, 0',
      'Print, 2',
      'Video, 0',
    ]);
    expect(q('layers-kind-foot')).toBeNull(); // no filter, nothing dimmed, nothing said
  });

  test('Print: the store moves, the foot says 19 are dimmed, Show all puts it back', async () => {
    await filter(KAMPAN);
    await click(q('layers-kind-chip-print'));
    expect(getKindFilter()).toBe('print');
    expect(q('layers-kind-chip-print')?.getAttribute('aria-pressed')).toBe('true');
    expect(q('layers-kind-foot')?.textContent).toContain('19 other artboards are dimmed.');
    await click(q('layers-kind-show-all'));
    expect(getKindFilter()).toBe('all');
    expect(q('layers-kind-foot')).toBeNull();
  });

  test('the filter is the one the Canvases panel uses: set from outside and Layers follows', async () => {
    await filter(KAMPAN);
    await act(async () => {
      setKindFilter('print');
    });
    expect(q('layers-kind-foot')).not.toBeNull();
  });

  test('a filter that hides every artboard of this canvas says which one, and clears in one click', async () => {
    setKindFilter('print');
    await filter(INVITE, 'Combine-invite');
    const none = q('layers-kind-none');
    expect(none?.textContent).toContain('No print artboards in Combine-invite.');
    expect(none?.textContent).toContain('All 5 artboards here are fixed size or web page.');
    // 05 es-filter: the chip that is on shows its whole word + count + ×; "Clear filter" has its × glyph; the
    // "N other artboards are dimmed" foot is not stacked under the block (the block already says it)
    expect(q('layers-kind-chip-print')?.textContent).toContain('Print');
    expect(q('layers-kind-chip-print-x')).not.toBeNull();
    expect(q('layers-kind-chip-web-x')).toBeNull();
    expect(q('layers-kind-clear')?.querySelector('svg')).not.toBeNull();
    expect(q('layers-kind-foot')).toBeNull();
    await click(q('layers-kind-clear'));
    expect(getKindFilter()).toBe('all');
    expect(q('layers-kind-none')).toBeNull();
  });

  test('a canvas with no artboards (or none known yet) shows nothing at all', async () => {
    setKindFilter('print');
    await filter(undefined);
    expect(q('layers-kind-chips')).toBeNull();
    expect(q('layers-kind-none')).toBeNull();
  });

  test('⌘K "Filter layers by kind" puts the cursor on the chip that is on, or on All', async () => {
    const bus = await import('../client/v2/kinds/kind-filter-store.js');
    await filter(KAMPAN);
    await act(async () => {
      setKindFilter('print');
    });
    await act(async () => {
      bus.requestFocusLayersKind();
    });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('layers-kind-chip-print');
    await act(async () => {
      clearKindFilter();
    });
    await act(async () => {
      bus.requestFocusLayersKind();
    });
    expect(document.activeElement?.getAttribute('data-testid')).toBe('layers-kind-chip-all');
  });
});

describe('the relay that tells the open canvas (dgn dim-artboards)', () => {
  const CANVAS = 'http://127.0.0.1:4401';
  const targets: string[] = [];
  function fakeFrame(path: string, src: string | null = `${CANVAS}/_canvas-shell.html?c=1`) {
    const sent: unknown[] = [];
    const w = {
      postMessage: (m: unknown, to: string) => {
        sent.push(m);
        targets.push(to);
      },
    };
    const el = document.createElement('iframe');
    el.setAttribute('data-testid', 'canvas-frame');
    el.setAttribute('data-path', path);
    if (src) Object.defineProperty(el, 'src', { value: src }); // a getter only: happy-dom would fetch an attribute
    Object.defineProperty(el, 'contentWindow', { value: w });
    document.body.append(el);
    return { sent, win: w, el };
  }
  const FILE = '.design/ui/Combine-kampan.tsx';

  test('Print tells the open canvas the 19 to dim; the same answer is not sent twice; All sends null', async () => {
    const { createKindDimLane } = await import('../client/v2/kinds/kind-dim-relay.js');
    const { sent } = fakeFrame(FILE);
    const stop = createKindDimLane({
      boardsOf: (file: string) => (file === FILE ? KAMPAN : undefined),
      doc: document,
      win: window,
    });
    expect(sent).toEqual([]); // no filter, nothing to say to a canvas that was never told anything
    await act(async () => {
      setKindFilter('print');
    });
    expect(sent).toHaveLength(1);
    const m = sent[0] as { dgn: string; ids: string[] };
    expect(m.dgn).toBe('dim-artboards');
    expect(m.ids).toHaveLength(19);
    expect(m.ids).not.toContain('arch-1');
    await act(async () => {
      setKindFilter('print');
    });
    expect(sent).toHaveLength(1);
    await act(async () => {
      clearKindFilter();
    });
    expect(sent.at(-1)).toEqual({ dgn: 'dim-artboards', ids: null });
    stop();
  });

  test('a canvas that has just loaded is told again; a canvas with no known artboards is left alone', async () => {
    const { createKindDimLane } = await import('../client/v2/kinds/kind-dim-relay.js');
    setKindFilter('print');
    const a = fakeFrame(FILE);
    const other = fakeFrame('.design/ui/unknown.tsx');
    const stop = createKindDimLane({
      boardsOf: (file: string) => (file === FILE ? KAMPAN : undefined),
      doc: document,
      win: window,
    });
    expect(a.sent).toHaveLength(1);
    expect(other.sent).toHaveLength(0);
    window.dispatchEvent(
      new MessageEvent('message', { data: { dgn: 'loaded' }, source: a.win as never })
    );
    expect(a.sent).toHaveLength(2);
    stop();
  });

  test('C6: every send names the canvas origin, never "*"; a frame with no origin hears nothing', async () => {
    const { createKindDimLane } = await import('../client/v2/kinds/kind-dim-relay.js');
    targets.length = 0;
    setKindFilter('print');
    const a = fakeFrame(FILE);
    const blank = fakeFrame(FILE, null);
    const stop = createKindDimLane({ boardsOf: () => KAMPAN, doc: document, win: window });
    expect(a.sent).toHaveLength(1);
    expect(blank.sent).toHaveLength(0);
    expect(targets).toEqual([CANVAS]);
    stop();
    // the shell's configured canvas origin wins over the frame's src
    a.el.remove();
    blank.el.remove();
    const b = fakeFrame(FILE);
    targets.length = 0;
    const stop2 = createKindDimLane({
      boardsOf: () => KAMPAN,
      doc: document,
      win: window,
      canvasOrigin: () => 'http://127.0.0.1:4402',
    });
    expect(b.sent).toHaveLength(1);
    expect(targets).toEqual(['http://127.0.0.1:4402']);
    expect(targets).not.toContain('*');
    stop2();
  });

  test('the index learning the canvas later is told too', async () => {
    const { createKindDimLane } = await import('../client/v2/kinds/kind-dim-relay.js');
    setKindFilter('print');
    const a = fakeFrame(FILE);
    let boards: Board[] | undefined;
    const stop = createKindDimLane({ boardsOf: () => boards, doc: document, win: window });
    expect(a.sent).toHaveLength(0);
    boards = KAMPAN;
    stop.refresh();
    expect(a.sent).toHaveLength(1);
    stop();
  });
});

describe('the canvas dims', () => {
  async function layer() {
    const { KindDim } = await import('../editing/kind-dim.tsx');
    return mount(<KindDim />);
  }
  const post = (data: unknown, source: unknown = window) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: source as never }));
  const css = () => document.querySelector('style[data-ed-kind-dim]')?.textContent ?? '';

  test('the artboards the shell names are dimmed; the others are not; null puts them back', async () => {
    await layer();
    expect(document.querySelector('style[data-ed-kind-dim]')).toBeNull();
    await act(async () => {
      post({ dgn: 'dim-artboards', ids: ['d1', 'weird"id'] });
    });
    expect(css()).toContain('[data-dc-screen="d1"]');
    expect(css()).toContain('weird\\"id');
    expect(css()).not.toContain('arch-1');
    expect(css()).toContain('opacity');
    await act(async () => {
      post({ dgn: 'dim-artboards', ids: null });
    });
    expect(document.querySelector('style[data-ed-kind-dim]')).toBeNull();
  });

  test('only the shell may say it, and a planted payload dims nothing', async () => {
    await layer();
    await act(async () => {
      post({ dgn: 'dim-artboards', ids: ['d1'] }, { not: 'the parent' });
      post({ dgn: 'dim-artboards', ids: ['d1', 5] });
    });
    expect(document.querySelector('style[data-ed-kind-dim]')).toBeNull();
  });

  test('a dimmed artboard can still be clicked: the dim is a look, not a lock', async () => {
    await layer();
    await act(async () => {
      post({ dgn: 'dim-artboards', ids: ['d1'] });
    });
    expect(css()).not.toContain('pointer-events');
  });
});
