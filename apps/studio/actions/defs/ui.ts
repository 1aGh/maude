// actions/defs/ui.ts — esc (V2-1.3 §5.5: one action, `ui.step-back`, with a handler in each
// document). V2-2.4 keeps each document's v1 esc ladder in its handler:
//   shell  — deselect the timeline clip (transport) · leave Presentation Mode · clear the focused
//            comment pin (v1 ran the first and the others on one press — defect 7);
//   canvas — input-router's escape (drop the selection / leave the tool).
// v1 matched `e.key === 'Escape'` with any modifier, in both documents.

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, mods, SHELL_FOCI } from './_v1.ts';

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
];
