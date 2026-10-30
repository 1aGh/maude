// S2.9 (artboards ed-ab-arrange, ed-ab-tidy) — the canvas half: the align bar over 4 artboards grows "Tidy up", the
// dashed preview shows the row before anything moves, Tidy is ONE commit through the drag bus (so annotations ride
// along and ⌘Z is one step), the guides chrome of a drag in flight, the lifted shadow, and the retired v1 toolbar.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { AlignBarView, boardsMixKinds } from '../editing/align-bar.tsx';
import {
  arrangeBoardsOrSay,
  type BoardRect,
  TIDY_ACTION,
  TIDY_TIP,
  tidyBoards,
  tidyPreviewRects,
} from '../editing/arrange.ts';
import { ArtboardGuidesView, GUIDES_CSS } from '../editing/artboard-guides.tsx';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import { TidyGhosts, tidyPreviewStore } from '../editing/tidy-preview.tsx';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  tidyPreviewStore.set(null);
});
async function mount(ui: React.ReactNode) {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(ui));
}

const STORIES: BoardRect[] = [
  { id: 'a', x: 150, y: 196, w: 216, h: 384 },
  { id: 'b', x: 396, y: 204, w: 216, h: 384 },
  { id: 'c', x: 640, y: 164, w: 216, h: 384 },
  { id: 'd', x: 900, y: 222, w: 216, h: 384 },
];

describe('Tidy up on the align bar', () => {
  test('"4 artboards" has Tidy up with the tooltip "One row, even gaps"; objects never get it', async () => {
    await mount(
      <AlignBarView
        model={{ kind: 'artboards', count: 4, label: '4 artboards' }}
        onAction={() => {}}
      />
    );
    const tidy = document.querySelector('[data-testid="edit-tidy"]') as HTMLButtonElement;
    expect(tidy.textContent).toBe('Tidy up');
    expect(tidy.getAttribute('data-tip')).toBe('One row, even gaps');
    expect(TIDY_TIP).toBe('One row, even gaps');
    expect(document.querySelector('[data-testid="edit-align-count"]')?.textContent).toBe(
      '4 artboards'
    );
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    await mount(
      <AlignBarView model={{ kind: 'objects', count: 3, label: '3 objects' }} onAction={() => {}} />
    );
    expect(document.querySelector('[data-testid="edit-tidy"]')).toBeNull();
  });

  test('the pointer or focus on the button asks for the preview; leaving takes it back; the click commits', async () => {
    const seen: string[] = [];
    await mount(
      <AlignBarView
        model={{ kind: 'artboards', count: 4, label: '4 artboards' }}
        onAction={() => {}}
        onTidy={() => seen.push('tidy')}
        onTidyPreview={(on) => seen.push(on ? 'show' : 'hide')}
      />
    );
    const tidy = document.querySelector('[data-testid="edit-tidy"]') as HTMLElement;
    await act(async () => {
      tidy.dispatchEvent(new window.PointerEvent('pointerover', { bubbles: true }));
      tidy.dispatchEvent(new window.PointerEvent('pointerout', { bubbles: true }));
      tidy.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
      tidy.dispatchEvent(new window.FocusEvent('focusout', { bubbles: true }));
      tidy.click();
    });
    expect(seen).toEqual(['show', 'hide', 'show', 'hide', 'tidy']);
  });
});

describe('p8-c7-cf08 — no bar over boards of different kinds (08 ak-mixed-select)', () => {
  const rects = [
    { id: 'ig', kind: 'digital' },
    { id: 'karta', kind: 'print' },
    { id: 'story', kind: 'digital' },
  ];
  test('the inspector aligns them; one kind keeps the bar', () => {
    expect(boardsMixKinds([{ artboardId: 'ig' }, { artboardId: 'karta' }], rects)).toBe(true);
    expect(boardsMixKinds([{ artboardId: 'ig' }, { artboardId: 'story' }], rects)).toBe(false);
  });
  test('an element picked inside a board does not count as the board', () => {
    expect(boardsMixKinds([{ id: 'x', artboardId: 'karta' }, { artboardId: 'ig' }], rects)).toBe(
      false
    );
  });
});

describe('the preview', () => {
  test('shows every selected board where it would sit — one row on the lowest line — and writes nothing', () => {
    const rects = tidyPreviewRects(STORIES);
    expect(rects.map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(new Set(rects.map((r) => r.y))).toEqual(new Set([222]));
    expect(tidyPreviewRects([STORIES[0] as BoardRect])).toEqual([]);
  });

  test('dashed outlines at the world→screen projection; none when the store is empty', async () => {
    await mount(<TidyGhosts rects={tidyPreviewRects(STORIES)} vp={{ x: 10, y: 20, zoom: 0.2 }} />);
    const ghosts = Array.from(document.querySelectorAll('[data-testid="edit-tidy-ghost"]'));
    expect(ghosts.length).toBe(4);
    const first = ghosts[0] as HTMLElement;
    expect(first.style.left).toBe('40px'); // 10 + 150 * 0.2
    expect(first.style.top).toBe(`${20 + 222 * 0.2}px`);
    expect(first.style.width).toBe(`${216 * 0.2}px`);
    expect(tidyPreviewStore.get()).toBeNull();
  });

  test('the store notifies and clears', () => {
    const calls: number[] = [];
    const off = tidyPreviewStore.subscribe(() => calls.push(tidyPreviewStore.get()?.length ?? 0));
    tidyPreviewStore.set(STORIES);
    tidyPreviewStore.set(null);
    off();
    expect(calls).toEqual([4, 0]);
  });
});

describe('Tidy is one commit through the bus', () => {
  test('one commitPositions with the moves and the undo line; an already tidy row commits nothing', () => {
    const calls: { moved: { id: string; x: number; y: number }[]; label?: string }[] = [];
    const bus = {
      commitPositions: (moved: never, opts?: { label?: string }) =>
        calls.push({ moved, label: opts?.label }),
    };
    expect(tidyBoards(STORIES, bus)).toBe(true);
    expect(calls.length).toBe(1);
    expect(calls[0]?.label).toBe('tidy up 4 artboards');
    expect(calls[0]?.moved.every((m) => m.y === 222)).toBe(true);
    // feed the result back: nothing left to do
    const tidied = STORIES.map((r) => ({
      ...r,
      ...(calls[0]?.moved.find((m) => m.id === r.id) ?? {}),
    }));
    expect(tidyBoards(tidied, bus)).toBe(false);
    expect(calls.length).toBe(1);
  });

  test('the positions are the layout lane’s: nothing here names the per-user camera file', async () => {
    const fs = await import('node:fs');
    for (const f of [
      '../editing/arrange.ts',
      '../edit-ops/tidy.ts',
      '../editing/tidy-preview.tsx',
    ]) {
      const src = fs.readFileSync(new URL(f, import.meta.url), 'utf8');
      expect(src, f).not.toMatch(/view\.json|_canvas-state\//);
    }
  });
});

describe('the registry id is wired', () => {
  test('artboard.tidy is a registry action, run by the editing layer', () => {
    expect(TIDY_ACTION).toBe('artboard.tidy');
    expect(ACTIONS_BY_ID.has('artboard.tidy')).toBe(true);
    expect((EDITING_ACTIONS as readonly string[]).includes('artboard.tidy')).toBe(true);
    const def = ACTIONS_BY_ID.get('artboard.tidy');
    expect(def?.enabled?.selection).toEqual(['artboard']);
  });
});

describe('guides chrome of one drag in flight', () => {
  const drag = {
    leaderRect: { x: 3480, y: 0, w: 1080, h: 238 },
    others: [
      { x: 0, y: 0, w: 1080, h: 238 },
      { x: 1160, y: 0, w: 1080, h: 238 },
      { x: 2320, y: 0, w: 1080, h: 238 },
    ],
    snap: {
      guides: [{ axis: 'y' as const, pos: 0, from: 140, to: 3718, kind: 'sibling' as const }],
    },
    cursorClientX: 500,
    cursorClientY: 300,
  };

  test('bubble "X 3480 · Y 0" beside the pointer; a soft bottom guide; the equal-gap chips say 80', async () => {
    await mount(<ArtboardGuidesView dragging={drag} vp={{ x: 0, y: 0, zoom: 0.2 }} />);
    expect(document.querySelector('[data-testid="edit-ab-bubble"]')?.textContent).toBe(
      'X 3480 · Y 0'
    );
    const soft = document.querySelectorAll('[data-testid="edit-ab-guide-soft"]');
    expect(soft.length).toBe(1);
    expect(soft[0]?.getAttribute('data-axis')).toBe('y');
    const gaps = Array.from(document.querySelectorAll('[data-testid="edit-ab-gap"]'));
    expect(gaps.map((g) => g.getAttribute('data-gap'))).toEqual(['80', '80', '80']);
    expect(gaps.every((g) => g.textContent === '80')).toBe(true);
  });

  test('the board in the air is lifted (and nothing in the chrome is the selection azure)', () => {
    expect(GUIDES_CSS).toMatch(/\.dc-artboard\.dc-dragging\s*\{\s*box-shadow:/);
    expect(GUIDES_CSS).not.toMatch(/accent/);
  });
});

describe('MultiArtboardToolbar is retired (D7, S2.9)', () => {
  test('the component and its style block are gone from the shell; the align bar is its home', async () => {
    const fs = await import('node:fs');
    const shell = fs.readFileSync(new URL('../canvas-shell.tsx', import.meta.url), 'utf8');
    expect(shell).not.toMatch(/function MultiArtboardToolbar/);
    expect(shell).not.toContain('MULTI_TOOLBAR_CSS');
    expect(shell).not.toContain('dc-multi-artboard-tb-css');
    // the v1 class stays on the bar over artboards (testid re-emitted, nothing deleted)
    await mount(
      <AlignBarView
        model={{ kind: 'artboards', count: 4, label: '4 artboards' }}
        onAction={() => {}}
      />
    );
    expect(document.querySelector('.dc-multi-artboard-tb')).not.toBeNull();
  });

  test('a multi-selection’s parent box carries eight marks', async () => {
    const fs = await import('node:fs');
    const shell = fs.readFileSync(new URL('../canvas-shell.tsx', import.meta.url), 'utf8');
    expect(shell).toMatch(
      /GROUP_TICK_CLASSES = \[\.\.\.TICK_CLASSES, 'tick-t', 'tick-r', 'tick-b', 'tick-l'\]/
    );
    expect(shell).toMatch(/\{GROUP_TICK_CLASSES\.map/);
  });
});

// p8-sweep-advanced — Align top / middles / bottom over boards that already share the edge changed nothing and said
// nothing (the dead-control crawl clicked all three): the click now says so, the way Tidy up does.
describe('Align / Distribute over artboards that need no move', () => {
  const ROW: BoardRect[] = [
    { id: 'a', x: 0, y: 0, w: 640, h: 400 },
    { id: 'b', x: 700, y: 0, w: 640, h: 400 },
  ];
  const run = (action: string, rects: BoardRect[]) => {
    const said: string[] = [];
    const commits: unknown[] = [];
    const moved = arrangeBoardsOrSay(
      action as never,
      rects,
      { commitPositions: (m) => commits.push(m) },
      (line) => said.push(line)
    );
    return { moved, said, commits };
  };

  test('boards already level: Align top says so and commits nothing', () => {
    for (const action of ['align.top', 'align.vmiddle', 'align.bottom']) {
      const r = run(action, ROW);
      expect(r.moved, action).toBe(false);
      expect(r.commits, action).toEqual([]);
      expect(r.said, action).toEqual(['Already aligned.']);
    }
  });

  test('boards that do need to move: one commit, nothing said', () => {
    const r = run('align.left', ROW);
    expect(r.moved).toBe(true);
    expect(r.commits).toHaveLength(1);
    expect(r.said).toEqual([]);
  });

  test('evenly spaced boards: Distribute says so', () => {
    const three: BoardRect[] = [
      { id: 'a', x: 0, y: 0, w: 100, h: 100 },
      { id: 'b', x: 200, y: 0, w: 100, h: 100 },
      { id: 'c', x: 400, y: 0, w: 100, h: 100 },
    ];
    const r = run('distribute.h', three);
    expect(r.moved).toBe(false);
    expect(r.said).toEqual(['Already evenly spaced.']);
  });
});
