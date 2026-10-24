// V2-4.2 — the project pill and the one menu, against the REAL component (happy-dom + React):
//  · every rendered row is a registry id AND a PROJECT_MENU id; the rendered tree order is the data's;
//  · the keyboard reaches every row (arrows / → / ← / ↵ / esc only) — the whole tree is walked;
//  · ↵ on the pill opens it, esc on the root returns focus to the pill;
//  · ⌘K finds every row for its label (the palette's own matcher over the palette's own rows);
//  · every rendered row has a runner (no dead row), and a click runs the shell's function once.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { V1_PALETTE } from '../actions/legacy.ts';
import { menuIds } from '../actions/menu.ts';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { matchCommands } from '../client/command-palette-match.js';
import { createMenuHandlers, runnableIds } from '../client/v2/shell/menu-runner.js';
import {
  buildProjectMenu,
  menuCtx,
  menuPaletteRows,
  modelIds,
} from '../client/v2/shell/project-menu-model.js';
import { ProjectPill } from '../client/v2/shell/project-pill.jsx';

const desktop = menuCtx({ native: true, canvasOpen: true });
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(run: (id: string) => void = () => {}, ctx = desktop) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ProjectPill
        project="Alligators brand"
        canvas="Combine-kampan"
        ctx={ctx}
        state={{}}
        run={run}
      />
    );
  });
  return host;
}

const pill = () => document.querySelector('[data-testid="project-pill"]') as HTMLButtonElement;
const key = async (el: Element, k: string, init: KeyboardEventInit = {}) => {
  await act(async () => {
    el.dispatchEvent(
      new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...init })
    );
  });
  // the submenu focus hop is one animation frame
  await act(async () => {
    await new Promise((r) => setTimeout(r, 30));
  });
};
const focused = () => document.activeElement as HTMLElement;
const idOf = (el: Element | null) =>
  el?.getAttribute('data-action') ?? el?.getAttribute('data-sub') ?? null;

describe('the pill', () => {
  test('is an island with data-occludes="top"; its name leads with the visible text (2.5.3) then says what it is', async () => {
    await mount();
    expect(pill().getAttribute('aria-label')).toBe(
      'Alligators brand / Combine-kampan, project menu'
    );
    // the visible text is a prefix of the accessible name: voice control ("click Alligators brand") works
    expect(pill().getAttribute('aria-label')?.startsWith('Alligators brand')).toBe(true);
    expect(pill().getAttribute('title')).toBe('Project menu');
    expect(pill().getAttribute('aria-haspopup')).toBe('menu');
    expect(pill().closest('.island')?.getAttribute('data-occludes')).toBe('top');
    expect(pill().textContent).toContain('Alligators brand');
  });

  test('the mark is the DS Mark (azure tile + white star), never the AI spark glyph', async () => {
    await mount();
    const paths = [...(host?.querySelectorAll('.st-pill-mark svg path') ?? [])];
    expect(paths.length).toBe(2);
    // the kit `Mark`, verbatim: the tile (round on three corners), then the star on it
    expect(paths[0].getAttribute('d')).toBe(
      'M7 0H25A7 7 0 0 1 32 7V32H7A7 7 0 0 1 0 25V7A7 7 0 0 1 7 0Z'
    );
    expect(paths[0].getAttribute('fill')).toBe('var(--accent)');
    expect(paths[1].getAttribute('fill')).toBe('var(--accent-fg)');
  });

  test('docked on the pinned left column it declares no edge (it covers no canvas)', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<ProjectPill project="P" ctx={desktop} state={{}} run={() => {}} docked />);
    });
    expect(pill().closest('.island')?.hasAttribute('data-occludes')).toBe(false);
    expect(pill().closest('.island')?.getAttribute('data-docked')).toBe('true');
  });

  test('↵ on the pill opens the menu and puts focus on Back to Home; esc returns focus to the pill', async () => {
    await mount();
    pill().focus();
    await key(pill(), 'Enter');
    expect(document.querySelector('[data-testid="project-menu"]')).not.toBeNull();
    expect(pill().getAttribute('aria-expanded')).toBe('true');
    expect(idOf(focused())).toBe('nav.home');
    await key(focused(), 'Escape');
    expect(document.querySelector('[data-testid="project-menu"]')).toBeNull();
    expect(document.activeElement).toBe(pill());
  });

  test('Space and ↓ open it too', async () => {
    await mount();
    pill().focus();
    await key(pill(), ' ');
    expect(document.querySelector('[data-testid="project-menu"]')).not.toBeNull();
    await key(focused(), 'Escape');
    await key(pill(), 'ArrowDown');
    expect(document.querySelector('[data-testid="project-menu"]')).not.toBeNull();
  });
});

describe('the rows', () => {
  test('every rendered row is a registry id and a PROJECT_MENU id; order is the data’s', async () => {
    await mount();
    await act(async () => pill().click());
    const model = buildProjectMenu(desktop);
    const topRows = Array.from(
      document.querySelectorAll('[data-testid="project-menu"] > [role=none] > [role^=menuitem]')
    );
    const topIds = topRows.map(idOf);
    // top level: leaves by action id, submenus by label — exactly the model's top level
    expect(topIds).toEqual(
      model.filter((n) => n.type !== 'sep').map((n) => (n.type === 'item' ? n.id : n.label))
    );
    const all = new Set(menuIds());
    for (const r of document.querySelectorAll('[data-action]')) {
      const id = r.getAttribute('data-action') as string;
      expect(ACTIONS_BY_ID.has(id), id).toBe(true);
      expect(all.has(id), id).toBe(true);
    }
  });

  test('the keyboard walks the whole tree (↑ ↓ → ← only) and reaches exactly the model’s rows', async () => {
    await mount();
    pill().focus();
    await key(pill(), 'Enter');
    const reached: string[] = [];
    const walkLevel = async (depth: number) => {
      const level = focused().closest('[role=menu]') as HTMLElement;
      const rows = Array.from(level.querySelectorAll(':scope > [role=none] > [role^=menuitem]'));
      for (let i = 0; i < rows.length; i++) {
        expect(focused()).toBe(rows[i]);
        const row = rows[i] as HTMLElement;
        if (row.hasAttribute('data-sub')) {
          await key(row, 'ArrowRight');
          expect(focused().closest('[role=menu]')).not.toBe(level);
          await walkLevel(depth + 1);
          await key(focused(), 'ArrowLeft');
          expect(focused()).toBe(row); // closing a level lands on the row that opened it
        } else {
          reached.push(row.getAttribute('data-action') as string);
        }
        if (i < rows.length - 1) await key(row, 'ArrowDown');
      }
    };
    await walkLevel(0);
    expect(reached).toEqual(modelIds(buildProjectMenu(desktop)));
    // wrap-around and Home / End on the root
    const first = document.querySelector(
      '[data-testid="project-menu"] [role^=menuitem]'
    ) as HTMLElement;
    await key(focused(), 'End');
    expect(focused()).not.toBe(first);
    await key(focused(), 'Home');
    expect(focused()).toBe(first);
    await key(first, 'ArrowUp');
    expect(focused()).not.toBe(first); // wrapped to the last row
  });

  test('type-ahead jumps to the next row starting with the letter', async () => {
    await mount();
    pill().focus();
    await key(pill(), 'Enter');
    await key(focused(), 's'); // Share…, Settings… — the first after Back to Home that starts with s
    expect(focused().textContent?.toLowerCase().startsWith('s')).toBe(true);
    const first = idOf(focused());
    await key(focused(), 's');
    expect(idOf(focused())).not.toBe(first);
  });

  test('a click on a row runs that action once through run() and closes the menu', async () => {
    const ran: string[] = [];
    await mount((id) => ran.push(id));
    await act(async () => pill().click());
    const row = document.querySelector(
      '[data-testid="project-menu-row-settings.open"]'
    ) as HTMLElement;
    await act(async () => row.click());
    expect(ran).toEqual(['settings.open']);
    expect(document.querySelector('[data-testid="project-menu"]')).toBeNull();
  });

  test('a disabled row stays in the menu, announces aria-disabled and runs nothing', async () => {
    const ran: string[] = [];
    await mount((id) => ran.push(id), menuCtx({ native: true, canvasOpen: false }));
    await act(async () => pill().click());
    const file = document.querySelector('[data-testid="project-menu-row-sub-file"]') as HTMLElement;
    await act(async () => file.click());
    const row = document.querySelector(
      '[data-testid="project-menu-row-canvas.rename"]'
    ) as HTMLElement;
    expect(row.getAttribute('aria-disabled')).toBe('true');
    await act(async () => row.click());
    expect(ran).toEqual([]);
    expect(document.querySelector('[data-testid="project-menu"]')).not.toBeNull();
  });

  test('Advanced is one quiet submenu row under Edit and View', async () => {
    await mount();
    await act(async () => pill().click());
    for (const sub of ['edit', 'view']) {
      await act(async () =>
        (
          document.querySelector(`[data-testid="project-menu-row-sub-${sub}"]`) as HTMLElement
        ).click()
      );
      const adv = document.querySelector(
        `[data-testid="project-menu-sub-${sub}"] [data-sub="Advanced"]`
      );
      expect(adv, sub).not.toBeNull();
    }
  });
});

describe('⌘K finds every row', () => {
  test('for each row the palette’s matcher returns that action for the row’s label', () => {
    const model = buildProjectMenu(desktop);
    const v1 = V1_PALETTE.map((r) => ({
      id: r.id,
      group: r.group,
      label: ACTIONS_BY_ID.get(r.id)?.legacy?.palette ?? r.id,
    }));
    const rows = menuPaletteRows(desktop, { existing: v1, run: () => {} });
    const palette = [...v1, ...rows];
    const labelOf = (id: string) => {
      const find = (ns: ReturnType<typeof buildProjectMenu>): string | undefined => {
        for (const n of ns) {
          if (n.type === 'item' && n.id === id) return n.label;
          if (n.type === 'sub') {
            const l = find(n.children);
            if (l) return l;
          }
        }
        return undefined;
      };
      return find(model) as string;
    };
    for (const id of new Set(modelIds(model))) {
      const hits = matchCommands(palette, labelOf(id)).map(
        (a: { id: string; actionId?: string }) => a.actionId ?? a.id
      );
      expect(hits, `${id} ("${labelOf(id)}")`).toContain(id);
    }
  });

  test('with nothing typed the palette is still v1’s list', () => {
    const v1 = V1_PALETTE.map((r) => ({ id: r.id, group: r.group, label: r.id }));
    const rows = menuPaletteRows(desktop, { existing: v1, run: () => {} });
    expect(rows.length).toBeGreaterThan(40);
    expect(matchCommands([...v1, ...rows], '').map((a: { id: string }) => a.id)).toEqual(
      v1.map((r) => r.id)
    );
    expect(
      matchCommands([...v1, ...rows], 'duplicate canvas').map((a: { id: string }) => a.id)
    ).toEqual(['canvas.duplicate']);
  });

  test('a ⌘K twin and its menu row run the same function', () => {
    const ran: string[] = [];
    const rows = menuPaletteRows(desktop, { existing: [], run: (id: string) => ran.push(id) });
    rows.find((r: { id: string }) => r.id === 'import.brand')?.run();
    expect(ran).toEqual(['import.brand']);
  });
});

describe('no dead row', () => {
  test('every id the desktop menu renders has a runner (shell handler, canvas lane or native command)', () => {
    const proxy = new Proxy({}, { get: () => () => {} });
    const handlers = createMenuHandlers(proxy);
    const can = runnableIds(handlers);
    const dead = modelIds(buildProjectMenu(desktop)).filter((id) => !can.has(id));
    expect(dead).toEqual([]);
  });
});

describe('a submenu inside a submenu (View › Advanced, p8-bugs3 #2)', () => {
  // happy-dom has no layout: the rows' boxes are stated here. The View panel scrolls (overflow-y: auto), so a
  // panel nested INSIDE it was clipped to it and dragged sideways by every focus — "an empty panel with one row".
  let realRect: typeof HTMLElement.prototype.getBoundingClientRect | null = null;
  beforeEach(() => {
    realRect = HTMLElement.prototype.getBoundingClientRect;
  });
  const rect = (l: number, t: number, w: number, h: number) =>
    ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h, x: l, y: t }) as DOMRect;
  afterEach(() => {
    if (realRect) HTMLElement.prototype.getBoundingClientRect = realRect;
  });
  async function openAdvanced() {
    await mount();
    await act(async () => pill().click());
    for (const sub of ['view', 'advanced'])
      await act(async () =>
        (
          document.querySelector(`[data-testid="project-menu-row-sub-${sub}"]`) as HTMLElement
        ).click()
      );
  }
  test('its panel is placed from the row that opened it, on the viewport, clear of the View panel', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 900, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 1440, configurable: true });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.matches('[data-testid="project-menu-sub-advanced"]')) return rect(0, 0, 272, 260);
      if (this.classList.contains('st-pm-li')) return rect(276, 574, 264, 28);
      return rect(0, 0, 0, 0);
    };
    await openAdvanced();
    const panel = document.querySelector(
      '[data-testid="project-menu-sub-advanced"]'
    ) as HTMLElement;
    expect(panel).not.toBeNull();
    expect(panel.style.position).toBe('fixed');
    expect(panel.style.left).toBe('548px'); // right edge of the row + 8
    expect(panel.style.top).toBe('570px'); // the row's top − 4
    const view = document.querySelector('[data-testid="project-menu-sub-view"]') as HTMLElement;
    expect(view.style.position).toBe(''); // the first level stays a plain absolute panel
  });
  test('it slides up to stay inside the window, and flips to the left of the row when the right has no room', async () => {
    Object.defineProperty(window, 'innerHeight', { value: 700, configurable: true });
    Object.defineProperty(window, 'innerWidth', { value: 700, configurable: true });
    HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
      if (this.matches('[data-testid="project-menu-sub-advanced"]')) return rect(0, 0, 272, 260);
      if (this.classList.contains('st-pm-li')) return rect(276, 574, 264, 28);
      return rect(0, 0, 0, 0);
    };
    await openAdvanced();
    const panel = document.querySelector(
      '[data-testid="project-menu-sub-advanced"]'
    ) as HTMLElement;
    expect(panel.style.top).toBe('432px'); // 700 − 8 − 260
    expect(panel.style.left).toBe('8px'); // 276 − 8 − 272 = −4: kept 8 from the window's edge
  });
});
