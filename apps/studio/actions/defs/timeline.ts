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
  // S7.6 — `timeline.undo` / `timeline.redo` retired: ⌘Z / ⇧⌘Z with the timeline focused are
  // `edit.undo` / `edit.redo`, the one canvas stack (help.ts MOVED_KEYS).
  {
    id: 'timeline.split',
    label: 'Split at playhead',
    kind: 'command',
    exec: 'shell',
    // S7.8 (C26): S splits ONLY with the timeline focused (it is Section on the canvas); ⌘B splits whenever the
    // island is up, whatever has focus — the global binding is the "always".
    keys: [
      kb('S', 'timeline', T),
      ...mods('⌘B', '⇧', 'timeline', T),
      kb('⌘B', 'global', { ...T, alias: true, when: { facts: ['timelineVisible'] } }),
    ],
  },
  // S7.8 (07 · ve-play) — I and O set the loop range at the playhead; the band shows on the ruler and tints
  // the lane, and with Loop on, playback inside it wraps. Playback state, not file state: a per-person view.
  {
    id: 'timeline.loop-in',
    label: 'Loop starts here',
    kind: 'command',
    exec: 'shell',
    keys: [kb('I', 'timeline', T)],
  },
  {
    id: 'timeline.loop-out',
    label: 'Loop ends here',
    kind: 'command',
    exec: 'shell',
    keys: [kb('O', 'timeline', T)],
  },
  {
    id: 'timeline.loop-clear',
    label: 'Clear the loop range',
    kind: 'command',
    exec: 'shell',
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
  // S7.7 — the island's size (07 · the Expand / Compact button in its header). No key (CONTRACT §2: size is a
  // button, not a key); ⌘K and the agent surface reach them.
  {
    id: 'timeline.expand',
    label: 'Expand the timeline',
    kind: 'command',
    exec: 'shell',
  },
  {
    id: 'timeline.compact',
    label: 'Make the timeline compact',
    kind: 'command',
    exec: 'shell',
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
