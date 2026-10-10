// actions/defs/timeline.ts — the Timeline (V2-2.4: v1 bindings under their v2 ids).
//
// v1 had two shell listeners: the transport (use-photo-and-timeline — Space, ← →, Home End , .,
// ⌘Z ⇧⌘Z, ⌘B, plus esc and ⌫ which live in `ui.step-back` / `object.remove`) and the panel's own
// (TimelinePanel — ⌘+ ⌘− 0 C esc). The transport fires while the timeline is open with a comp and
// focus is in the shell, not typing (focus 'timeline'); it matched named keys with any modifier.
// The panel listener is not part of V2-2.4's swap (its state is panel-local): its rows document it.

import type { ActionDef } from '../types.ts';
import { kb, mods, TRANSPORT } from './_v1.ts';

const T = { when: TRANSPORT, inText: false } as const;

export const TIMELINE_ACTIONS: ActionDef[] = [
  {
    id: 'timeline.play',
    label: 'Play / pause',
    kind: 'toggle',
    exec: 'shell',
    keys: mods('Space', '⌥⇧⌘', 'timeline', T),
  },
  {
    id: 'timeline.step',
    label: 'Step a frame',
    kind: 'command',
    exec: 'shell',
    // ⇧ steps one second (the comp's fps) — the handler reads it from the event.
    keys: [...mods('←', '⌥⇧⌘', 'timeline', T), ...mods('→', '⌥⇧⌘', 'timeline', T)],
  },
  {
    id: 'timeline.to-start',
    label: 'Go to start',
    kind: 'command',
    exec: 'shell',
    keys: mods('Home', '⌥⇧⌘', 'timeline', T),
  },
  {
    id: 'timeline.to-end',
    label: 'Go to end',
    kind: 'command',
    exec: 'shell',
    keys: mods('End', '⌥⇧⌘', 'timeline', T),
  },
  {
    id: 'timeline.prev-keyframe',
    label: 'Previous keyframe',
    kind: 'command',
    exec: 'shell',
    // v1 `e.key === ','` with any modifier — ⌘, also opens Settings (the transport and the global
    // handler both ran; `settings.open`'s v1 handler runs this first, so ⌘, is bound there).
    keys: [kb(',', 'timeline', T)],
  },
  {
    id: 'timeline.next-keyframe',
    label: 'Next keyframe',
    kind: 'command',
    exec: 'shell',
    keys: [kb('.', 'timeline', T), kb('⌘.', 'timeline', { ...T, alias: true })],
  },
  {
    id: 'timeline.undo',
    label: 'Undo timeline edit',
    kind: 'command',
    exec: 'shell',
    keys: [kb('⌘Z', 'timeline', T)],
  },
  {
    id: 'timeline.redo',
    label: 'Redo timeline edit',
    kind: 'command',
    exec: 'shell',
    keys: [kb('⇧⌘Z', 'timeline', T)],
  },
  {
    id: 'timeline.split',
    label: 'Split at playhead',
    kind: 'command',
    exec: 'shell',
    keys: mods('⌘B', '⇧', 'timeline', T),
  },
  // TimelinePanel's own listener (not swapped in V2-2.4): any shell focus outside a text field,
  // select or range — documented here so "?" and the uniqueness test see the keys.
  {
    id: 'timeline.zoom-in',
    label: 'Zoom timeline in',
    kind: 'command',
    exec: 'shell',
    keys: [
      kb('⌘=', 'timeline', { ...T, when: { notFacts: ['selectFocused', 'rangeFocused'] } }),
      kb('⌘+', 'timeline', {
        ...T,
        alias: true,
        when: { notFacts: ['selectFocused', 'rangeFocused'] },
      }),
    ],
  },
  {
    id: 'timeline.zoom-out',
    label: 'Zoom timeline out',
    kind: 'command',
    exec: 'shell',
    keys: [kb('⌘−', 'timeline', { ...T, when: { notFacts: ['selectFocused', 'rangeFocused'] } })],
  },
  {
    id: 'timeline.zoom-fit',
    label: 'Fit the timeline',
    kind: 'command',
    exec: 'shell',
    keys: [kb('0', 'timeline', { ...T, when: { notFacts: ['selectFocused', 'rangeFocused'] } })],
  },
  {
    id: 'timeline.comment-mode',
    label: 'Comment on the timeline',
    kind: 'toggle',
    exec: 'shell',
    keys: mods('C', '⇧', 'timeline', {
      ...T,
      when: { notFacts: ['selectFocused', 'rangeFocused'] },
    }),
  },
];
