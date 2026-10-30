// client/v2/create/render-error.jsx — S6.12 (C5, 01 `cf-render-error`): a canvas that draws, then throws.
//
// The code compiles and then fails while it draws. The canvas keeps holding its last good render (DDR-077), so
// the card sits OVER that render, dimmed: "<Canvas> can't be drawn right now." — what happened, that nothing is
// lost, ONE way out (Go back to 14:05 = `history.go-back`, a new version). Ask AI to fix it is a chip in the AI
// panel (repair-offer.js; pre-fills the composer, never sends — P8 C8). The error itself sits under Show details, the only place it appears.
//
// This is S11.7's ONE card (`CanvasErrorCard kind: 'render'`) — not a second one. A cold open that never drew
// has no render to hold: the canvas's index thumbnail sits dimmed behind the card instead.
//
// Silent while a run of this Mac draws on the canvas; shown if the canvas is still broken when the run ends
// (use-render-error.js `cardShown`).

import { useEffect } from 'react';
import { useAiRuns } from '../ai/runs-store.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';
import { indexMeta } from '../canvases/tree-model.js';
import { CanvasErrorCard } from '../code/canvas-error-card.jsx';
import { askAiText, goBackToLastGood } from '../code/use-canvas-source.js';
import { setRepairOffer } from './repair-offer.js';
import { cardShown } from './use-render-error.js';

/** The canvas's index cover, dimmed — what stands behind the card when this session never saw it draw. */
function ColdThumb({ canvas, designRel, fetchImpl }) {
  const snapshot = useCanvasIndex({ fetchImpl });
  const rel = designRel && !canvas.startsWith(`${designRel}/`) ? `${designRel}/${canvas}` : canvas;
  const cover = indexMeta(snapshot, designRel).get(rel)?.cover;
  if (!cover) return null;
  return (
    <img
      className="rr-thumb"
      data-testid="render-error-thumb"
      src={`/_api/thumb/${cover}`}
      alt=""
      draggable={false}
    />
  );
}

/**
 * Mount inside the viewport. `entry` is this canvas's row of the render ledger (use-render-error.js).
 *
 * `canEdit` / `askAiAvailable` are the shell's answers (Go back writes a version, so it is for people who may
 * edit; AI chat is the desktop app's); the server enforces both regardless.
 */
export function RenderErrorHost({
  canvas,
  entry,
  designRel = '.design',
  loadFailed = false,
  viewing = false,
  canEdit = true,
  askAiAvailable = false,
  onReload,
  onNotify,
  onCopy,
  fetchImpl,
  runsStore,
}) {
  const { view } = useAiRuns(runsStore);
  const shown = cardShown({ entry, canvas, view, designRel, loadFailed, viewing });
  // P8 C8 (01 cf-render-error): the card carries ONE verb. The AI repair moves to a chip in the AI panel
  // (repair-offer.js → Suggest.jsx); here it is only announced, while the card is up.
  const offer =
    shown && askAiAvailable
      ? askAiText({
          canvas,
          kind: 'render',
          error: { kind: 'render', message: entry.message, file: canvas, line: 0, column: 0 },
        })
      : null;
  useEffect(() => {
    setRepairOffer(canvas, offer);
    return () => setRepairOffer(canvas, null);
  }, [canvas, offer]);
  if (!shown) return null;

  const lastGood = entry.lastGoodAt ? { at: entry.lastGoodAt } : null;
  const goBack = async () => {
    const r = await goBackToLastGood(canvas, { fetchImpl });
    onNotify?.(r.line, r.ok);
    // the restore is a source change like any other: the canvas redraws (HMR) and says `render-ok`, which
    // clears this card — nothing to do here but say how it went
  };
  return (
    <div className="rr-host" role="alert" data-testid="render-error-host">
      {lastGood ? null : <ColdThumb canvas={canvas} designRel={designRel} fetchImpl={fetchImpl} />}
      <CanvasErrorCard
        canvas={canvas}
        kind="render"
        error={{
          kind: 'render',
          message: entry.message,
          file: canvas,
          line: 0,
          column: 0,
          lineText: '',
        }}
        lastGood={lastGood}
        askAiAvailable={false}
        onGoBack={canEdit ? goBack : undefined}
        onReload={onReload}
        onCopy={onCopy}
      />
    </div>
  );
}
