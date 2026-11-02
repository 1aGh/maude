// client/v2/shell/role-denial.js — S4.16 (canvas 15 an-viewer): the one line a role gets for a tool it does
// not hold, and the way out.
//
// A person with Can comment has Hand and Comment only. N / M / A / S / E still reach the shell as a request,
// because the shell owns the role (V2-1.2 §5.4, Q2); the shell answers with ONE line that names what needs
// Can edit, plus **Ask to edit** — S3.12's `askToEdit`, which runs S9.21's registry action
// `share.ask-to-edit`. The server refuses the write regardless (hidden is not refused).
//
// PURE except `showRoleDenial`, which posts to the shell's notification stack.

import { shellToast } from '../../shell/util.js';
import { normalizeOpenPath } from '../../share-link.js';
import { editsInAppOnly, WORDS } from '../access/access-client.js';
import { askToEdit } from './ask-to-edit.js';

/** The shell's general role line (a mode request with no tool to name). */
export const ROLE_DENIAL = 'You can view this canvas. Ask a project owner for edit access.';

/** Words for what the role may not use, keyed by the canvas tool the key would have armed … */
const TOOL_LINE = {
  sticky: 'Stickies need Can edit.',
  pen: 'Marker needs Can edit.',
  highlighter: 'Marker needs Can edit.',
  eraser: 'Marker needs Can edit.',
  arrow: 'Arrows need Can edit.',
  section: 'Sections need Can edit.',
  shape: 'Shapes need Can edit.',
  text: 'Text needs Can edit.',
  comment: 'Comments need Can comment.',
};
/** … or by the panel it would have opened (E: Stickers, S: Templates). */
const PANEL_LINE = {
  stickers: 'Stickers need Can edit.',
  templates: 'Templates need Can edit.',
  components: 'Components need Can edit.',
  assets: 'Assets need Can edit.',
};

/** The line for a refused request `{ tool?, panel? }`; the general role line when it names nothing known. */
export function denialLine(req) {
  if (req?.tool && Object.hasOwn(TOOL_LINE, req.tool)) return TOOL_LINE[req.tool];
  if (req?.panel && Object.hasOwn(PANEL_LINE, req.panel)) return PANEL_LINE[req.panel];
  return ROLE_DENIAL;
}

/**
 * p8-fix-a F2 — can this person edit `activePath` by role yet only VIEW it in this frame (a cloud canvas-only
 * session, `editsInAppOnly`)? The same condition the Viewing note uses (`share-cluster-host.jsx`).
 */
export function appOnlyFor(cfg, activePath) {
  return !!activePath && editsInAppOnly(cfg, normalizeOpenPath(activePath, cfg?.designRel));
}

/**
 * Says the line with **Ask to edit** beside it — or, when the person can already edit in the desktop app
 * (`appOnly`), says so and offers nothing to ask for.
 * @param req {{ tool?: string, panel?: string }} what the person pressed
 * @param deps {{ toast?: Function, run?: (id: string) => void, appOnly?: boolean }} seams for a test
 */
export function showRoleDenial(req, deps = {}) {
  const toast = deps.toast ?? shellToast;
  if (deps.appOnly) {
    toast(WORDS.appOnlyLine, false);
    return;
  }
  const run =
    deps.run ??
    ((id) => import('./menu-runner.js').then((m) => m.menuRunner.run(id)).catch(() => false));
  toast(denialLine(req), false, {
    label: 'Ask to edit',
    onClick: () => askToEdit(run, (line) => toast(line)),
  });
}
