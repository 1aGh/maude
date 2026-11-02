// editing/edit-op.ts — the canvas half of an edit-op (S2.1; S2-edit-ops.md §5–§6).
//
// The canvas (untrusted origin) asks its shell with `dgn:'edit-op'` and awaits `edit-op-result`
// by requestId; the shell pins the file and calls `POST /_api/edit-op`. Every S2/S3 canvas gesture
// that writes structure goes through `runEditOp`, so menus, keys and ⌘K share one path.
//
// Undo: every write is a kernel action, and ⌘Z is the shell's projection over the op log (S5). The
// canvas keeps no stack: p8-v1-drop deleted the legacy-link record (`revert {writeId}` on a DDR-050
// stack) with editing/undo-mode.ts, so `editOpRecord` answers null; no positional id is ever stored.

import { acceptFromShell } from '../bridge/dgn-protocol.ts';
import type { EditOpRequest, EditOpResult } from '../edit-ops/types.ts';

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

/**
 * The record an applied edit-op would push on the canvas stack — always null since p8-v1-drop: the
 * write is a kernel action, and ⌘Z is the shell's projection over the op log. Kept so the gesture
 * call sites (`if (rec) record(rec)`) need no change.
 */
export function editOpRecord(_writeId: string, _label: string): null {
  return null;
}

/** `edit-ops/revert.ts` WRITE_ID_RE (kept local: that module pulls the merge engine into the canvas). */
export const SHELL_WRITE_ID_RE = /^w_[0-9a-f]{16}$/;
