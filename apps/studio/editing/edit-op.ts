// editing/edit-op.ts — the canvas half of an edit-op (S2.1; S2-edit-ops.md §5–§6).
//
// The canvas (untrusted origin) asks its shell with `dgn:'edit-op'` and awaits `edit-op-result`
// by requestId; the shell pins the file and calls `POST /_api/edit-op`. Every S2/S3 canvas gesture
// that writes structure goes through `runEditOp`, so menus, keys and ⌘K share one path.
//
// Undo on a legacy link (contract §5): `recordEditOp` pushes ONE DDR-050 record per write whose
// undo is `revert {writeId}` and whose redo reverts that revert. Op-log projects undo through S5
// instead (S2.20 retires this record there); no positional id is ever stored.

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import type { EditOpRequest, EditOpResult } from '../edit-ops/types.ts';
import { type CommandRecord, type EditCommand, registerCommand } from '../undo-stack.ts';

export const EDIT_OP_TIMEOUT_MS = 15_000;
export type EditOpAsk = Omit<EditOpRequest, 'file'>;

let seq = 0;
const pending = new Map<string, (r: EditOpResult) => void>();
let listening: Window | null = null;

function listen(win: Window): void {
  if (listening === win) return;
  listening = win;
  win.addEventListener('message', (e: MessageEvent) => {
    // only the shell answers (a sibling canvas frame shares this origin, DDR-054)
    const parent = win.parent;
    if (e.source !== parent || (e.data as { dgn?: unknown } | null)?.dgn !== 'edit-op-result')
      return;
    const m = acceptFromShell(e, win);
    if (m?.dgn !== 'edit-op-result') return;
    const done = pending.get(m.requestId);
    if (!done) return;
    pending.delete(m.requestId);
    const { dgn: _d, requestId: _r, ...rest } = m;
    done(
      rest.ok
        ? ({ actionId: null, refs: [], ...rest } as EditOpResult)
        : ({
            ok: false,
            code: rest.code ?? 'invalid',
            message: rest.message ?? 'That edit did not go through.',
          } as EditOpResult)
    );
  });
}

/** Ask the shell to run one edit-op on this canvas. Never rejects. */
export function runEditOp(ask: EditOpAsk, win: Window = window): Promise<EditOpResult> {
  listen(win);
  const requestId = `eo_${Date.now().toString(36)}_${++seq}`;
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(requestId);
      resolve({ ok: false, code: 'invalid', message: 'The studio did not answer; try again.' });
    }, EDIT_OP_TIMEOUT_MS);
    pending.set(requestId, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    try {
      win.parent.postMessage(
        {
          dgn: 'edit-op',
          requestId,
          op: ask.op,
          targets: ask.targets,
          ...(ask.params ? { params: ask.params } : {}),
          ...(ask.expectRev ? { expectRev: ask.expectRev } : {}),
        },
        '*'
      );
    } catch {
      clearTimeout(timer);
      pending.delete(requestId);
      resolve({ ok: false, code: 'invalid', message: 'The studio could not be reached.' });
    }
  });
}

// ── the legacy-link undo record ───────────────────────────────────────────────────────────

export const EDIT_OP_KIND = 'edit-op';
export interface EditOpPayload {
  writeId: string;
}

/** writeId of a write → writeId of the revert that undid it (iframe memory: a reload forgets). */
const revertedBy = new Map<string, string>();

async function revert(writeId: string, win: Window): Promise<string> {
  const r = await runEditOp({ op: 'revert', targets: [], params: { writeId } }, win);
  if (!r.ok) throw new Error(r.message); // the stack does not advance on a refused undo
  return r.writeId;
}

export function createEditOpCommand(
  payload: EditOpPayload,
  label: string,
  win: Window = window
): EditCommand {
  return {
    kind: EDIT_OP_KIND,
    label,
    async undo() {
      revertedBy.set(payload.writeId, await revert(payload.writeId, win));
    },
    async do() {
      const undoneBy = revertedBy.get(payload.writeId);
      if (!undoneBy) throw new Error('Redo is not available after a reload.');
      await revert(undoneBy, win);
      revertedBy.delete(payload.writeId);
    },
  };
}

/** The record an applied edit-op pushes with `record()` (it already landed; never re-run). */
export function editOpRecord(writeId: string, label: string): CommandRecord<EditOpPayload> {
  return { kind: EDIT_OP_KIND, label, payload: { writeId } };
}

registerCommand<EditOpPayload>(EDIT_OP_KIND, (record) =>
  typeof record.payload?.writeId === 'string'
    ? createEditOpCommand(record.payload, record.label)
    : null
);
