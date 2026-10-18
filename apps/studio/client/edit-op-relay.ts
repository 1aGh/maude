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
