// S2.7 (artboard ed-obj-multi) — the canvas half of multi-select: which bar a selection gets, how
// objects are measured, what the artboard path commits (through the bus, so annotations ride
// along), the guide, the rotate maths (⇧ snaps to 15°), and the bar / handle on a real tree. The
// writers are test/edit-ops-arrange.test.ts.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import type { EditOpResult } from '../edit-ops/types.ts';
import { AlignBar, AlignBarView } from '../editing/align-bar.tsx';
import {
  ARRANGE_ACTIONS,
  alignGuide,
  arrangeArtboards,
  artboardMoves,
  barModel,
  FREE_PLACEMENT_LINE,
  isArrangeAction,
  itemFrom,
  measureTargets,
  minimumFor,
  NOT_ENOUGH_LINE,
  objectTargets,
  placementOf,
  runArrange,
} from '../editing/arrange.ts';
import { RotateHandle, rotateAsk, turnTo } from '../editing/rotate-handle.tsx';
import { type Selection, SelectionSetProvider, useSelectionSet } from '../use-selection-set.tsx';

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

const obj = (id: string, artboardId = 'post'): Selection => ({
  id,
  artboardId,
  selector: `[data-cd-id="${id}"]`,
});
const board = (artboardId: string): Selection => ({
  artboardId,
  selector: `[data-dc-screen="${artboardId}"]`,
});

describe('which bar a selection gets', () => {
  test('2+ objects: "N objects"; 2+ artboards: "N artboards"; never one, never a mix', () => {
    expect(barModel([obj('a'), obj('b'), obj('c')])).toEqual({
      kind: 'objects',
      count: 3,
      label: '3 objects',
    });
    expect(barModel([board('a'), board('b'), board('c'), board('d')])).toEqual({
      kind: 'artboards',
      count: 4,
      label: '4 artboards',
    });
    expect(barModel([obj('a')])).toBeNull();
    expect(barModel([board('a')])).toBeNull();
    expect(barModel([obj('a'), board('b')])).toBeNull();
    expect(barModel([])).toBeNull();
  });
});

describe('the registry rows', () => {
  test('every arrange action and object.rotate is a canvas action for Can edit, with no chord', () => {
    for (const id of [...ARRANGE_ACTIONS, 'object.rotate']) {
      const def = ACTIONS_BY_ID.get(id as never);
      expect(def, id).toBeTruthy();
      expect(def?.exec).toBe('canvas');
      expect(def?.enabled?.minRole).toBe('edit');
      expect(def?.keys ?? []).toEqual([]);
    }
    expect(isArrangeAction('align.left')).toBe(true);
    expect(isArrangeAction('object.lock')).toBe(false);
    expect(minimumFor('align.top')).toBe(2);
    expect(minimumFor('distribute.h')).toBe(3);
  });
});

describe('measuring objects', () => {
  test('only objects placed freely can be aligned', () => {
    expect(placementOf({ position: 'absolute', left: '64px', top: '100px' })).toEqual({
      left: 64,
      top: 100,
    });
    expect(placementOf({ position: 'fixed', left: '0px', top: '8px' })).toEqual({
      left: 0,
      top: 8,
    });
    expect(placementOf({ position: 'static', left: 'auto', top: 'auto' })).toBeNull();
    expect(placementOf({ position: 'relative', left: '4px', top: '4px' })).toBeNull();
    expect(placementOf({ position: 'absolute', left: 'auto', top: '4px' })).toBeNull();
  });

  test('a box is the screen rect over the zoom, left / top stay as they are', () => {
    expect(
      itemFrom({ left: 128, top: 64, width: 200, height: 80 }, 0.5, { left: 10, top: 20 })
    ).toEqual({
      x: 256,
      y: 128,
      w: 400,
      h: 160,
      left: 10,
      top: 20,
    });
    expect(itemFrom({ left: 5, top: 5, width: 5, height: 5 }, 0, { left: 1, top: 2 }).x).toBe(5);
  });

  function tree(extra = '') {
    document.body.innerHTML = `
      <article class="dc-artboard" data-dc-screen="post"><div class="dc-artboard-body">
        <h1 data-cd-id="title" style="position:absolute;left:64px;top:100px">Titulek</h1>
        <p data-cd-id="sub" style="position:absolute;left:70px;top:200px">Podtitulek</p>
        ${extra}
      </div></article>`;
    const rect = (l: number, t: number, w: number, h: number) => () =>
      ({ left: l, top: t, right: l + w, bottom: t + h, width: w, height: h }) as DOMRect;
    (q('title') as HTMLElement).getBoundingClientRect = rect(64, 100, 900, 80);
    (q('sub') as HTMLElement).getBoundingClientRect = rect(70, 200, 600, 40);
    return [obj('title'), obj('sub')];
  }
  const q = (id: string) => document.querySelector(`[data-cd-id="${id}"]`) as HTMLElement;

  test('objectTargets pairs each selection with its element and ref, skipping artboards', () => {
    const sel = [...tree(), board('post')];
    const ts = objectTargets(sel, document);
    expect(ts.map((t) => t.ref)).toEqual([
      { artboard: 'post', element: 'title' },
      { artboard: 'post', element: 'sub' },
    ]);
  });

  test('measureTargets reads left / top and the visual box', () => {
    const m = measureTargets(objectTargets(tree(), document));
    expect(m).toEqual({
      ok: true,
      items: [
        { x: 64, y: 100, w: 900, h: 80, left: 64, top: 100 },
        { x: 70, y: 200, w: 600, h: 40, left: 70, top: 200 },
      ],
    });
  });

  test('one object in a layout refuses the whole align, in words that name the way out', () => {
    const sel = [...tree('<span data-cd-id="flow">in a layout</span>'), obj('flow')];
    const m = measureTargets(objectTargets(sel, document));
    expect(m).toEqual({ ok: false, message: FREE_PLACEMENT_LINE });
    expect(FREE_PLACEMENT_LINE).toContain('Advanced');
  });
});

describe('runArrange', () => {
  const REFS = [
    { artboard: 'post', element: 'title' },
    { artboard: 'post', element: 'sub' },
  ];
  const ITEMS = [
    { x: 64, y: 100, w: 900, h: 80, left: 64, top: 100 },
    { x: 70, y: 200, w: 600, h: 40, left: 70, top: 200 },
  ];
  const okResult = (actionId: string | null): EditOpResult => ({
    ok: true,
    actionId,
    writeId: 'w_1',
    rev: 'r',
    refs: REFS,
  });

  test('asks for the action with the measured items; a legacy link records one revert', async () => {
    const asked: unknown[] = [];
    const records: unknown[] = [];
    const r = await runArrange('align.left', REFS, ITEMS, {
      run: async (ask) => {
        asked.push(ask);
        return okResult(null);
      },
      record: (rec) => records.push(rec),
    });
    expect(r?.ok).toBe(true);
    expect(asked).toEqual([{ op: 'align.left', targets: REFS, params: { items: ITEMS } }]);
    expect(records).toHaveLength(1);
    expect((records[0] as { label: string }).label).toBe('Align left');
  });

  test('with a kernel action id nothing is recorded here (S5 owns the undo)', async () => {
    const records: unknown[] = [];
    await runArrange('distribute.h', REFS, ITEMS, {
      run: async () => okResult('act_9'),
      record: (rec) => records.push(rec),
    });
    expect(records).toEqual([]);
  });

  test('a refusal is one toast in the server’s words, and nothing is recorded', async () => {
    const toasts: string[] = [];
    const records: unknown[] = [];
    const r = await runArrange('align.top', REFS, ITEMS, {
      run: async () => ({ ok: false, code: 'locked', message: 'Logo is locked · ⇧⌘L unlocks' }),
      toast: (m) => toasts.push(m),
      record: (rec) => records.push(rec),
    });
    expect(r?.ok).toBe(false);
    expect(toasts).toEqual(['Logo is locked · ⇧⌘L unlocks']);
    expect(records).toEqual([]);
  });
});

describe('the guide that says where things landed', () => {
  const shots = [
    { left: 164, top: 200, right: 1064, bottom: 280 },
    { left: 170, top: 300, right: 770, bottom: 340 },
  ];
  const origin = { left: 100, top: 150 };
  test('align left: a vertical line at the leftmost edge, chip with the place in the artboard', () => {
    expect(alignGuide('align.left', shots, 1, origin)).toEqual({
      axis: 'x',
      at: 164,
      from: 200,
      to: 340,
      chip: 'X 64',
    });
  });
  test('align right / centre, top / middle / bottom', () => {
    expect(alignGuide('align.right', shots, 1, origin)?.chip).toBe('X 964');
    expect(alignGuide('align.hcentre', shots, 1, origin)?.chip).toBe('X 514');
    expect(alignGuide('align.top', shots, 1, origin)).toMatchObject({
      axis: 'y',
      at: 200,
      chip: 'Y 50',
    });
    expect(alignGuide('align.vmiddle', shots, 1, origin)?.chip).toBe('Y 120');
    expect(alignGuide('align.bottom', shots, 1, origin)?.chip).toBe('Y 190');
  });
  test('zoom is divided out; distribute has no guide', () => {
    expect(alignGuide('align.left', shots, 0.5, origin)?.chip).toBe('X 128');
    expect(alignGuide('distribute.h', shots, 1, origin)).toBeNull();
  });
});

describe('artboards go through the bus', () => {
  const boards = [
    { id: 'a', x: 0, y: 0, w: 100, h: 50 },
    { id: 'b', x: 130, y: 60, w: 100, h: 50 },
    { id: 'c', x: 400, y: 300, w: 100, h: 50 },
  ];
  test('align goldens: only the named axis moves, only the boards that change', () => {
    expect(artboardMoves('align.left', boards)).toEqual([
      { id: 'b', x: 0, y: 60 },
      { id: 'c', x: 0, y: 300 },
    ]);
    expect(artboardMoves('align.bottom', boards)).toEqual([
      { id: 'a', x: 0, y: 300 },
      { id: 'b', x: 130, y: 300 },
    ]);
    expect(artboardMoves('align.hcentre', boards).map((m) => m.x)).toEqual([200, 200, 200]);
  });
  test('distribute keeps the first and last, and never touches the other axis', () => {
    expect(artboardMoves('distribute.h', boards)).toEqual([{ id: 'b', x: 200, y: 60 }]);
    expect(artboardMoves('distribute.v', boards)).toEqual([{ id: 'b', x: 130, y: 150 }]);
  });
  test('one commitPositions call with the undo label; nothing when nothing moves or too few', () => {
    const calls: unknown[][] = [];
    const bus = { commitPositions: (...a: unknown[]) => void calls.push(a) };
    expect(arrangeArtboards('align.left', boards, bus)).toBe(true);
    expect(calls).toHaveLength(1);
    expect((calls[0] as [unknown, { label: string }])[1].label).toBe('align left 3 artboards');
    expect(arrangeArtboards('distribute.h', boards, bus)).toBe(true);
    expect((calls[1] as [unknown, { label: string }])[1].label).toBe('equal-space 3 artboards');
    expect(arrangeArtboards('distribute.h', boards.slice(0, 2), bus)).toBe(false);
    expect(arrangeArtboards('align.left', [boards[0], { ...boards[1], x: 0 }], bus)).toBe(false);
    expect(calls).toHaveLength(2);
  });
});

describe('rotate', () => {
  const rad = (deg: number) => (deg * Math.PI) / 180;
  test('⇧ snaps to 15°; without it the angle is a whole degree', () => {
    expect(turnTo(0, 0, rad(17.4), false)).toBe(17);
    expect(turnTo(0, 0, rad(17.4), true)).toBe(15);
    expect(turnTo(0, 0, rad(25.8), true)).toBe(30);
    expect(turnTo(10, rad(40), rad(40), true)).toBe(15);
    expect(turnTo(0, 0, rad(-97), true)).toBe(-90);
  });
  test('one object turns TO an angle, several turn BY the same angle', () => {
    expect(rotateAsk(1, 10, 45)).toEqual({ op: 'object.rotate', params: { degrees: 45 } });
    expect(rotateAsk(3, 0, 30)).toEqual({ op: 'object.rotate', params: { by: 30 } });
    expect(rotateAsk(2, 170, -170)).toEqual({ op: 'object.rotate', params: { by: 20 } });
  });
});

describe('the bar and the handle on a tree', () => {
  function Probe({ set }: { set: (v: ReturnType<typeof useSelectionSet>) => void }) {
    set(useSelectionSet());
    return null;
  }
  async function mount(ui: React.ReactNode) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(ui));
  }

  test('the view says "3 objects", has a tooltip on every button and Tidy on none', async () => {
    const clicked: string[] = [];
    await mount(
      <AlignBarView
        model={{ kind: 'objects', count: 3, label: '3 objects' }}
        onAction={(a) => clicked.push(a)}
      />
    );
    const bar = document.querySelector('[data-testid="edit-align-bar"]') as HTMLElement;
    expect(bar.className).toContain('dc-elem-ctx-tb');
    expect(document.querySelector('[data-testid="edit-align-count"]')?.textContent).toBe(
      '3 objects'
    );
    const buttons = Array.from(bar.querySelectorAll('button'));
    expect(buttons.map((b) => b.getAttribute('data-tip'))).toEqual([
      'Align left',
      'Align horizontal centres',
      'Align right',
      'Align top',
      'Align vertical middles',
      'Align bottom',
      'Distribute horizontally',
      'Distribute vertically',
    ]);
    expect(bar.textContent).not.toContain('Tidy');
    await act(async () =>
      (document.querySelector('[data-testid="edit-align-left"]') as HTMLElement).click()
    );
    expect(clicked).toEqual(['align.left']);
  });

  test('two objects: distribute is off and says why; artboards re-emit the v1 toolbar class', async () => {
    await mount(
      <AlignBarView
        model={{ kind: 'artboards', count: 2, label: '2 artboards' }}
        onAction={() => {}}
      />
    );
    const d = document.querySelector('[data-testid="edit-distribute-h"]') as HTMLButtonElement;
    expect(d.disabled).toBe(true);
    expect(d.getAttribute('data-tip')).toBe(NOT_ENOUGH_LINE);
    expect(
      (document.querySelector('[data-testid="edit-align-left"]') as HTMLButtonElement).disabled
    ).toBe(false);
    expect(document.querySelector('[data-testid="edit-align-bar"]')?.className).toContain(
      'dc-multi-artboard-tb'
    );
  });

  test('the live bar follows the selection, and a read-only canvas gets none', async () => {
    document.body.innerHTML = `
      <article class="dc-artboard" data-dc-screen="post"><div class="dc-artboard-body">
        <i data-cd-id="a" style="position:absolute;left:0;top:0"></i>
        <i data-cd-id="b" style="position:absolute;left:5px;top:0"></i>
      </div></article>`;
    let sel: ReturnType<typeof useSelectionSet> | null = null;
    const tree = (readOnly: boolean) => (
      <SelectionSetProvider postTarget={{ postMessage() {} }}>
        <Probe set={(v) => (sel = v)} />
        <AlignBar readOnly={readOnly} />
        <RotateHandle readOnly={readOnly} />
      </SelectionSetProvider>
    );
    await mount(tree(false));
    expect(document.querySelector('[data-testid="edit-align-bar"]')).toBeNull();
    expect(document.querySelector('[data-testid="edit-rotate-handle"]')).not.toBeNull();
    await act(async () =>
      (sel as unknown as ReturnType<typeof useSelectionSet>).replace([obj('a'), obj('b')])
    );
    expect(document.querySelector('[data-testid="edit-align-count"]')?.textContent).toBe(
      '2 objects'
    );
    await act(async () => (sel as unknown as ReturnType<typeof useSelectionSet>).clear());
    expect(document.querySelector('[data-testid="edit-align-bar"]')).toBeNull();
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
    await mount(tree(true));
    expect(document.querySelector('[data-testid="edit-align-bar"]')).toBeNull();
    expect(document.querySelector('[data-testid="edit-rotate-handle"]')).toBeNull();
  });
});

describe('ContextualToolbar is retired (D7)', () => {
  test('the canvas shell mounts neither v1 toolbar for multi-selection; the editing layer mounts the bar', async () => {
    const fs = await import('node:fs');
    const shell = fs.readFileSync(new URL('../canvas-shell.tsx', import.meta.url), 'utf8');
    expect(shell).not.toContain('<ContextualToolbar');
    expect(shell).not.toContain("from './contextual-toolbar.tsx'");
    expect(fs.existsSync(new URL('../contextual-toolbar.tsx', import.meta.url))).toBe(false);
    const layer = fs.readFileSync(new URL('../editing/index.tsx', import.meta.url), 'utf8');
    expect(layer).toContain('<AlignBar');
    expect(layer).toContain('<RotateHandle');
  });
});
