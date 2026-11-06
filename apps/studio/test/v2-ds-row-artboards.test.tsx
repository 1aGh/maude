// 2.0.7 (B3) — a pinned Design system row opens into its Design system canvas's artboards, in the canvas's
// order, and a click on one takes the camera there (the same jump a canvas row's list makes: open the canvas,
// then reveal the artboard). A system with no Design system canvas yet has nothing to open.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { dsBoardLists, dsCanvasPath } from '../client/v2/left-panel/ds-boards.js';

const D = '.design';
const SNAP = {
  project: { designRel: D },
  canvases: [
    {
      rel: 'system/web/design-system.tsx',
      artboards: [
        { id: 'ds-brand', label: 'Brand', kind: null, w: 560, h: 620 },
        { id: 'ds-colour', label: 'Colour', kind: null, w: 1000, h: 620 },
        { id: 'ds-type', label: 'Type', kind: null, w: 600, h: 620 },
      ],
    },
    { rel: 'ui/Home.tsx', artboards: [{ id: 'a', label: 'A', kind: 'web', w: 10, h: 10 }] },
  ],
};
const ROWS = [
  { dsName: 'web', label: 'web' },
  { dsName: 'old', label: 'old' },
];
const SYSTEMS = [
  { name: 'web', path: 'system/web' },
  { name: 'old', path: 'system/old' },
];

describe('which artboards a system row lists', () => {
  test("the Design system canvas's artboards, in its order; an older system has none", () => {
    expect(dsCanvasPath('system/web/', D)).toBe('.design/system/web/design-system.tsx');
    const lists = dsBoardLists(ROWS, { snapshot: SNAP, designRel: D, systems: SYSTEMS });
    expect([...lists.keys()]).toEqual(['web']);
    expect(lists.get('web')?.path).toBe('.design/system/web/design-system.tsx');
    expect(lists.get('web')?.boards.map((b: { id: string }) => b.id)).toEqual([
      'ds-brand',
      'ds-colour',
      'ds-type',
    ]);
  });

  test('a system folder the config does not list is found through its group (2.0.7 #1)', () => {
    const lists = dsBoardLists([{ dsName: 'web' }], {
      snapshot: SNAP,
      designRel: D,
      systems: [],
      groups: [{ label: 'Design system', dsFolders: [{ name: 'web', path: 'system/web' }] }],
    });
    expect(lists.get('web')?.boards.length).toBe(3);
  });

  test('no index yet: nothing to open', () => {
    expect(dsBoardLists(ROWS, { snapshot: null, systems: SYSTEMS }).size).toBe(0);
  });
});

let Pinned: typeof import('../client/v2/left-panel/canvases-pinned.jsx').DsPinnedRows;
const roots: Root[] = [];
beforeAll(async () => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Pinned = (await import('../client/v2/left-panel/canvases-pinned.jsx')).DsPinnedRows;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
  for (const r of roots.splice(0)) act(() => r.unmount());
  document.body.innerHTML = '';
});

function mount(props: Record<string, unknown>) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => root.render(<Pinned rows={ROWS} onOpen={() => {}} {...props} />));
  return host;
}

const q = (host: HTMLElement, sel: string) => host.querySelector(sel) as HTMLElement | null;
const SLUG = 'system-web-design-system';

describe('the system row opens into its artboards', () => {
  test('the twisty opens the list in order; a click jumps there', () => {
    const boards = dsBoardLists(ROWS, { snapshot: SNAP, designRel: D, systems: SYSTEMS });
    const jumps: unknown[] = [];
    const host = mount({ boards, onJump: (path: string, id: string) => jumps.push([path, id]) });
    // the older system's row has no twisty; the converted one has one, closed
    const toggles = host.querySelectorAll('[data-testid^="canvas-jump-toggle-"]');
    expect(toggles.length).toBe(1);
    const toggle = q(host, `[data-testid="canvas-jump-toggle-${SLUG}"]`);
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(q(host, '[data-testid="canvases-ds-boards"]')).toBeNull();

    act(() => toggle?.click());
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    const list = q(host, '[data-testid="canvases-ds-boards"]');
    expect(list?.getAttribute('data-ds')).toBe('web');
    const ids = [...(list?.querySelectorAll('[data-testid^="jump-artboard-"]') ?? [])].map((b) =>
      b.getAttribute('data-testid')
    );
    expect(ids).toEqual([
      `jump-artboard-${SLUG}-ds-brand`,
      `jump-artboard-${SLUG}-ds-colour`,
      `jump-artboard-${SLUG}-ds-type`,
    ]);
    expect(list?.textContent).toContain('Colour');

    act(() => q(host, `[data-testid="jump-artboard-${SLUG}-ds-colour"]`)?.click());
    expect(jumps).toEqual([['.design/system/web/design-system.tsx', 'ds-colour']]);

    act(() => toggle?.click());
    expect(q(host, '[data-testid="canvases-ds-boards"]')).toBeNull();
  });

  test('without its own handler a click goes over the left-panel bus (the canvas row jump)', async () => {
    const { CANVAS_OP_EVENT } = await import('../client/v2/left-panel/left-panel-bus.js');
    const seen: unknown[] = [];
    const on = (e: Event) => seen.push((e as CustomEvent).detail);
    window.addEventListener(CANVAS_OP_EVENT, on);
    try {
      const boards = dsBoardLists(ROWS, { snapshot: SNAP, designRel: D, systems: SYSTEMS });
      const host = mount({ boards });
      act(() => q(host, `[data-testid="canvas-jump-toggle-${SLUG}"]`)?.click());
      act(() => q(host, `[data-testid="jump-artboard-${SLUG}-ds-type"]`)?.click());
      expect(seen).toEqual([
        { op: 'jump', path: '.design/system/web/design-system.tsx', artboardId: 'ds-type' },
      ]);
    } finally {
      window.removeEventListener(CANVAS_OP_EVENT, on);
    }
  });

  test('2.0.7 polish: the artboard in view moving (Pages’ ‹ ›) scrolls its row into view', () => {
    const boards = dsBoardLists(ROWS, { snapshot: SNAP, designRel: D, systems: SYSTEMS });
    const seen: string[] = [];
    const proto = window.HTMLElement.prototype as unknown as { scrollIntoView?: unknown };
    const real = proto.scrollIntoView;
    proto.scrollIntoView = function (this: HTMLElement) {
      seen.push(this.getAttribute('data-testid') ?? '');
    };
    try {
      const path = '.design/system/web/design-system.tsx';
      const host = document.createElement('div');
      document.body.appendChild(host);
      const root = createRoot(host);
      roots.push(root);
      const render = (id: string) =>
        act(() =>
          root.render(
            <Pinned
              rows={ROWS}
              onOpen={() => {}}
              boards={boards}
              activePath={path}
              activeArtboard={id}
            />
          )
        );
      render('ds-brand');
      act(() => q(host, `[data-testid="canvas-jump-toggle-${SLUG}"]`)?.click());
      seen.length = 0;
      render('ds-type');
      expect(seen).toEqual([`jump-artboard-${SLUG}-ds-type`]);
      // the same artboard again: no scroll
      render('ds-type');
      expect(seen).toHaveLength(1);
    } finally {
      proto.scrollIntoView = real;
    }
  });

  test('the artboard in view on the open Design system canvas is marked', () => {
    const boards = dsBoardLists(ROWS, { snapshot: SNAP, designRel: D, systems: SYSTEMS });
    const host = mount({
      boards,
      activePath: '.design/system/web/design-system.tsx',
      activeArtboard: 'ds-type',
    });
    act(() => q(host, `[data-testid="canvas-jump-toggle-${SLUG}"]`)?.click());
    expect(
      q(host, `[data-testid="jump-artboard-${SLUG}-ds-type"]`)?.getAttribute('aria-current')
    ).toBe('true');
    expect(
      q(host, `[data-testid="jump-artboard-${SLUG}-ds-brand"]`)?.getAttribute('aria-current')
    ).toBeNull();
  });
});
