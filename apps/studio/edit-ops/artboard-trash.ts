// edit-ops/artboard-trash.ts — S2.10b `artboard.trash`: ⌫ / "Move to trash" on an artboard.
//
//   params { artboards: string[] }   (1–50 DCArtboard ids; the canvas keeps at least one)
//
// One write: the boards' JSX spans leave the source and — on an op-log home — their
// `layout.artboards[]` entries leave the layout lane in the SAME action, `kind: 'trash'`,
// `origin.trashed: [{ artboard, label }]` (S1-trash.md §2). So the Trash lists them (the item's
// revision is this action; the source and the position as they stood are the revision before it,
// which is what S1.13's "Restore only <artboard>" splices from) and one ⌘Z brings them back.
// On a legacy link the entry stays (an orphan entry is inert; the source revert puts the board back
// at its own place) and the write is an ordinary edit with one revert record.
//
// The v1 route `POST /_api/delete-artboard` is unchanged for its callers. Same result by hand:
// remove the `<DCArtboard id="…">` element (canvas-tsx.md § "Remove an artboard").

import { applyDeleteArtboard, CanvasEditError } from '../canvas-edit.ts';
import { ARTBOARD_ID_RE } from './artboard-resize.ts';
import { artboardLabels } from './duplicate-at-width.ts';
import type { EditOp, ResolvedEditOp } from './types.ts';

export const MAX_TRASHED = 50;
const LABEL_MAX = 200;

/** `Moved “<label>” to the trash` (S1-trash.md §2); several: `Moved N artboards to the trash`. */
export function trashLabel(labels: readonly string[]): string {
  return labels.length === 1
    ? `Moved “${labels[0]}” to the trash`
    : `Moved ${labels.length} artboards to the trash`;
}

function idsOf(req: ResolvedEditOp): string[] {
  const raw = req.params.artboards;
  const bad = (msg: string): never => {
    throw new CanvasEditError(msg, { canvas: req.file, id: '' });
  };
  if (!Array.isArray(raw) || raw.length === 0) return bad('Nothing to move to the trash.');
  if (raw.length > MAX_TRASHED) return bad('That is too many artboards at once.');
  const ids = [...new Set(raw)];
  for (const id of ids)
    if (typeof id !== 'string' || !ARTBOARD_ID_RE.test(id))
      bad('That artboard is not on this canvas.');
  return ids as string[];
}

export const artboardTrash: EditOp = {
  id: 'artboard.trash',
  artboards: (req) =>
    Array.isArray(req.params.artboards)
      ? req.params.artboards.filter((a): a is string => typeof a === 'string')
      : [],
  apply(source, req) {
    const ids = idsOf(req);
    const labels = artboardLabels(source);
    let out = source;
    try {
      for (const id of ids) out = applyDeleteArtboard(req.file, out, id).source;
    } catch (e) {
      if (!(e instanceof CanvasEditError)) throw e;
      // applyDeleteArtboard's own words name the file path; say it the person's way
      throw new CanvasEditError(
        /last artboard/.test(e.message)
          ? 'A canvas keeps at least one artboard.'
          : 'That artboard is not on this canvas.',
        { canvas: req.file, id: '' }
      );
    }
    const trashed = ids.map((artboard) => ({
      artboard,
      label: (labels.get(artboard) ?? artboard).slice(0, LABEL_MAX),
    }));
    return {
      source: out,
      layout: { remove: ids },
      action: { kind: 'trash', label: trashLabel(trashed.map((t) => t.label)), trashed },
    };
  },
};
