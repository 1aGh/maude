// actions/defs/edit.ts — undo / redo, selection and object keys (V2-2.4: v1 bindings under their
// v2 ids, v1 predicates as they are). One action may carry a shell binding and a canvas binding:
// each document runs its own handler for it (V2-1.3 §5.6).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, kb, mods, SHELL_FOCI } from './_v1.ts';

// v1 shell ⌘Z / ⇧⌘Z: chrome focus with a canvas open; skipped while the timeline transport owns
// them (timeline open with a comp → focus 'timeline') and inside a text field or range slider.
const SHELL_UNDO = {
  focus: ['chrome' as const],
  facts: ['canvasOpen' as const],
  notFacts: ['rangeFocused' as const],
};
// v1 shell ⌘Y (and ⇧⌘Y): the timeline skip covered `z` only.
const SHELL_REDO_Y = {
  focus: ['chrome' as const, 'timeline' as const],
  facts: ['canvasOpen' as const],
  notFacts: ['rangeFocused' as const],
};

// v1 use-keyboard-discipline: canvas focus, not typing (the handler also skips the browse tool and
// needs a selection — v1 checks kept in the handler).
const OBJ = IN_CANVAS;

export const EDIT_ACTIONS: ActionDef[] = [
  {
    id: 'edit.undo',
    label: 'Undo',
    kind: 'command',
    exec: 'canvas',
    keys: [
      kb('⌘Z', 'global', { inText: false, when: SHELL_UNDO }), // shell → posts `undo` to the canvas
      kb('⌘Z', 'global', { when: IN_CANVAS }), // canvas input-router
    ],
    legacy: { menu: 'Undo', sheet: 'Undo / redo' },
  },
  {
    id: 'edit.redo',
    label: 'Redo',
    kind: 'command',
    exec: 'canvas',
    keys: [
      kb('⇧⌘Z', 'global', { inText: false, when: SHELL_UNDO }),
      kb('⌘Y', 'global', { inText: false, alias: true, when: SHELL_REDO_Y }),
      kb('⇧⌘Y', 'global', { inText: false, alias: true, when: SHELL_REDO_Y }),
      kb('⇧⌘Z', 'global', { when: IN_CANVAS }),
      kb('⌘Y', 'global', { alias: true, when: IN_CANVAS }),
    ],
    legacy: { menu: 'Redo', sheet: 'Undo / redo' },
  },
  {
    id: 'edit.copy',
    label: 'Copy',
    kind: 'command',
    exec: 'shell',
    // v1 shell ⌘C only logs the retired comment-drop chord's deprecation and falls through to the
    // native copy (no preventDefault).
    keys: [kb('⌘C', 'global', { inText: true, when: { focus: SHELL_FOCI } })],
  },
  {
    id: 'select.all',
    label: 'Select all',
    kind: 'command',
    exec: 'canvas',
    // v1 use-keyboard-discipline matches `e.key === 'a'` with any ⇧ — so ⇧⌘A selects every element
    // too (V2-1.3 defect 1).
    keys: mods('⌘A', '⇧', 'selection', { when: OBJ }),
  },
  {
    // Menu only in v1 (posts `selection-clear` to the canvas); the "Esc" its rows show is
    // `ui.step-back`'s key.
    id: 'select.none',
    label: 'Deselect all',
    kind: 'command',
    exec: 'canvas',
    legacy: { menu: 'Deselect all' },
  },
  {
    // Menu only in v1: no key handler implements the ⇧⌘A its rows show (V2-1.3 defect 1).
    id: 'select.all-annotations',
    label: 'Select all annotations',
    kind: 'command',
    exec: 'canvas',
    legacy: { menu: 'Select all annotations' },
  },
  {
    id: 'object.duplicate',
    label: 'Duplicate',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⌘D', 'selection', { when: { ...OBJ, selection: ['object'] } })],
  },
  {
    id: 'edit.copy-properties',
    label: 'Copy properties',
    kind: 'command',
    exec: 'canvas',
    keys: mods('⌥⌘C', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
  },
  {
    id: 'edit.paste-properties',
    label: 'Paste properties',
    kind: 'command',
    exec: 'canvas',
    keys: mods('⌥⌘V', '⇧', 'selection', { when: { ...OBJ, selection: ['object'] } }),
  },
  {
    id: 'object.select-child',
    label: 'Select first child',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('↵', 'selection', { when: { ...OBJ, selection: ['object'] } })],
  },
  {
    id: 'object.select-parent',
    label: 'Select parent',
    kind: 'command',
    exec: 'canvas',
    keys: [kb('⇧↵', 'selection', { when: { ...OBJ, selection: ['object'] } })],
  },
  {
    id: 'object.select-next',
    label: 'Select next sibling',
    kind: 'command',
    exec: 'canvas',
    keys: [
      kb('tab', 'selection', { when: { ...OBJ, selection: ['object'] } }),
      kb('⇧tab', 'selection', { when: { ...OBJ, selection: ['object'] } }),
    ],
  },
  {
    id: 'object.remove',
    label: 'Remove',
    kind: 'command',
    exec: 'canvas',
    keys: [
      // v1 shell: the ⌫ guard (blocks WKWebView back-navigation; deletes a selected artboard) and
      // the timeline transport (removes the selected clip) — both ran on one press (defect 7).
      // The transport matched any modifier; the guard none but ⇧.
      ...mods('⌫', '⇧', 'global', {
        when: { focus: ['chrome', 'timeline'], notFacts: ['selectFocused'] },
      }),
      ...mods('⌦', '⇧', 'global', {
        when: { focus: ['chrome', 'timeline'], notFacts: ['selectFocused'] },
      }),
      ...['⌘⌫', '⇧⌘⌫', '⌥⌫', '⌥⇧⌫', '⌥⌘⌫', '⌥⇧⌘⌫', '⌘⌦', '⇧⌘⌦', '⌥⌦', '⌥⇧⌦', '⌥⌘⌦', '⌥⇧⌘⌦'].map(
        (c) =>
          kb(c, 'timeline', {
            inText: false,
            alias: true,
            when: { selection: ['clip'], notFacts: ['selectFocused'] },
          })
      ),
      // v1 canvas use-keyboard-discipline: the selected element / artboard.
      ...mods('⌫', '⇧', 'selection', { when: { ...OBJ, selection: ['object', 'artboard'] } }),
      ...mods('⌦', '⇧', 'selection', { when: { ...OBJ, selection: ['object', 'artboard'] } }),
    ],
  },
  {
    id: 'object.nudge',
    label: 'Nudge',
    kind: 'command',
    exec: 'canvas',
    keys: ['←', '→', '↑', '↓'].flatMap((a) =>
      mods(a, '⇧', 'selection', { when: { ...OBJ, selection: ['object', 'artboard'] } })
    ),
  },
];
