// client/edit-op-relay.ts — the shell half of `dgn:'edit-op'` (S2.1; S2-edit-ops.md §6).
//
// The canvas iframe (untrusted origin, DDR-054) never reaches `POST /_api/edit-op`; it posts the
// request here. The shell PINS `file` to the active canvas — a canvas can only edit its own file —
// and forwards only a well-formed request (the server re-parses and stays the authority). The
// answer goes back as `edit-op-result` with the same `requestId`.

import { type EditOpRequest, type EditOpResult, parseEditOpRequest } from '../edit-ops/types.ts';

export interface EditOpMessage {
  requestId?: unknown;
  op?: unknown;
  targets?: unknown;
  params?: unknown;
  expectRev?: unknown;
}

/** The request body for the active canvas, or null when the message is not one. */
export function editOpBody(m: EditOpMessage, activeFile: string | null): EditOpRequest | null {
  if (!activeFile || typeof m.requestId !== 'string' || !m.requestId) return null;
  const parsed = parseEditOpRequest({
    file: activeFile,
    op: m.op,
    targets: m.targets,
    ...(m.params !== undefined ? { params: m.params } : {}),
    ...(m.expectRev !== undefined ? { expectRev: m.expectRev } : {}),
  });
  return parsed.ok ? parsed.req : null;
}

/** The route's answer as an EditOpResult — a 403 from the read-only gate reads as `forbidden`. */
export async function readEditOpAnswer(res: Response): Promise<EditOpResult> {
  let body: Record<string, unknown> | null = null;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    /* not JSON */
  }
  if (body && body.ok === true) return body as unknown as EditOpResult;
  if (body && typeof body.code === 'string' && typeof body.message === 'string')
    return body as unknown as EditOpResult;
  if (res.status === 403)
    return {
      ok: false,
      code: 'forbidden',
      message: typeof body?.message === 'string' ? body.message : 'You can look here; ask to edit.',
    };
  return { ok: false, code: 'invalid', message: 'That edit did not go through; try again.' };
}

// ── S2.10b — the shell's own edit-op: ⌫ / "Move to trash" on an artboard ─────────────────────

/** The canvas's legacy undo row for an artboard moved to the trash. */
export const TRASH_RECORD_LABEL = 'Move artboard to the trash';

/** `artboard.trash` for the active canvas (the shell pins the file, as for a canvas's own ask). */
export function trashArtboardBody(activeFile: string, artboards: string[]): EditOpRequest | null {
  const parsed = parseEditOpRequest({
    file: activeFile,
    op: 'artboard.trash',
    targets: [],
    params: { artboards },
  });
  return parsed.ok ? parsed.req : null;
}

/**
 * The `record-edit` payload the shell posts the canvas after its own edit-op: only on a legacy link
 * (no action id, a write id) — an op-log write undoes through the op log, never a second way.
 */
export function legacyRecordPayload(
  r: EditOpResult,
  label: string
): { op: 'edit-op'; writeId: string; label: string } | null {
  if (!r.ok || r.actionId || r.queued || !r.writeId) return null;
  return { op: 'edit-op', writeId: r.writeId, label };
}
