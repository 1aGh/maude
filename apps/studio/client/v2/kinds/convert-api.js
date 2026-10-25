// client/v2/kinds/convert-api.js — S7.25: the two requests Change kind makes (08 ak-convert, ak-convert-after).
//
//   fetchCheck    `GET /_api/kinds/convert-plan` — the "Check after" list, measured from a render of the post. The plan's
//                 words are computed here from the same module the server uses (kinds/convert.ts), so the dialog opens at once;
//                 only the list waits, and a render that cannot run is "can't be checked right now", never an error
//   runConvert    `POST /_api/edit-op` `artboard.convert-kind` — ONE request, one undo step. When it made a copy, the copy
//                 remembers its source (`PATCH /_api/present-meta { madeFrom }`, the "Made from" row); a failure of that second
//                 write loses only the row, never the copy
//
// Every refusal comes back as a sentence the dialog can show.

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This artboard is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};

/** @returns {Promise<{ measured: boolean, check: Array<{ id: string, code: string, text: string, verb: string }> }>} */
export async function fetchCheck(req, fetchImpl = globalThis.fetch) {
  const q = new URLSearchParams({ canvas: req.canvas, artboard: req.artboard, paper: req.paper });
  if (req.orientation) q.set('orientation', req.orientation);
  try {
    const res = await fetchImpl(`/_api/kinds/convert-plan?${q}`);
    const body = await res.json();
    if (body?.ok)
      return { measured: !!body.measured, check: Array.isArray(body.check) ? body.check : [] };
  } catch {
    /* unreachable: nothing to show */
  }
  return { measured: false, check: [] };
}

async function patchMadeFrom(canvas, copy, madeFrom, fetchImpl) {
  try {
    await fetchImpl('/_api/present-meta', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file: canvas, madeFrom: { [copy]: madeFrom } }),
    });
  } catch {
    /* the copy stands without its provenance row */
  }
}

/**
 * @param {{ canvas: string, artboard: string, paper: string, orientation?: string, keepOriginal: boolean }} req
 * @returns {Promise<{ ok: true, copy: string | null, artboard: string, label: string | null } | { ok: false, message: string }>}
 */
export async function runConvert(req, fetchImpl = globalThis.fetch) {
  let res;
  try {
    res = await fetchImpl('/_api/edit-op', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        file: req.canvas,
        op: 'artboard.convert-kind',
        targets: [],
        params: {
          artboard: req.artboard,
          paper: req.paper,
          keepOriginal: req.keepOriginal,
          ...(req.orientation ? { orientation: req.orientation } : {}),
        },
      }),
    });
  } catch {
    return { ok: false, message: 'Not changed. The studio could not be reached; try again.' };
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (!body?.ok)
    return { ok: false, message: SAID[body?.code] ?? body?.message ?? 'Not changed; try again.' };
  const d = body.detail ?? {};
  const copy = d.copy === true && typeof d.artboard === 'string' ? d.artboard : null;
  if (copy && d.madeFrom) await patchMadeFrom(req.canvas, copy, d.madeFrom, fetchImpl);
  return {
    ok: true,
    copy,
    artboard: typeof d.artboard === 'string' ? d.artboard : req.artboard,
    label: typeof d.label === 'string' ? d.label : null,
  };
}

/**
 * V2-8.5 C4 (08 ak-convert-after) — after a conversion that made a COPY, the copy is what is selected: its Print
 * inspector (the warnings, Paper A6, Made from) is what the person looks at next, the post stays as it was.
 * The canvas re-renders with the copy a beat after the write, so the select is asked for a few times (it is
 * idempotent and only reveals when the selection actually changes).
 * @returns {{ delays: number[], message: object } | null}
 */
export function selectCopyPlan(result) {
  if (!result?.ok || !result.copy) return null;
  return { delays: [0, 450, 1200], message: { dgn: 'select-by-id', artboardId: result.copy } };
}

/**
 * V2-8.5 c7 (08 ak-convert-after) — the message that makes the canvas draw "✓ Unchanged" under the post and
 * "+ 13 % height · Ink fill" on the copy. Facts only (ids, a percent, the fill's name): the canvas builds the words.
 * @param {{ from: string, to: string, plan: { extraPct?: number, fill?: string | null } }} a
 */
export function convertMarksMessage({ from, to, plan }) {
  return {
    dgn: 'convert-marks',
    v: 1,
    from,
    to,
    extraPct: Number.isFinite(plan?.extraPct) ? plan.extraPct : 0,
    fill: typeof plan?.fill === 'string' && plan.fill ? plan.fill : null,
  };
}
