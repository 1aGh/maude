// client/v2/ds/preview-doors.js — the three doors at the foot of "Preview in …" (13 · ds-many-switch), as data.
//
//   Open the Design system ↵    ds.go-to {ds}        the system the menu was opened from — what the Canvases row's
//                                                    own "Open …" runs
//   Make a design system…       ds.make              the three-input sheet (Home's starter, the empty pinned row, ⌘K)
//   Link a team library…        ds.library-link      the link dialog (also ⌘K)
//
// Every door runs a REGISTRY action, so the menu, the Canvases panel and ⌘K share one path. A door is never a dead
// row: it is greyed with the reason when the person's role does not hold the action (the registry's own `visible`
// predicate — Make and Link want Can edit, S10 Q15) or when this window has no runner for it. PURE: no DOM.

import { ACTIONS_BY_ID } from '../../../actions/index.ts';
import { holds } from '../../../actions/resolve.ts';
import { PREVIEW_WORDS } from './preview-mode.js';

/** The registry action behind each door id (preview-mode.js `PREVIEW_WORDS.doors`). */
export const DOOR_ACTION = Object.freeze({
  open: 'ds.go-to',
  make: 'ds.make',
  link: 'ds.library-link',
});

/**
 * @param {{ from: string, readOnly?: boolean, canRun?: (id: string) => boolean,
 *           byId?: ReadonlyMap<string, any> }} a
 * @returns {{ id: string, label: string, key: string, disabled: boolean, why: string,
 *             action: { id: string, params: object } }[]}
 */
export function doorRows({ from, readOnly = false, canRun = () => false, byId = ACTIONS_BY_ID }) {
  // `visible` here is a minRole predicate; the rest of the context is what a browser or desktop tab both have
  const ctx = { role: readOnly ? 'comment' : 'owner', shell: 'browser', facts: new Set() };
  return PREVIEW_WORDS.doors.map((d) => {
    const id = DOOR_ACTION[d.id];
    const def = byId.get(id);
    let why = '';
    if (!def || !canRun(id)) why = PREVIEW_WORDS.doorUnavailable;
    else if (!holds(def.visible, ctx)) why = PREVIEW_WORDS.doorViewOnly;
    return {
      id: d.id,
      label: d.label,
      key: d.key,
      disabled: why !== '',
      why,
      action: { id, params: d.id === 'open' ? { ds: from } : {} },
    };
  });
}
