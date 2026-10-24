// S2.10 (artboard ed-ab-menu) — the canvas half: the artboard's own menu, ⌘D's gap rhythm, the ⌥-drag drop that
// copies, "Duplicate at another width", and the rename field that moves on with Tab. The server half (the copy's
// bytes, ids, labels, the layout lane) is v2-artboard-duplicate-op.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import type { ContextTarget, MenuItem, MenuSection } from '../context-menu.tsx';
import type { EditOpResult } from '../edit-ops/types.ts';
import {
  CUSTOM_WIDTH_EVENT,
  defaultSlots,
  duplicatePlaces,
  writeCopies,
} from '../editing/artboard-actions.ts';
import { ArtboardCommands, parseWidth, resolveArtboardKey } from '../editing/artboard-commands.tsx';
import { type ArtboardMenuDeps, artboardMenuSections } from '../editing/artboard-menu.tsx';
import {
  type Box,
  copyPlace,
  DEFAULT_GAP,
  DUPLICATE_ON_DROP_EVENT,
  dropPlaces,
  pinsFor,
  routeDrop,
  rowGap,
} from '../editing/duplicate-rhythm.ts';
import { EDITING_ACTIONS } from '../editing/index.tsx';
import { growCh, nextRenameId, renameOrder } from '../editing/rename-order.ts';
import { SelectionSetProvider } from '../use-selection-set.tsx';

const box = (id: string, x: number, y: number, w = 120, h = 131): Box => ({ id, x, y, w, h });

describe('⌘D lands at the gap the row already uses', () => {
  test('a row with a 16 px gap: the copy goes right of the source at 16', () => {
    const row = [box('a', 0, 0), box('b', 136, 0)];
    expect(rowGap(row[1] as Box, row)).toBe(16);
    expect(copyPlace(row[1] as Box, row)).toEqual({ x: 272, y: 0 });
  });

  test('press again: the copy of the copy keeps the same rhythm', () => {
    const first = [box('a', 0, 0), box('b', 136, 0)];
    const second = [...first, box('c', 272, 0)];
    expect(copyPlace(second[2] as Box, second)).toEqual({ x: 408, y: 0 });
  });

  test('the first copy of a lone board uses the default grid gutter', () => {
    const lone = [box('a', 22, 70)];
    expect(rowGap(lone[0] as Box, lone)).toBe(DEFAULT_GAP);
    expect(copyPlace(lone[0] as Box, lone)).toEqual({ x: 22 + 120 + DEFAULT_GAP, y: 70 });
  });

  test('the first board of a row looks at its right neighbour for the gap', () => {
    const row = [box('a', 0, 0), box('b', 150, 0)];
    expect(rowGap(row[0] as Box, row)).toBe(30);
  });

  test('a board in another row does not set the gap; one in the way pushes the copy past it', () => {
    const all = [box('a', 0, 0), box('far', 130, 400), box('b', 140, 0)];
    expect(rowGap(all[0] as Box, all)).toBe(20); // b is the right neighbour; "far" sits in another row
    // copy of a: right of a at 20 is x=140, where b stands → past b, at b's right edge + 20
    expect(copyPlace(all[0] as Box, all)).toEqual({ x: 140 + 120 + 20, y: 0 });
  });

  test('copies of several boards do not land on each other', () => {
    const boards = [box('a', 0, 0), box('b', 200, 0)];
    const places = duplicatePlaces(['a', 'b'], boards);
    expect(places.map((p) => p.artboard)).toEqual(['a', 'b']);
    const xs = places.map((p) => p.at.x);
    expect(new Set(xs).size).toBe(2);
    // a's copy skips b (it stands where the copy would), b's copy lands right of b's right edge
    expect(places[1]?.at.x).toBeGreaterThanOrEqual(200 + 120);
  });

  test('a copy at another width is placed with that width (it clears the next board)', () => {
    const boards = [box('a', 0, 0, 1440, 900), box('b', 1520, 0, 1440, 900)];
    const [p] = duplicatePlaces(['a'], boards, 390);
    // right of a at the 80 gap is x=1520, where b stands: pushed past b
    expect(p?.at.x).toBeGreaterThanOrEqual(1520 + 1440);
  });

  test('pins every board at its drawn place (the server fills only the missing ones)', () => {
    expect(pinsFor([box('a', 0.4, 1), box('b', 5, 6)], new Set(['a']))).toEqual([
      { id: 'b', x: 5, y: 6 },
    ]);
    expect(pinsFor([box('a', 0.4, 1)], new Set())).toEqual([{ id: 'a', x: 0, y: 1 }]);
  });
});

describe('the ⌥-drag drop', () => {
  const moved = [{ id: 'a', x: 300.4, y: 20 }];

  test('a copy lands exactly at the drop place', () => {
    expect(dropPlaces(moved)).toEqual([{ artboard: 'a', at: { x: 300, y: 20 } }]);
  });

  test('an ⌥ drop asks the editing layer; when it takes it, the originals do not move', () => {
    const target = new EventTarget();
    target.addEventListener(DUPLICATE_ON_DROP_EVENT, (e) => e.preventDefault());
    const commits: unknown[] = [];
    expect(routeDrop(true, moved, target, (m, o) => commits.push([m, o]))).toBe('duplicated');
    expect(commits).toEqual([]);
  });

  test('an ⌥ drop with nothing listening is the v1 move, without riders', () => {
    const commits: unknown[] = [];
    expect(routeDrop(true, moved, new EventTarget(), (m, o) => commits.push([m, o]))).toBe('moved');
    expect(commits).toEqual([[moved, { riders: false }]]);
  });

  test('a plain drop moves and asks nobody', () => {
    const target = new EventTarget();
    let asked = false;
    target.addEventListener(DUPLICATE_ON_DROP_EVENT, () => {
      asked = true;
    });
    const commits: unknown[] = [];
    expect(routeDrop(false, moved, target, (m, o) => commits.push([m, o]))).toBe('moved');
    expect(asked).toBe(false);
    expect(commits).toEqual([[moved, undefined]]);
  });
});

describe('one request writes the copy', () => {
  const ok = (extra: Partial<Extract<EditOpResult, { ok: true }>> = {}): EditOpResult => ({
    ok: true,
    actionId: null,
    writeId: 'w1',
    rev: 'r',
    refs: [],
    created: [{ artboard: 'a-2', element: 'a-2' }],
    ...extra,
  });
  const boards = () => [box('a', 0, 0), box('b', 200, 0)];

  test('artboard.duplicate: items with their places, every board pinned, the copy selected', async () => {
    const asks: unknown[] = [];
    const selected: string[][] = [];
    const recorded: unknown[] = [];
    await writeCopies([{ artboard: 'a', at: { x: 400, y: 0 } }], {
      run: async (ask) => {
        asks.push(ask);
        return ok();
      },
      record: (r) => recorded.push(r),
      select: (ids) => selected.push(ids),
      boards,
    });
    expect(asks).toEqual([
      {
        op: 'artboard.duplicate',
        targets: [],
        params: {
          items: [{ artboard: 'a', at: { x: 400, y: 0 } }],
          pin: [
            { id: 'a', x: 0, y: 0 },
            { id: 'b', x: 200, y: 0 },
          ],
        },
      },
    ]);
    expect(selected).toEqual([['a-2']]);
    // no kernel action id (a legacy link / unlinked project) → ONE revert record
    expect(recorded.length).toBe(1);
  });

  test('with a kernel action id S5 owns the undo: nothing is recorded here', async () => {
    const recorded: unknown[] = [];
    await writeCopies([{ artboard: 'a', at: { x: 1, y: 2 } }], {
      run: async () => ok({ actionId: 'act_1' }),
      record: (r) => recorded.push(r),
      boards,
    });
    expect(recorded).toEqual([]);
  });

  test('at another width the op and the width ride together', async () => {
    const asks: Array<{ op: string; params?: { items: Array<Record<string, unknown>> } }> = [];
    await writeCopies(
      [{ artboard: 'a', at: { x: 400, y: 0 } }],
      {
        run: async (ask) => {
          asks.push(ask);
          return ok();
        },
        boards,
      },
      390
    );
    expect(asks[0]?.op).toBe('artboard.duplicate-at-width');
    expect(asks[0]?.params?.items[0]).toEqual({ artboard: 'a', at: { x: 400, y: 0 }, width: 390 });
  });

  test('a refusal is one plain toast and nothing is selected or recorded', async () => {
    const toasts: string[] = [];
    const selected: string[][] = [];
    const r = await writeCopies([{ artboard: 'a', at: { x: 1, y: 2 } }], {
      run: async () => ({ ok: false, code: 'forbidden', message: 'You can look, not edit.' }),
      toast: (m) => toasts.push(m),
      select: (ids) => selected.push(ids),
      boards,
    });
    expect(r?.ok).toBe(false);
    expect(toasts).toEqual(['You can look, not edit.']);
    expect(selected).toEqual([]);
  });

  test('nothing to copy sends nothing', async () => {
    let sent = false;
    await writeCopies([], {
      run: async () => {
        sent = true;
        return ok();
      },
      boards,
    });
    expect(sent).toBe(false);
  });
});

describe('Reset position', () => {
  test('a board goes back to its default-grid slot (the rows of 3 the canvas starts with)', () => {
    const boards = Array.from({ length: 4 }, (_, i) => box(`b${i}`, 9999, 9999, 400, 300));
    const slots = defaultSlots(boards);
    expect(slots.get('b0')).toEqual({ x: 0, y: 0 });
    expect(slots.get('b1')).toEqual({ x: 480, y: 0 });
    expect(slots.get('b3')).toEqual({ x: 0, y: 380 });
  });
});

describe('rename in place: Tab follows the rows', () => {
  // file order is NOT reading order: c is in the file first but sits in the second row
  const boards = [
    box('c', 0, 400, 100, 100),
    box('b', 140, 6, 100, 100),
    box('a', 0, 0, 100, 100),
    box('d', 140, 410, 100, 100),
  ];

  test('rows top to bottom, each left to right', () => {
    expect(renameOrder(boards)).toEqual(['a', 'b', 'c', 'd']);
  });

  test('Tab goes to the next name, ⇧Tab back; the ends stop', () => {
    expect(nextRenameId(boards, 'a')).toBe('b');
    expect(nextRenameId(boards, 'b')).toBe('c');
    expect(nextRenameId(boards, 'c', true)).toBe('b');
    expect(nextRenameId(boards, 'd')).toBeNull();
    expect(nextRenameId(boards, 'a', true)).toBeNull();
    expect(nextRenameId(boards, 'missing')).toBeNull();
  });

  test('the field is as wide as the whole name — a long Czech one with its háčky', () => {
    expect(growCh('Post 1:1 · Combine v číslech — finále')).toBe(
      'Post 1:1 · Combine v číslech — finále'.length + 2
    );
    expect(growCh('')).toBe(8);
    expect(growCh('x'.repeat(200))).toBeLessThanOrEqual(82);
  });
});

describe('Custom width…', () => {
  test('a typed width is a whole number inside what the server clamps to; text is not a width', () => {
    expect(parseWidth('1100')).toBe(1100);
    expect(parseWidth(' 800.4 ')).toBe(800);
    expect(parseWidth('5')).toBe(64);
    expect(parseWidth('99999')).toBe(8192);
    expect(parseWidth('wide')).toBeNull();
    expect(parseWidth('')).toBeNull();
  });
});

describe('the registry rows and the chord', () => {
  const IDS = [
    'artboard.duplicate',
    'artboard.duplicate-at-width',
    'artboard.rename',
    'artboard.reset-position',
    'artboard.ask-ai',
  ] as const;

  test('every action is registered for Can edit on an artboard selection, with an agent path', () => {
    for (const id of IDS) {
      const def = ACTIONS_BY_ID.get(id);
      expect(def, id).toBeDefined();
      expect(def?.enabled?.minRole, id).toBe('edit');
      expect(def?.enabled?.selection, id).toEqual(['artboard']);
      expect(AGENT_PATHS[id], id).toBeDefined();
    }
  });

  test('the editing layer runs the canvas ones', () => {
    for (const id of IDS.filter((i) => i !== 'artboard.ask-ai'))
      expect((EDITING_ACTIONS as readonly string[]).includes(id), id).toBe(true);
  });

  test('⌘D is artboard.duplicate on an artboard selection in Edit mode, and only there', () => {
    const e = { key: 'd', metaKey: true, ctrlKey: false, altKey: false, shiftKey: false };
    const base = { typing: false, mode: 'edit' as const, selection: 'artboard' as const };
    expect(resolveArtboardKey(e, base)).toBe('artboard.duplicate');
    expect(resolveArtboardKey(e, { ...base, selection: 'object' })).toBeNull();
    expect(resolveArtboardKey(e, { ...base, selection: 'none' })).toBeNull();
    expect(resolveArtboardKey(e, { ...base, mode: 'preview' })).toBeNull();
    expect(resolveArtboardKey(e, { ...base, typing: true })).toBeNull();
  });

  test('the object chord is untouched: ⌘D on an object stays object.duplicate', () => {
    const def = ACTIONS_BY_ID.get('object.duplicate');
    expect(def?.keys?.[0]?.when?.selection).toEqual(['object']);
  });
});

describe('the artboard menu', () => {
  const noop = () => {};
  const item = (id: string, label: string, extra: Partial<MenuItem> = {}): MenuItem => ({
    id,
    label,
    onSelect: noop,
    ...extra,
  });
  // the v1 sections canvas-shell builds for `artboard-chrome`
  const v1: MenuSection[] = [
    [item('add-comment', 'Add comment', { shortcut: 'C' })],
    [
      item('fit-one', 'Fit just this artboard'),
      item('fit-view', 'Fit to view'),
      item('reset-view', 'Reset view'),
    ],
    [item('convert-artboard-absolute', 'Convert layout to absolute…')],
    [item('open-timeline', 'Open Timeline', { shortcut: '⌘⇧T' })],
    [item('align-left', 'Align left'), item('distribute-h', 'Distribute horizontally')],
    [
      item('theme', 'Theme', { submenu: [item('theme-light', 'Light')] }),
      item('kind', 'Kind', { submenu: [item('kind-web', 'Web')] }),
      item('duplicate-at-breakpoint', 'Duplicate at width…'),
    ],
    [item('delete-artboard', 'Delete artboard', { shortcut: '⌫', destructive: true })],
    [item('export-artboard', 'Export this artboard…')],
  ];
  const calls: string[] = [];
  const deps: ArtboardMenuDeps = {
    duplicate: () => calls.push('duplicate'),
    duplicateAtWidth: (_t, w) => calls.push(`width:${w}`),
    customWidth: () => calls.push('custom'),
    rename: () => calls.push('rename'),
    resetPosition: () => calls.push('reset'),
  };
  const sections = artboardMenuSections(v1, deps);
  const ids = (s: MenuSection) => s.map((i) => i.id);
  const target = { artboardId: 'desktop', clientX: 10, clientY: 20 } as ContextTarget;
  const find = (id: string): MenuItem => {
    for (const s of sections) {
      for (const i of s) {
        if (i.id === id) return i;
        const sub = typeof i.submenu === 'function' ? i.submenu(target) : i.submenu;
        const hit = sub?.find((x) => x.id === id);
        if (hit) return hit;
      }
    }
    throw new Error(`no row ${id}`);
  };

  test('the rows in the design’s order', () => {
    expect(sections.map(ids)).toEqual([
      ['ask-ai'],
      ['duplicate-artboard', 'duplicate-at-width', 'rename-artboard'],
      ['add-comment'],
      ['start-vote'], // S4.14
      ['export-artboard'],
      ['advanced'],
      ['delete-artboard'],
    ]);
  });

  test('Ask AI is drawn with ⌘/ and is live (S2.21: it opens the AI chat on this artboard)', () => {
    const ask = find('ask-ai');
    expect(ask.shortcut).toBe('⌘/');
    expect(ask.disabled).toBeUndefined();
    expect(ask.disabledHint).toBeUndefined();
  });

  test('Duplicate ⌘D, Rename, Export… ⇧⌘E and Move to trash ⌫ say their words', () => {
    expect(find('duplicate-artboard').label).toBe('Duplicate');
    expect(find('duplicate-artboard').shortcut).toBe('⌘D');
    expect(find('rename-artboard').label).toBe('Rename');
    expect(find('export-artboard').label).toBe('Export…');
    expect(find('export-artboard').shortcut).toBe('⇧⌘E');
    expect(find('delete-artboard').label).toBe('Move to trash');
    expect(find('delete-artboard').shortcut).toBe('⌫');
  });

  test('Duplicate at another width ▸ Laptop · Tablet · Mobile · Custom width…, each runs its width', () => {
    const sub = find('duplicate-at-width').submenu as MenuItem[];
    expect(sub.map((s) => s.label)).toEqual(['Laptop', 'Tablet', 'Mobile', 'Custom width…']);
    // 14 ed-ab-menu: the width sits right-aligned beside the name
    expect(sub.map((s) => s.shortcut)).toEqual(['1280', '834', '390', undefined]);
    calls.length = 0;
    for (const s of sub) s.onSelect(target);
    find('duplicate-artboard').onSelect(target);
    find('rename-artboard').onSelect(target);
    expect(calls).toEqual([
      'width:1280',
      'width:834',
      'width:390',
      'custom',
      'duplicate',
      'rename',
    ]);
  });

  test('Advanced ▸ keeps every v1 row that left the main list: nothing deleted', () => {
    const adv = (find('advanced').submenu as MenuItem[]).map((i) => i.id);
    expect(adv).toEqual([
      'fit-one',
      'reset-position',
      'fit-view',
      'reset-view',
      'convert-artboard-absolute',
      'open-timeline',
      'align-left',
      'distribute-h',
      'theme',
      'kind',
    ]);
    // the flyout it replaces is gone: one way to duplicate at a width
    const all = sections
      .flat()
      .flatMap((i) => [i.id, ...((i.submenu as MenuItem[]) ?? []).map((s) => s.id)]);
    expect(all).not.toContain('duplicate-at-breakpoint');
  });

  test('Reset position runs the reset', () => {
    calls.length = 0;
    find('reset-position').onSelect(target);
    expect(calls).toEqual(['reset']);
  });
});

// ── the Custom width… field, mounted for real ──────────────────────────────────────────────────────────

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

describe('Custom width… opens a field beside the pointer', () => {
  async function mount(readOnly = false) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () =>
      root.render(
        <SelectionSetProvider postTarget={null}>
          <ArtboardCommands readOnly={readOnly} />
        </SelectionSetProvider>
      )
    );
  }
  const open = async () =>
    act(async () => {
      window.dispatchEvent(
        new CustomEvent(CUSTOM_WIDTH_EVENT, { detail: { ids: ['desktop'], x: 312, y: 158 } })
      );
    });

  test('nothing on screen until the menu asks; then a "Width" field at the pointer', async () => {
    await mount();
    expect(document.querySelector('[data-testid="ab-custom-width"]')).toBeNull();
    await open();
    const form = document.querySelector('[data-testid="ab-custom-width"]') as HTMLElement;
    expect(form.style.left).toBe('312px');
    expect(form.style.top).toBe('158px');
    expect(form.textContent).toContain('Width');
    expect(form.textContent).toContain('↵ copy · esc');
    expect(document.querySelector('[data-testid="ab-custom-width-input"]')).not.toBeNull();
  });

  test('esc closes it; a read-only canvas never opens it', async () => {
    await mount();
    await open();
    const input = document.querySelector('[data-testid="ab-custom-width-input"]') as HTMLElement;
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(document.querySelector('[data-testid="ab-custom-width"]')).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    await mount(true);
    await open();
    expect(document.querySelector('[data-testid="ab-custom-width"]')).toBeNull();
  });
});
