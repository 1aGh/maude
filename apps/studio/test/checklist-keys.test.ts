// #113 slice B — contract 113-checklist §5.5: every checklist key is an action-registry entry, resolved in the
// canvas iframe through the generated keymap under the `checkItemFocused` fact. ⌘↵ in an entry ticks, outside
// it stays `annotation.chain`; ↑ ↓ / ↵ on a row are the row's, the sticky's nudge / edit-text stand aside; no
// chord is ambiguous at one layer.

import { describe, expect, test } from 'bun:test';

import { canvasKeyIndex, resolveCanvasKey } from '../actions/canvas-keys.ts';
import { ACTIONS } from '../actions/index.ts';
import { CANVAS_KEYMAP } from '../actions/keymap.gen.ts';
import { findAmbiguities } from '../actions/uniqueness.ts';

const IDS = [
  'annotation.make-checklist',
  'checklist.toggle',
  'checklist.edit',
  'checklist.add-below',
  'checklist.remove-empty',
  'checklist.move-up',
  'checklist.move-down',
  'checklist.focus-prev',
  'checklist.focus-next',
] as const;

const ANN_KEYS = [
  ...IDS,
  'annotation.chain',
  'annotation.edit-text',
  'annotation.nudge',
  'annotation.remove',
  'tool.hand-hold',
];

function key(k: string, mods: { meta?: boolean; alt?: boolean; shift?: boolean } = {}) {
  return {
    key: k,
    code: k === ' ' ? 'Space' : k,
    metaKey: !!mods.meta,
    ctrlKey: false,
    altKey: !!mods.alt,
    shiftKey: !!mods.shift,
  } as unknown as KeyboardEvent;
}

const index = canvasKeyIndex(ANN_KEYS);
/** typing = focus in an entry; row = the checkItemFocused fact. */
const run = (e: KeyboardEvent, typing: boolean, row: boolean) =>
  resolveCanvasKey(index, e, typing, 'preview', true, 'annotation', row);

describe('checklist actions are registry entries', () => {
  test('each id is a canvas action that needs Can edit and an annotation selection', () => {
    for (const id of IDS) {
      const a = ACTIONS.find((x) => x.id === id);
      expect(a, id).toBeDefined();
      expect(a?.exec).toBe('canvas');
      expect(a?.enabled?.minRole).toBe('edit');
      expect(a?.enabled?.selection).toEqual(['annotation']);
    }
  });

  test('roving focus is hidden from ⌘K; the rest are searchable', () => {
    for (const id of IDS) {
      const a = ACTIONS.find((x) => x.id === id);
      const hidden = a?.search?.hidden === true;
      expect(hidden, id).toBe(id === 'checklist.focus-prev' || id === 'checklist.focus-next');
    }
  });

  test('the canvas keymap carries the bindings (gen-actions regenerated)', () => {
    for (const id of IDS.filter((i) => i !== 'annotation.make-checklist')) {
      expect(
        CANVAS_KEYMAP.some((a) => a.id === id),
        id
      ).toBe(true);
    }
  });

  test('no chord is ambiguous at one layer', () => {
    const found = findAmbiguities(ACTIONS).filter((a) =>
      a.ids.some((id) => id.startsWith('checklist.') || id.startsWith('annotation.'))
    );
    expect(found).toEqual([]);
  });
});

describe('resolution in the canvas', () => {
  test('Space on a row ticks; Space elsewhere is not a tick', () => {
    expect(run(key(' '), false, true)).toBe('checklist.toggle');
    expect(run(key(' '), false, false)).toBeNull();
  });

  test('⌘↵ in an entry ticks, outside an entry it adds the next one', () => {
    expect(run(key('Enter', { meta: true }), true, true)).toBe('checklist.toggle');
    expect(run(key('Enter', { meta: true }), false, false)).toBe('annotation.chain');
  });

  test('↵ in an entry adds an item; ↵ on a row edits it; ↵ on the sticky edits its text', () => {
    expect(run(key('Enter'), true, true)).toBe('checklist.add-below');
    expect(run(key('Enter'), false, true)).toBe('checklist.edit');
    expect(run(key('Enter'), false, false)).toBe('annotation.edit-text');
  });

  test('⌫ in an entry is the empty-item removal, never the sticky removal', () => {
    expect(run(key('Backspace'), true, true)).toBe('checklist.remove-empty');
    expect(run(key('Backspace'), false, false)).toBe('annotation.remove');
  });

  test('↑ ↓ move between rows on a row, nudge the sticky off it', () => {
    expect(run(key('ArrowUp'), false, true)).toBe('checklist.focus-prev');
    expect(run(key('ArrowDown'), false, true)).toBe('checklist.focus-next');
    expect(run(key('ArrowUp'), false, false)).toBe('annotation.nudge');
  });

  test('⌥⌘↑ / ⌥⌘↓ reorder, on a row and in an entry', () => {
    expect(run(key('ArrowUp', { meta: true, alt: true }), false, true)).toBe('checklist.move-up');
    expect(run(key('ArrowDown', { meta: true, alt: true }), true, true)).toBe(
      'checklist.move-down'
    );
  });
});
