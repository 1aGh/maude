// client/v2/inspector/warning-fix.js — S7.25: the ONE verb of a warning (08 ak-warnings). Registry `warning.fix`.
//
// A warning (kinds/warnings.ts) carries the `fix` its verb runs; this turns it into the write that exists for it, so a
// verb is never a new kind of edit:
//
//   Move inside   the layer's inline `translate` (`/_api/edit-css`) by the amount that brings it inside the safe margin
//   Allow longer  `artboardMeta[id].maxFrames` (`PATCH /_api/present-meta`, the same write the Timeline's switch makes)
//   Fix size      `artboard.set-print` (edit-op) — the print prop and the artboard's px size, rewritten together
//   Fit to width  the layer's `max-width: 100%` (`/_api/edit-css`)
//   Replace…      the picture's asset picker (`ctx.onReplaceMedia`), then the `image.replace` edit-op
//   Show          selects the layer on the canvas (`select-by-id`)
//
// Nothing here is a dialog and nothing blocks: a refusal comes back as one sentence. A write is one request, so ⌘Z takes it back.

import { saveMaxFrames } from '../timeline/advanced/video-cap.js';

const SAID = {
  'held-by-ai': 'Not changed. This belongs to AI until it’s done; Stop is in the AI chat.',
  locked: 'Not changed. This is locked; unlock it first.',
  stale: 'Not changed. The canvas changed underneath; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
};
const FAILED = 'Not changed; try again.';

async function postJson(url, body, fetchImpl) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { ok: false, message: 'Not changed. The studio could not be reached; try again.' };
  }
  let j = null;
  try {
    j = await res.json();
  } catch {
    /* an unreadable answer is a failure below */
  }
  if (res.ok && (j?.ok ?? true)) return { ok: true };
  return { ok: false, message: SAID[j?.code] ?? j?.message ?? FAILED };
}

/**
 * @param {{ fix: any }} warning
 * @param {{ canvas: string, artboardId: string, print?: any, ctx?: any }} at
 * @returns {Promise<{ ok: boolean, message?: string }>}
 */
export async function runWarningFix(warning, at, fetchImpl = globalThis.fetch) {
  const fix = warning?.fix;
  const { canvas, artboardId, ctx } = at;
  if (!fix || !canvas || !artboardId) return { ok: false, message: FAILED };
  switch (fix.kind) {
    case 'move-inside':
      return postJson(
        '/_api/edit-css',
        {
          canvas,
          id: fix.element,
          property: 'translate',
          value: `${fix.dx}px ${fix.dy}px`,
        },
        fetchImpl
      );
    case 'fit-width':
      return postJson(
        '/_api/edit-css',
        { canvas, id: fix.element, property: 'max-width', value: '100%' },
        fetchImpl
      );
    case 'fix-size':
      // any key of the print patch makes the op rewrite the px size from the prop; orientation is the one that changes nothing
      return postJson(
        '/_api/edit-op',
        {
          file: canvas,
          op: 'artboard.set-print',
          targets: [],
          params: {
            artboard: artboardId,
            orientation: at.print?.orientation === 'landscape' ? 'landscape' : 'portrait',
          },
        },
        fetchImpl
      );
    case 'allow-longer': {
      const r = await saveMaxFrames(canvas, artboardId, fix.maxFrames, fetchImpl);
      return { ok: r.ok, message: r.ok ? undefined : r.message };
    }
    case 'show':
      ctx?.onRunAction?.({
        dgn: 'select-by-id',
        id: fix.elements?.[0],
        artboardId,
        index: 0,
      });
      return { ok: true };
    case 'replace':
      ctx?.onReplaceMedia?.({
        id: fix.element,
        tag: 'img',
        attrs: {},
        refs: [{ artboard: artboardId, element: fix.element }],
      });
      return { ok: true };
    default:
      return { ok: false, message: FAILED };
  }
}
