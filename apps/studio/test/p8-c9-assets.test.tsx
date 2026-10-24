// Phase 8 stage C round 2 — 12 Import and Assets (C9): the Assets panel as the board draws it.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';

import { FRAME_MIN, frameBox } from '../asset-placeholder.tsx';
import { GenerateAsk } from '../client/v2/assets/generate-ask.jsx';
import {
  bytesWords,
  filterKind,
  GROUP_CAP,
  libraryFootWords,
} from '../client/v2/assets/library-foot.js';
import { placedWords } from '../client/v2/assets/place-asset.js';
import { dropHint } from '../edit-ops/place-plan.ts';
import { placedLine } from '../editing/finder-drop-model.ts';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

describe('the library foot and the kind filter (12 · ia-assets-panel)', () => {
  test('"247 assets · 1.4 GB" — the count and the weight of the whole library', () => {
    expect(libraryFootWords([{ size: 1.4 * 1024 ** 3 }, { size: 0 }])).toBe('2 assets · 1.4 GB');
    expect(libraryFootWords([{ size: 2048 }])).toBe('1 asset · 2 KB');
    expect(libraryFootWords([])).toBeNull();
    expect(bytesWords(212 * 1024 ** 2)).toBe('212 MB');
    expect(bytesWords(2.1 * 1024 ** 2)).toBe('2.1 MB');
  });

  test('All kinds keeps everything; Photos, Video, Sound narrow it', () => {
    const a = [{ kind: 'image' }, { kind: 'video' }, { kind: 'audio' }, {}];
    expect(filterKind(a, 'all')).toHaveLength(4);
    expect(filterKind(a, 'image')).toHaveLength(2);
    expect(filterKind(a, 'video')).toHaveLength(1);
    expect(filterKind(a, 'audio')).toHaveLength(1);
    expect(GROUP_CAP).toBe(6);
  });
});

describe('the panel (render)', () => {
  const realFetch = globalThis.fetch;
  const rows = Array.from({ length: 9 }, (_, i) => ({
    rel: `assets/p${i}.jpg`,
    kind: 'image',
    size: 1024 * (i + 1),
    mtimeMs: 100 + i,
    usedIn: [],
    usedBy: 0,
    usedElsewhere: false,
    olderVersions: false,
    recentTake: false,
    notUsed: true,
  }));
  const roots: Root[] = [];
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    globalThis.fetch = (async (url: string) => {
      if (url.startsWith('/_api/index?part=assets'))
        return new Response(JSON.stringify({ seq: 1, history: 'ready', assets: rows }), {
          status: 200,
        });
      return new Response('{}', { status: 200 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });
  async function mount() {
    const { AssetsPanel } = await import('../client/v2/left-panel/assets-panel.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const r = createRoot(host);
    roots.push(r);
    await act(async () => r.render(<AssetsPanel designRel=".design" />));
    await act(async () => new Promise((res) => setTimeout(res, 30)));
    return host;
  }
  const q = (h: HTMLElement, id: string) => h.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  // React's own onChange with the new value (the repo's typing helper)
  const set = (el: HTMLInputElement, v: string) =>
    act(async () => {
      const key = Object.keys(el).find((k) => k.startsWith('__reactProps$')) as string;
      const props = (el as unknown as Record<string, { onChange: (e: unknown) => void }>)[key];
      el.value = v;
      props.onChange({ target: el, currentTarget: el });
    });

  test('the search field carries no ⌘K (that is Search); All kinds sits in the chip row with Generate and Add', async () => {
    const host = await mount();
    expect(q(host, 'assets-search')?.closest('.lp-find')?.textContent).not.toContain('⌘K');
    const bar = q(host, 'assets-bar');
    expect(bar?.textContent).toContain('All kinds');
    expect(bar?.contains(q(host, 'assets-generate'))).toBe(true);
    expect(bar?.contains(q(host, 'assets-add'))).toBe(true);
  });

  test('a group draws two rows, its count says the rest; the foot counts the library', async () => {
    const host = await mount();
    expect(host.querySelectorAll('[data-testid="assets-tile"]')).toHaveLength(6);
    expect(q(host, 'assets-group-image')?.textContent).toContain('9');
    expect(q(host, 'assets-foot')?.textContent).toBe('9 assets · 45 KB');
  });

  test('a search names how it matched, not the kind, and foots each tile with the name', async () => {
    const host = await mount();
    await set(q(host, 'assets-search') as HTMLInputElement, 'p1');
    expect(q(host, 'assets-group-found')?.textContent).toContain('In the name or tags');
    expect(q(host, 'assets-group-image')).toBeNull();
    expect(q(host, 'assets-tile-match')?.textContent).toBe('p1.jpg');
  });

  test('the ContextMenu key opens the tile menu (not right-click only); Copy is in it', async () => {
    const host = await mount();
    const tile = host.querySelector('[data-testid="assets-tile"]') as HTMLElement;
    await act(async () => {
      tile.dispatchEvent(
        new window.KeyboardEvent('keydown', { key: 'ContextMenu', bubbles: true, cancelable: true })
      );
    });
    expect(q(host, 'assets-tile-menu')).not.toBeNull();
    expect(q(host, 'assets-menu-copy')?.textContent).toContain('Copy');
    expect(q(host, 'assets-menu-details')).not.toBeNull();
  });

  test('Browse draws a pick circle on every thumb', async () => {
    const host = await mount();
    await act(async () => {
      q(host, 'assets-group-image')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
    });
    const tiles = host.querySelectorAll(
      '[data-testid="assets-browse"] [data-testid="assets-tile"]'
    );
    expect(tiles.length).toBe(9);
    expect(host.querySelectorAll('[data-testid="assets-tile-pick"]')).toHaveLength(9);
  });

  test('the kind chip narrows the list', async () => {
    const host = await mount();
    await act(async () => {
      q(host, 'assets-kinds')?.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
    await act(async () => {
      q(host, 'assets-kinds-video')?.dispatchEvent(
        new window.MouseEvent('click', { bubbles: true })
      );
    });
    expect(q(host, 'assets-kinds')?.textContent).toContain('Video');
    expect(host.querySelectorAll('[data-testid="assets-tile"]')).toHaveLength(0);
  });
});

describe('the CSS the board draws (pins)', () => {
  const css = read('client/v2/left-panel/left-panel.css');
  test('the tile tip sits below the tile and never truncates', () => {
    const tip = css.slice(css.indexOf('.lp-tile-tip {'), css.indexOf('.lp-tile-tip strong'));
    expect(tip).toContain('top: calc(100% + var(--space-1))');
    expect(tip).toContain('white-space: nowrap');
    expect(tip).not.toContain('bottom: 0');
  });
  test('the group heading is semibold; the active search is ringed', () => {
    const g = css.slice(css.indexOf('  .lp-group {'), css.indexOf('  .lp-grid {'));
    expect(g).toContain('font-weight: var(--w-semibold)');
    expect(css).toContain('.lp-find:focus-within');
  });
  test('the left panel stops above the bottom row; its island is 248 wide', () => {
    expect(read('client/v2/shell/floating-panels.css')).toContain('padding-bottom: 72px');
    expect(read('client/hooks/use-shell-core.jsx')).toContain('def: 264 }');
  });
});

describe('the Missing frame fills the picture frame (12 · ia-missing-gone)', () => {
  const box = (w: number, h: number) => ({ left: 10, top: 20, width: w, height: h });
  const el = (b: ReturnType<typeof box>, parent: unknown = null, tagName = 'DIV') => ({
    getBoundingClientRect: () => b,
    parentElement: parent,
    tagName,
  });

  test('a collapsed broken <img> takes the nearest ancestor big enough for the card', () => {
    const board = el(box(480, 360));
    const img = el(box(480, 14), el(box(480, 14), board));
    expect(frameBox(img)).toEqual(box(480, 360));
  });

  test('a picture with room keeps its own rectangle; nothing around it still gets a card-sized box', () => {
    expect(frameBox(el(box(300, 200)))).toEqual(box(300, 200));
    const tiny = frameBox(el(box(40, 14), el(box(40, 14), null, 'BODY')));
    expect(tiny?.width).toBeGreaterThanOrEqual(FRAME_MIN);
    expect(tiny?.height).toBeGreaterThanOrEqual(FRAME_MIN);
  });
});

describe('the drop chip names the target (12 · ia-drop-photos)', () => {
  test('"Drop to place 6 photos in Fotky ze zápasu"; with no name the old words stay', () => {
    expect(dropHint('artboard', 6, 0, 'Fotky ze zápasu')).toBe(
      'Drop to place 6 photos in Fotky ze zápasu'
    );
    expect(dropHint('artboard', 6, 0)).toBe('Drop to place 6 photos in a tidy grid');
    expect(dropHint('picture', 1, 0, 'Fotky')).toBe('Drop to replace the photo');
    expect(dropHint('artboard', 6, 6, 'Fotky')).toBe('Drop to fill 6 empty frames in order');
  });
  test('the chip sits above the ring in a solid accent ring, no fill', () => {
    const src = read('editing/finder-drop.tsx');
    const css = src.slice(src.indexOf('const CSS_TEXT'), src.indexOf('function ensureStyles'));
    expect(css).toContain('bottom: calc(100% + 8px)');
    expect(css).not.toContain('border-style: dashed');
    expect(css).not.toContain('12%, transparent');
  });
});

describe('the import sheets are the kit dialog (12 · ia-figma-sheets, ia-brand-steps)', () => {
  test('widths 420 / 372, title semibold; the callouts wear a lock and a warning', () => {
    const brand = read('client/v2/import/brand.css');
    expect(brand).toContain('width: min(420px, calc(100% - 2 * var(--float-gap, 16px)))');
    expect(brand).toContain('font-weight: var(--w-semibold, 600)');
    expect(read('client/v2/import/figma.css')).toContain('width: min(372px');
    expect(read('client/v2/import/figma-sheet.jsx')).toContain('<StIcon name="lock"');
    expect(read('client/v2/import/brand-sheet.jsx')).toContain('<StIcon name="warn"');
    expect(read('client/shell/icons.jsx')).toContain('warn: (');
  });
});

describe('the ask is quiet until asked (12 · ia-gen-ask)', () => {
  test('with no artboard it says what sets the shape, calmly — no red alert — and offers the two starters', () => {
    const html = renderToStaticMarkup(
      <GenerateAsk target={null} where={null} onClose={() => {}} />
    );
    expect(html).toContain('The selected artboard sets the picture’s shape.');
    expect(html).not.toContain('role="alert"');
    expect(html).toContain('Use our photos as a style');
    expect(html).toContain('Daylight instead');
  });
});

describe('a placement says so, with Undo (12 · ia-placed)', () => {
  test("the words are the drop's words", () => {
    for (const [n, label] of [
      [1, ''],
      [1, 'Fotky'],
      [6, 'Fotky ze zápasu'],
      [6, ''],
    ] as const)
      expect(placedWords(n, label)).toBe(placedLine(n, label));
    expect(placedWords(6, 'Fotky ze zápasu')).toBe(
      "Placed 6 photos in Fotky ze zápasu. They're in Assets too."
    );
  });
});
