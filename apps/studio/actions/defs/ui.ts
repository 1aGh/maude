// actions/defs/ui.ts — esc (V2-1.3 §5.5: one action, `ui.step-back`, with a handler in each
// document). V2-2.4 keeps each document's v1 esc ladder in its handler:
//   shell  — deselect the timeline clip (transport) · leave Presentation Mode · clear the focused
//            comment pin (v1 ran the first and the others on one press — defect 7);
//   canvas — input-router's escape (drop the selection / leave the tool).
// v1 matched `e.key === 'Escape'` with any modifier, in both documents.

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, kb, mods, SHELL_FOCI } from './_v1.ts';

export const UI_ACTIONS: ActionDef[] = [
  {
    id: 'ui.step-back',
    label: 'Step back',
    kind: 'command',
    exec: 'shell',
    keys: [
      ...mods('esc', '⌥⇧⌘', 'global', { inText: true, when: { focus: SHELL_FOCI } }),
      ...mods('esc', '⌥⇧⌘', 'selection', { inText: false, when: IN_CANVAS }),
    ],
    legacy: { sheet: 'Deselect · close menu' },
  },
  {
    // S2.21 (14 `ed-edge-keys`) — F6 moves the keyboard between the panels and the canvas, ⇧F6 back. From inside
    // the canvas iframe the editing layer forwards the chord (`fromCanvas`), so one key crosses the boundary
    // both ways. The shell's handler is client/v2/shell/f6-cycle.js.
    id: 'ui.cycle-region',
    label: 'Move between the panels and the canvas',
    kind: 'command',
    exec: 'shell',
    fromCanvas: true,
    keys: [
      kb('F6', 'global', { inText: true }),
      kb('⇧F6', 'global', { inText: true, alias: true }),
    ],
    search: { keywords: ['focus', 'panels', 'canvas', 'keyboard', 'f6'] },
  },
];
