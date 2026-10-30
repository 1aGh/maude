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

const GESTURE = (id: string, label: string, where: string): ActionDef => ({
  id,
  label,
  kind: 'command',
  exec: 'shell',
  enabled: { minRole: 'edit' },
  search: { hidden: true, where, note: 'a pointer gesture on the timeline' },
});

/** The 17 right-click rows, in menu order: [id, label, least role]. Commenting is a Can comment right. */
const CLIP_MENU: ReadonlyArray<readonly [string, string, 'edit' | 'comment']> = [
  ['comment', 'Comment on clip', 'comment'],
  ['generate', 'Generate this clip', 'edit'],
  ['adjust', 'Adjust the clip', 'edit'],
  ['hide', 'Hide clip', 'edit'],
  ['show', 'Show clip', 'edit'],
  ['remove', 'Remove clip', 'edit'],
  ['replace', 'Replace the clip’s media', 'edit'],
  ['mute', 'Mute clip', 'edit'],
  ['unmute', 'Unmute clip', 'edit'],
  ['detach-audio', 'Detach audio', 'edit'],
  ['to-overlay', 'Move to overlay layer', 'edit'],
  ['to-storyline', 'Move to storyline', 'edit'],
  ['layer-up', 'Move layer up', 'edit'],
  ['layer-down', 'Move layer down', 'edit'],
  ['earlier', 'Move clip earlier', 'edit'],
  ['later', 'Move clip later', 'edit'],
  ['replace-layer', 'Replace a layer’s media', 'edit'],
];

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
  // S7.18 (C35) — "+ track" under the timeline's Advanced: an empty Video 2 or Music 2 on the followed video. A
  // comp's tracks are derived from what it says, so this only draws a lane (the person's own view); no key.
  {
    id: 'timeline.add-track',
    label: 'Add a track',
    kind: 'command',
    exec: 'shell',
    search: {
      where: 'Timeline › Advanced',
      keywords: ['track', 'video 2', 'music 2', 'layer', 'lane'],
    },
  },
  // S7.16 (07 · ve-long) — fold a track you do not need to "Text · 18": one line, no rows. Like "+ track" it is the
  // person's own view (a comp's tracks are derived), so it has no key and no role gate. With no track named it
  // folds the busy ones together.
  {
    id: 'timeline.fold-track',
    label: 'Fold a track',
    kind: 'command',
    exec: 'shell',
    search: {
      where: 'Timeline',
      keywords: ['fold', 'collapse', 'hide', 'track', 'text', 'graphics', 'lane'],
    },
  },
  // S7.16 (07 · ve-long) — ruler markers ("Výkop", "TD 1"): part of the cut, in the canvas meta
  // (`artboardMeta[id].markers`), so Add and Remove are Can edit (the server refuses below that); Jump only moves
  // the playhead. No keys — ⌘K and the flags on the ruler reach them.
  {
    id: 'timeline.marker.add',
    label: 'Add a marker here',
    kind: 'command',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: {
      where: 'Timeline › Markers',
      keywords: ['marker', 'flag', 'chapter', 'bookmark', 'moment', 'name'],
    },
  },
  {
    id: 'timeline.marker.remove',
    label: 'Remove the marker here',
    kind: 'command',
    exec: 'shell',
    enabled: { minRole: 'edit' },
    search: { where: 'Timeline › Markers', keywords: ['marker', 'flag', 'delete', 'remove'] },
  },
  {
    id: 'timeline.marker.jump',
    label: 'Jump to the next marker',
    kind: 'command',
    exec: 'shell',
    search: {
      where: 'Timeline › Markers',
      keywords: ['marker', 'next', 'previous', 'jump', 'chapter', 'flag'],
    },
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
  // S7.9 (07 · ve-drop, ve-trim-split, ve-move-transition) — the three edit gestures. Each is one `clip.*` edit op
  // (edit-ops/clip/gestures.ts): refused below Can edit by the server whatever the timeline shows, one undo step.
  // Pointer gestures with no key; ⌘K lists none of them (they have no "do it now" form without a target).
  GESTURE('timeline.trim', 'Trim a clip', 'Timeline › Drag a clip’s edge'),
  GESTURE('timeline.move-clip', 'Move a clip', 'Timeline › Drag a clip'),
  GESTURE('timeline.add-clips', 'Add footage to the video', 'Timeline › Drop footage'),
  // S7.9 (Gate 0 D15) — the clip right-click menu keeps all 17 v1 items: six drawn, eleven under Advanced ▸
  // (client/v2/timeline/edit/clip-menu.js holds the order; test/clip-menu-rows.test.ts pins it to this list).
  ...CLIP_MENU.map(([id, label, minRole]) => ({
    id: `timeline.clip-menu.${id}`,
    label,
    kind: 'command' as const,
    exec: 'shell' as const,
    enabled: { minRole },
    search: { hidden: true, where: 'Timeline › Right-click a clip', note: 'the clip menu runs it' },
  })),
];
