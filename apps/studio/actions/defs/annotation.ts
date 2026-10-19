// actions/defs/annotation.ts — keys on selected annotations (annotations-layer.tsx, canvas focus,
// not typing, annotation selection non-empty). V2-2.4: v1 bindings under their v2 ids. v1 ran
// these next to use-keyboard-discipline's element keys when both selections existed (defect 7);
// Phase 4 scopes them to Preview (A11).

import { TEMPLATES } from '../../annotations/templates.ts';
import type { ActionDef } from '../types.ts';
import { IN_CANVAS, kb, mods } from './_v1.ts';

const ANN = { ...IN_CANVAS, selection: ['annotation' as const] };
// S2.6: the chords an Edit-mode OBJECT op also binds (⌘G ⇧⌘G ⇧⌘L ] [ ⌘] ⌘[) belong to the board only in
// Preview — in Edit, annotations are quiet and click-through, so a press never reaches a sticky.
const ANN_PREVIEW = { ...ANN, mode: ['preview' as const] };
const ann = (id: string, label: string, keys: ReturnType<typeof kb>[]): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'canvas',
  keys,
});

export const ANNOTATION_ACTIONS: ActionDef[] = [
  ann('annotation.group', 'Group', [kb('⌘G', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.ungroup', 'Ungroup', [kb('⇧⌘G', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.lock', 'Lock / unlock', [kb('⇧⌘L', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.duplicate', 'Duplicate', [kb('⌘D', 'selection', { when: ANN })]),
  ann('annotation.to-front', 'Bring to front', [kb(']', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.forward', 'Bring forward', [kb('⌘]', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.to-back', 'Send to back', [kb('[', 'selection', { when: ANN_PREVIEW })]),
  ann('annotation.backward', 'Send backward', [kb('⌘[', 'selection', { when: ANN_PREVIEW })]),
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

// S4.9 (C29): resolved stickies stay struck through in place; this hides them for the person who
// asks. Per person (Q8: annotationPrefs), never in the file, so it is a view preference.
export const VISIBILITY_ACTIONS: ActionDef[] = [
  {
    id: 'annotations.hide-resolved',
    label: 'Hide resolved stickies',
    kind: 'command',
    exec: 'canvas',
    visible: { minRole: 'view' },
    search: { keywords: ['resolved', 'done', 'sticky', 'hide', 'show'] },
  },
];

// S4.4: one ⌘K row per whiteboard template ("Kanban template"). The shell runs it (menu-runner.js
// posts `insert-template` to the open canvas, the same message a Templates-panel pick sends), so the
// row, the panel tile and `maude design annotate <canvas> --board <id>` expand the same spec.
// Append-only ids: `annotation.template-<templates.ts id>`.
export const TEMPLATE_ACTIONS: ActionDef[] = TEMPLATES.map((t) => ({
  id: `annotation.template-${t.id}`,
  label: `${t.title} template`,
  kind: 'command',
  exec: 'shell',
  enabled: { minRole: 'edit', facts: ['canvasOpen'] },
  search: { keywords: ['template', 'start', 'section'] },
}));
