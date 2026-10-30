// S1.3 — a canvas row opens into its artboards (11 · pn-jump): counts per kind, the foot, dynamic canvases saying
// so, the one in view highlighted, and a click that posts the jump — `reveal-artboard` once the bridge has it,
// today's select + frame until then, a cut (no glide) under reduced motion. Panel search (01 · cf-panel-search)
// rendered: "treneri" finds "Trenéři"; an artboard hit opens its canvas.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { DYNAMIC_NOTE, jumpFoot, kindCounts, planJump } from '../client/v2/canvases/jump-model.js';

const D = '.design';
const ROOT = `${D}/ui`;
const KAMPAN = `${ROOT}/Combine-kampan.tsx`;
const GEN = `${ROOT}/Generated.tsx`;
const TRENERI = `${ROOT}/Trenéři.tsx`;

const board = (id: string, label: string, kind: string) => ({ id, label, kind });
const KAMPAN_BOARDS = [
  ...Array.from({ length: 19 }, (_, i) => board(`d${i + 1}`, `Pozvánka ${i + 1}`, 'digital')),
  board('p1', 'Náborový leták A6 · FLAG', 'print'),
  board('p2', 'Náborový leták A6 · TACKLE', 'print'),
];

describe('the jump list as data', () => {
  test('counts per kind, in reading order: "21 artboards · 19 digital, 2 print"', () => {
    expect(kindCounts(KAMPAN_BOARDS)).toEqual([
      { kind: 'digital', count: 19 },
      { kind: 'print', count: 2 },
    ]);
    expect(jumpFoot(KAMPAN_BOARDS)).toBe('21 artboards · 19 digital, 2 print');
    expect(jumpFoot([board('a', 'A', 'web')])).toBe('1 artboard · 1 web');
    // the old name of the digital slot counts as digital
    expect(kindCounts([board('a', 'A', 'social'), board('b', 'B', 'web')])).toEqual([
      { kind: 'web', count: 1 },
      { kind: 'digital', count: 1 },
    ]);
  });

  test('a dynamic canvas says it is a count so far', () => {
    expect(jumpFoot(KAMPAN_BOARDS.slice(0, 3), { dynamic: true })).toBe(
      '3 artboards so far · 3 digital'
    );
    expect(jumpFoot([], { dynamic: true })).toBe('Artboards appear once the canvas runs');
    expect(jumpFoot([])).toBe('No artboards yet');
  });

  test("until the bridge has reveal-artboard a click is today's jump: select, then frame", () => {
    const plan = planJump({ activePath: KAMPAN, path: KAMPAN, artboardId: 'p1', live: false });
    expect(plan.open).toBe(false);
    expect(plan.messages).toEqual([
      { dgn: 'select-by-id', artboardId: 'p1' },
      { dgn: 'run-action', v: 1, id: 'view.zoom-to-artboard', params: { id: 'p1' } },
    ]);
  });

  test('with it, one message: glide + flash — and a cut under reduced motion', () => {
    const live = planJump({ activePath: GEN, path: KAMPAN, artboardId: 'p1', live: true });
    expect(live.open).toBe(true); // the canvas is not on screen: open it first
    expect(live.messages).toEqual([
      { dgn: 'reveal-artboard', artboardId: 'p1', glide: true, flash: true },
    ]);
    const cut = planJump({
      activePath: KAMPAN,
      path: KAMPAN,
      artboardId: 'p1',
      live: true,
      reducedMotion: true,
    });
    expect(cut.messages[0]).toEqual({
      dgn: 'reveal-artboard',
      artboardId: 'p1',
      glide: false,
      flash: true,
    });
    expect(
      planJump({ activePath: null, path: KAMPAN, artboardId: '', live: true }).messages
    ).toEqual([]);
  });
});

// ── rendered ────────────────────────────────────────────────────────────────────────────────────────────

function project() {
  const paths = [KAMPAN, GEN, TRENERI];
  const canvases = [
    { rel: 'ui/Combine-kampan.tsx', kind: 'canvas', mtimeMs: 3, artboards: KAMPAN_BOARDS },
    {
      rel: 'ui/Generated.tsx',
      kind: 'canvas',
      mtimeMs: 2,
      dynamic: true,
      artboards: [board('g1', 'Slide 1', 'web'), board('g2', 'Slide 2', 'web')],
    },
    { rel: 'ui/Trenéři.tsx', kind: 'canvas', mtimeMs: 1, artboards: [] },
  ];
  return {
    groups: [{ label: 'UI canvases', kind: 'canvas', fullPath: ROOT, paths, dirs: [] }],
    snapshot: { pid: 'l0123456789abcdef', project: { designRel: D }, writer: { seq: 1 }, canvases },
  };
}

const realFetch = globalThis.fetch;
function installFetch(snapshot: unknown) {
  globalThis.fetch = (async (url: string) => {
    const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200 });
    if (url.startsWith('/_api/index')) return ok(snapshot);
    if (url === '/_api/pins') return ok({ v: 1, pins: [], opened: {} });
    return ok({});
  }) as unknown as typeof fetch;
}

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});
const settle = (ms = 420) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mount(over: Record<string, unknown> = {}) {
  const p = project();
  installFetch(p.snapshot);
  const { CanvasesPanel } = await import('../client/v2/canvases/canvases-panel.jsx');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  const jumps: Array<[string, string]> = [];
  const render = (extra: Record<string, unknown> = {}) =>
    root.render(
      <CanvasesPanel
        groups={p.groups}
        search=""
        projectLabel="Alligators brand"
        activePath={null}
        onOpen={() => {}}
        onJumpArtboard={(path: string, id: string) => jumps.push([path, id])}
        expansion={{ isOpen: () => true, setOpen: () => {} }}
        {...over}
        {...extra}
      />
    );
  await act(async () => render());
  await settle();
  return { host, jumps, rerender: (e?: Record<string, unknown>) => act(async () => render(e)) };
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const all = (host: HTMLElement, sel: string) => Array.from(host.querySelectorAll<HTMLElement>(sel));
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const key = (el: Element | null, k: string) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(
      new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })
    );
  });
};

describe('the jump list rendered (11 · pn-jump)', () => {
  test('closed by default; the twisty opens 21 artboards with their kinds, and the foot counts them', async () => {
    const { host } = await mount();
    expect(all(host, '[data-testid^="jump-artboard-"]')).toHaveLength(0);
    const tw = q(host, 'canvas-jump-toggle-ui-combine-kampan');
    expect(tw?.getAttribute('aria-expanded')).toBe('false');
    // a canvas with nothing to list has no twisty
    expect(q(host, 'canvas-jump-toggle-ui-treneri')).toBeNull();

    await click(tw);
    expect(q(host, 'canvas-jump-toggle-ui-combine-kampan')?.getAttribute('aria-expanded')).toBe(
      'true'
    );
    const rows = all(host, '[data-testid^="jump-artboard-ui-combine-kampan-"]');
    expect(rows).toHaveLength(21);
    expect(rows.filter((r) => r.dataset.kind === 'print')).toHaveLength(2);
    expect(q(host, 'canvases-foot')?.textContent).toBe('21 artboards · 19 digital, 2 print');
    // pn-jump: the opened canvas row says how many it holds; a closed one does not
    expect(q(host, 'canvas-row-count-ui-combine-kampan')?.textContent).toBe('21');
    // closing it takes the foot away (P8 C5: no foot line at rest)
    await click(q(host, 'canvas-jump-toggle-ui-combine-kampan'));
    expect(q(host, 'canvases-foot')).toBeNull();
    expect(q(host, 'canvas-row-count-ui-combine-kampan')).toBeNull();
  });

  test('the artboard in view is highlighted (aria-current); a click jumps to it', async () => {
    const { host, jumps } = await mount({ activePath: KAMPAN, activeArtboard: 'd7' });
    await click(q(host, 'canvas-jump-toggle-ui-combine-kampan'));
    const cur = all(host, '[aria-current="true"][data-testid^="jump-artboard-"]');
    expect(cur.map((c) => c.dataset.testid)).toEqual(['jump-artboard-ui-combine-kampan-d7']);

    await click(q(host, 'jump-artboard-ui-combine-kampan-p1'));
    expect(jumps).toEqual([[KAMPAN, 'p1']]);
    // the one just jumped to is the one in view straight away, before the selection echoes back
    expect(q(host, 'jump-artboard-ui-combine-kampan-p1')?.getAttribute('aria-current')).toBe(
      'true'
    );
    expect(q(host, 'jump-artboard-ui-combine-kampan-d7')?.getAttribute('aria-current')).toBeNull();
  });

  test('a dynamic canvas says its artboards are made when it runs', async () => {
    const { host } = await mount();
    await click(q(host, 'canvas-jump-toggle-ui-generated'));
    expect(q(host, 'jump-dynamic-ui-generated')?.textContent).toBe(DYNAMIC_NOTE);
    expect(q(host, 'canvases-foot')?.textContent).toBe('2 artboards so far · 2 web');
  });

  test('keys: → opens the list, → steps in, Enter jumps, ← goes back to the canvas', async () => {
    const { host, jumps } = await mount();
    const canvasItem = () =>
      q(host, 'canvas-row-ui-combine-kampan')?.closest<HTMLElement>('[role="treeitem"]') ?? null;
    const primary = q(host, 'canvas-row-ui-combine-kampan');
    await key(primary, 'ArrowRight');
    expect(canvasItem()?.getAttribute('aria-expanded')).toBe('true');
    expect(all(host, '[data-testid^="jump-artboard-"]')).toHaveLength(21);

    const firstItem = q(host, 'jump-artboard-ui-combine-kampan-d1')?.closest<HTMLElement>(
      '[role="treeitem"]'
    );
    await key(primary, 'ArrowRight'); // steps into the list
    await key(firstItem ?? null, 'Enter'); // (the focused row is the treeitem, not its button)
    expect(jumps).toEqual([[KAMPAN, 'd1']]);

    await key(firstItem ?? null, 'ArrowLeft'); // back to the canvas row; the list stays open
    expect(canvasItem()?.getAttribute('aria-expanded')).toBe('true');
    await key(canvasItem(), 'ArrowLeft'); // and ← on the canvas closes it
    expect(canvasItem()?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('panel search rendered (01 · cf-panel-search)', () => {
  test('"treneri" finds "Trenéři", the typed letters marked on the accented name', async () => {
    const { host } = await mount({ search: 'treneri' });
    const names = all(host, '[role="treeitem"] .cv-name').map((n) => n.textContent);
    expect(names).toEqual(['Trenéři']);
    expect(all(host, 'mark.cv-mark').map((m) => m.textContent)).toEqual(['Trenéři']);
    expect(q(host, 'canvases-foot')?.textContent).toBe('1 result · ⌘K searches every project');
  });

  test('an artboard hit is one row quoting the artboard that matched (a flat list); the twisty opens the matches; the click jumps', async () => {
    const { host, jumps } = await mount({ search: 'letak' });
    expect(all(host, '[data-testid^="canvas-row-"]').map((n) => n.dataset.testid)).toEqual([
      'canvas-row-ui-combine-kampan',
    ]);
    // 01 cf-panel-search: collapsed, the second line says which artboard it was
    expect(all(host, '[data-testid^="jump-artboard-"]')).toHaveLength(0);
    expect(host.querySelector('.cv-sub')?.textContent).toBe(
      'print · “Náborový leták A6 · FLAG” and 1 more'
    );
    expect(q(host, 'canvases-foot')?.textContent).toBe('1 result · ⌘K searches every project');
    await click(q(host, 'canvas-jump-toggle-ui-combine-kampan'));
    // opened by hand: every artboard of the canvas, the two that matched marked
    const hits = all(host, '[data-testid^="jump-artboard-"]');
    expect(hits).toHaveLength(21);
    expect(all(host, 'mark.cv-mark').map((m) => m.textContent)).toContain('leták');
    const p2 = hits.find((h) => h.dataset.testid === 'jump-artboard-ui-combine-kampan-p2');
    await click(p2 ?? null);
    expect(jumps).toEqual([[KAMPAN, 'p2']]);
  });
});
