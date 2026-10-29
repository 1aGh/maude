// p8-dead-reasons part 2 — "Version history of this object" (`history.object`): the object menu and the sticky
// menu get the row; it posts `dgn:'object-history'`; the shell checks the object is one the active frame showed
// it, then runs the registry action, which opens Version history filtered to that object.
import { afterEach, describe, expect, test } from 'bun:test';
import { c2sSpec } from '../bridge/dgn-protocol.ts';
import { historyScope, setHistoryOpener } from '../client/v2/history/object-filter.js';
import { objectHistoryTarget } from '../client/v2/history/object-history-ask.js';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { objectMenuSections } from '../editing/object-menu.tsx';

const PATH = '.design/Pricing.tsx';
const known = {
  activePath: PATH,
  selection: { file: PATH, sel: { file: PATH, id: 'hero-title', artboardId: 'desktop' } },
  layers: {
    canvas: PATH,
    artboardId: 'desktop',
    tree: [{ id: 'hero', children: [{ id: 'cta' }] }],
  },
  annotations: { file: PATH, ids: ['s_1a2b3c4d'] },
};

describe('the dgn row', () => {
  test('object-history is a c2s message the active frame may send, junk is dropped', () => {
    const spec = c2sSpec('object-history');
    expect(spec?.gate).toBe('active');
    expect(spec?.parse({ artboard: 'desktop', element: 'hero-title', x: 1 })).toEqual({
      artboard: 'desktop',
      element: 'hero-title',
    });
    expect(spec?.parse({ annotation: 's_1a2b3c4d' })).toEqual({ annotation: 's_1a2b3c4d' });
    expect(spec?.parse({ artboard: 'a/b', element: 'x' })).toBeNull();
    expect(spec?.parse({ annotation: 42 })).toBeNull();
  });
});

describe('the shell checks the object against what the frame showed it', () => {
  test('a selected element, an element of the layers tree, a selected sticky', () => {
    expect(objectHistoryTarget({ artboard: 'desktop', element: 'hero-title' }, known)).toEqual({
      element: { artboard: 'desktop', element: 'hero-title' },
    });
    expect(objectHistoryTarget({ artboard: 'desktop', element: 'cta' }, known)).toEqual({
      element: { artboard: 'desktop', element: 'cta' },
    });
    expect(objectHistoryTarget({ annotation: 's_1a2b3c4d' }, known)).toEqual({
      annotation: 's_1a2b3c4d',
      kind: 'sticky',
    });
  });

  test('a malformed message, a foreign canvas or a missing id is ignored', () => {
    for (const bad of [
      null,
      'x',
      {},
      { artboard: 'desktop' },
      { element: 'hero-title' },
      { artboard: 'desktop', element: '../etc' },
      { artboard: 'desktop', element: 'hero-title', annotation: 's_1a2b3c4d' },
      // a missing id: nobody showed it
      { artboard: 'desktop', element: 'nope' },
      { artboard: 'mobile', element: 'hero-title' },
      { annotation: 's_ffffffff' },
    ])
      expect([bad, objectHistoryTarget(bad, known)]).toEqual([bad, null]);
    // a foreign canvas: what was shown belongs to another canvas than the frame's own
    const foreign = { ...known, activePath: '.design/Other.tsx' };
    expect(objectHistoryTarget({ artboard: 'desktop', element: 'hero-title' }, foreign)).toBeNull();
    expect(objectHistoryTarget({ artboard: 'desktop', element: 'cta' }, foreign)).toBeNull();
    expect(objectHistoryTarget({ annotation: 's_1a2b3c4d' }, foreign)).toBeNull();
    expect(
      objectHistoryTarget({ annotation: 's_1a2b3c4d' }, { ...known, activePath: null })
    ).toBeNull();
  });
});

describe('the registry action opens the filtered panel', () => {
  afterEach(() => historyScope.clear());
  test('history.object with a target: Version history scoped to that object, on the active canvas', async () => {
    let opened = 0;
    const off = setHistoryOpener(() => {
      opened++;
    });
    const h = createMenuHandlers({ activePath: PATH } as never) as Record<
      string,
      (p?: unknown) => unknown
    >;
    expect(typeof h['history.object']).toBe('function');
    await h['history.object']?.({ element: { artboard: 'desktop', element: 'hero-title' } });
    expect(historyScope.get()).toMatchObject({
      path: PATH,
      key: 'desktop/hero-title',
      tail: 'this object',
    });
    await h['history.object']?.({ annotation: 's_1a2b3c4d', kind: 'sticky' });
    expect(historyScope.get()).toMatchObject({
      path: PATH,
      key: 's_1a2b3c4d',
      tail: 'this sticky',
    });
    expect(opened).toBe(2);
    off();
  });
});

describe('the object menu row', () => {
  test('one object: “Version history of this object” asks the shell; several: no row', () => {
    const posted: unknown[] = [];
    const el = { getAttribute: (k: string) => (k === 'data-cd-id' ? 'hero-title' : null) } as never;
    const sections = objectMenuSections([], {
      elementsFor: () => [el],
      run: () => {},
      selectMatching: () => {},
      history: (t) => posted.push(t),
    });
    const row = sections.flat().find((i) => i.id === 'history-object');
    expect(row?.label).toBe('Version history of this object');
    const target = { kind: 'element', el, cdId: 'hero-title', artboardId: 'desktop' } as never;
    row?.onSelect(target);
    expect(posted).toEqual([target]);
    const many = objectMenuSections([], {
      elementsFor: () => [el, el],
      run: () => {},
      selectMatching: () => {},
      history: () => {},
    });
    const r2 = many.flat().find((i) => i.id === 'history-object');
    expect(typeof r2?.hidden === 'function' ? r2.hidden(target) : r2?.hidden).toBe(true);
  });
});
