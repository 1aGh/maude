// bridge/mode-shows.ts — S3.11: "what each mode shows", as data (V2-1.2 §5.4, 04 md-model).
//
// PURE. S3.11 starts it with the two rows it owns; S3.12 grows it into the full table (and makes the
// consumers branch only through it). A consumer asks `modeShows(mode, item)` instead of comparing a mode.
//
//   measure        ⌥-hover distance between the selection and a neighbour: Edit, Preview and Viewing
//                  (Preview/Viewing inspect something to measure from); never Present.
//   inspect-panel  the read-only specs panel (client/v2/inspect): Preview (after a ⌘-click) and Viewing.
//                  Edit has the Inspector; Present shows no panels.
//
// `null` is an ungoverned canvas (no `set-mode` yet — a standalone canvas, a DS specimen): it keeps v1's
// behaviour, so measure is on and the shell-only panel is not a canvas matter.

import type { CanvasModeV2 } from './canvas-modes.ts';

export type ModeShowItem = 'measure' | 'inspect-panel';

const TABLE: Readonly<Record<ModeShowItem, Readonly<Record<CanvasModeV2, boolean>>>> =
  Object.freeze({
    measure: { edit: true, preview: true, viewing: true, present: false },
    'inspect-panel': { edit: false, preview: true, viewing: true, present: false },
  });

export function modeShows(mode: CanvasModeV2 | null | undefined, item: ModeShowItem): boolean {
  if (!mode) return item === 'measure';
  return TABLE[item][mode];
}
