// actions/defs/annotation.ts — keys on selected annotations (annotations-layer.tsx, canvas focus,
// not typing, annotation selection non-empty). V2-2.4: v1 bindings under their v2 ids. v1 ran
// these next to use-keyboard-discipline's element keys when both selections existed (defect 7);
// Phase 4 scopes them to Preview (A11).

import type { ActionDef } from '../types.ts';
import { IN_CANVAS, kb, mods } from './_v1.ts';

const ANN = { ...IN_CANVAS, selection: ['annotation' as const] };
const ann = (id: string, label: string, keys: ReturnType<typeof kb>[]): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'canvas',
  keys,
});

export const ANNOTATION_ACTIONS: ActionDef[] = [
  ann('annotation.group', 'Group', [kb('⌘G', 'selection', { when: ANN })]),
  ann('annotation.ungroup', 'Ungroup', [kb('⇧⌘G', 'selection', { when: ANN })]),
  ann('annotation.lock', 'Lock / unlock', [kb('⇧⌘L', 'selection', { when: ANN })]),
  ann('annotation.duplicate', 'Duplicate', [kb('⌘D', 'selection', { when: ANN })]),
  ann('annotation.to-front', 'Bring to front', [kb(']', 'selection', { when: ANN })]),
  ann('annotation.forward', 'Bring forward', [kb('⌘]', 'selection', { when: ANN })]),
  ann('annotation.to-back', 'Send to back', [kb('[', 'selection', { when: ANN })]),
  ann('annotation.backward', 'Send backward', [kb('⌘[', 'selection', { when: ANN })]),
  ann('annotation.copy', 'Copy', [kb('⌘C', 'selection', { when: ANN })]),
  ann('annotation.cut', 'Cut', [kb('⌘X', 'selection', { when: ANN })]),
  ann('annotation.chain', 'Add the next one', [kb('⌘↵', 'selection', { when: ANN })]),
  ann('annotation.edit-text', 'Edit text', [kb('↵', 'selection', { when: ANN })]),
  ann(
    'annotation.nudge',
    'Nudge',
    ['←', '→', '↑', '↓'].flatMap((a) => mods(a, '⇧', 'selection', { when: ANN }))
  ),
  ann('annotation.remove', 'Remove', [
    ...mods('⌫', '⇧', 'selection', { when: ANN }),
    ...mods('⌦', '⇧', 'selection', { when: ANN }),
  ]),
];
