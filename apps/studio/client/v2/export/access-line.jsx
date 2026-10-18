// client/v2/export/access-line.jsx — S8.9: who may export, and the one line the sheet says about it
// (09 ex-edges, left column; slice decision Q1: Gate 0 A19 and CONTRACT §Roles win over the canvas).
//
//   owner / member (Can edit)   the sheet as drawn, nothing extra, Handoff available
//   viewer (Can comment)        the same sheet with ONE line on top; Handoff reads "Needs Can edit"
//   observer (Can view)         no sheet at all: no Export…, ⇧⌘E, Copy as PNG or Exports entry point, and
//                               the server refuses with 403 (access/request.ts EXPORT class, S9.9) —
//                               this file only REFLECTS that, it is not the lock
//
// The role words are the shell's own (`canvas-mode.js` `capsFor`): `canEdit` is false for every
// read-only role and `role === 'observer'` is Can view; anything else that cannot edit is Can comment.

import { capsFor } from '../shell/canvas-mode.js';
import { StIcon } from '../../shell/icons.jsx';

export const ACCESS_LINE_COMMENT =
  'You can comment on this project. Exporting is fine — it makes a copy and changes nothing.';

/**
 * What a role may do in the sheet.
 * @param {{ canEdit?: boolean, role?: string } | null | undefined} access  the shell's `{ canEdit, role }`;
 *        absent = a desktop project (the person owns it): everything.
 * @returns {{ level: 'edit' | 'comment' | 'view', canExport: boolean, canHandoff: boolean, line: string | null }}
 */
export function exportAccess(access) {
  if (!access || typeof access !== 'object') {
    return { level: 'edit', canExport: true, canHandoff: true, line: null };
  }
  const caps = capsFor({ canEdit: access.canEdit !== false, role: access.role });
  if (caps.edit) return { level: 'edit', canExport: true, canHandoff: true, line: null };
  if (caps.comment) {
    return { level: 'comment', canExport: true, canHandoff: false, line: ACCESS_LINE_COMMENT };
  }
  return { level: 'view', canExport: false, canHandoff: false, line: null };
}

/** The one line on top of the sheet for a Can comment person; nothing for anyone else. */
export function AccessLine({ line }) {
  if (!line) return null;
  return (
    <div className="ex-hint ex-hint--info ex-access" data-testid="export-access-line" role="note">
      <span className="ex-hint-ic">
        <StIcon name="eye" size={14} />
      </span>
      <span className="ex-hint-t">{line}</span>
    </div>
  );
}
