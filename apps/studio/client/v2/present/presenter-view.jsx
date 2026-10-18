// client/v2/present/presenter-view.jsx — S3.6b: Presenter view on the Mac (04 md-presenter, "Your screen,
// not theirs"). The audience gets the artboard on the second display; the Mac shows now, next, notes, the
// clock — and the order as the canvas itself, so you can jump by where things live.
//
//   top bar   canvas name · [Presenter view]      12:48 elapsed · 14:05      Audience on <display> · End esc
//   Now       the presented artboard · Previous / Next
//   Next      the one after it in the run     Notes   the presented artboard's speaker notes
//   Order     <OrderMap> · legend
//
// Presentational: everything arrives as props (the host, presenter-host.jsx, reads the shell). The words
// are the canvas's (CONTRACT §3–§4). Notes and names are rendered as TEXT only.

import { StIcon } from '../../shell/icons.jsx';
import { canStep } from './present-controls-model.js';
import { OrderMap } from './order-map.jsx';
import {
  audienceLine,
  elapsedText,
  noteParagraphs,
  nowAndNext,
  orderCaption,
  orderCells,
  wallText,
} from './presenter-model.js';

const MAP_BOX = { w: 520, h: 232 };

/** One of the two screen boxes (Now / Next): the artboard in its own shape, named. */
function ArtBox({ cell, testid, renderArt }) {
  const ratio = cell && cell.h > 0 ? cell.w / cell.h : 16 / 9;
  return (
    <div className="pv-box" data-testid={testid} style={{ aspectRatio: String(ratio) }}>
      {cell ? (
        <>
          {renderArt ? renderArt(cell) : null}
          <span className="pv-box-label">{cell.label}</span>
        </>
      ) : (
        <span className="pv-box-label pv-box-label--quiet">The end</span>
      )}
    </div>
  );
}

/**
 * @param canvasName the canvas's display name
 * @param position `present-position` echo `{ index, total, artboardId }`
 * @param artboards `[{ id, label, x, y, w, h }]` in canvas order (rects optional: a grid is drawn without)
 * @param saved `{ present, notes }` from the canvas's `.meta.json`
 * @param elapsedMs / now the clock
 * @param audience `{ status: 'on' | 'opening' | 'waiting' | 'failed', displayName, message }`
 * @param onStep (to: 'next' | 'prev' | number) => void
 * @param onEnd () => void — End (esc)
 * @param onRetry () => void — try the audience screen again
 * @param renderArt (cell) => node — a thumbnail slot
 */
export function PresenterView({
  canvasName = '',
  position,
  artboards,
  saved,
  elapsedMs = 0,
  now = null,
  audience = { status: 'on' },
  onStep,
  onEnd,
  onRetry,
  renderArt = null,
}) {
  const map = orderCells(artboards, saved, position?.artboardId ?? null);
  const { at, nowId, nextId } = nowAndNext(map.run, position);
  const cellOf = (id) => map.cells.find((c) => c.id === id) ?? null;
  const nowCell = cellOf(nowId);
  const nextCell = cellOf(nextId);
  const notes = noteParagraphs(nowId ? map.notes.get(nowId) : '');
  const runTotal = map.run.length;
  const failed = audience?.status === 'failed';

  return (
    <section className="pv" data-testid="presenter-view" aria-label="Presenter view">
      <header className="pv-top">
        <span className="pv-name">
          {canvasName}
          <span className="chip pv-chip">Presenter view</span>
        </span>
        <span className="pv-clock">
          <strong data-testid="presenter-elapsed">{elapsedText(elapsedMs)}</strong>
          <span>elapsed</span>
          <span className="pv-wall" data-testid="presenter-wall">
            {wallText(now)}
          </span>
        </span>
        <span className="pv-right">
          <span
            className={`pv-aud${failed ? ' is-failed' : ''}`}
            data-testid="presenter-audience"
            role={failed ? 'alert' : undefined}
          >
            <StIcon name="laptop" size={14} />
            <span>{audienceLine(audience)}</span>
          </span>
          {failed ? (
            <button
              type="button"
              className="btn btn--sm"
              data-testid="presenter-audience-retry"
              onClick={() => onRetry?.()}
            >
              Try again
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn--sm"
            data-testid="presenter-end"
            onClick={() => onEnd?.()}
          >
            End<kbd className="kbd">esc</kbd>
          </button>
        </span>
      </header>

      <div className="pv-grid">
        <div className="pv-now">
          <p className="island-title pv-l" data-testid="presenter-now-label">
            {nowCell ? `Now · ${at + 1} of ${runTotal} · ${nowCell.label}` : 'Now'}
          </p>
          <ArtBox cell={nowCell} testid="presenter-now" renderArt={renderArt} />
          <div className="pv-under">
            <button
              type="button"
              className="btn"
              data-testid="presenter-prev"
              disabled={!canStep(position, 'prev')}
              onClick={() => onStep?.('prev')}
            >
              <span className="pv-flip">
                <StIcon name="chevron-right" size={14} />
              </span>
              Previous
            </button>
            <button
              type="button"
              className="btn btn--primary"
              data-testid="presenter-next"
              disabled={!canStep(position, 'next')}
              onClick={() => onStep?.('next')}
            >
              Next
              <StIcon name="chevron-right" size={14} />
            </button>
            <span className="pv-hint">
              <kbd className="kbd">←</kbd>
              <kbd className="kbd">→</kbd>
              <kbd className="kbd">space</kbd> or a clicker · <kbd className="kbd">L</kbd> pointer ·
              only you see this screen
            </span>
          </div>
        </div>

        <div className="pv-side">
          <p className="island-title pv-l" data-testid="presenter-next-label">
            {nextCell ? `Next · ${nextCell.label}` : 'Next · the end'}
          </p>
          <ArtBox cell={nextCell} testid="presenter-next-box" renderArt={renderArt} />
          <p className="island-title pv-l">Notes</p>
          <div className="pv-notes" data-testid="presenter-notes">
            {notes.length ? (
              notes.map((line, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: a static list of lines
                <p key={i}>{line}</p>
              ))
            ) : (
              <p className="pv-quiet">No notes for this artboard.</p>
            )}
          </div>
        </div>
      </div>

      <div className="pv-order">
        <p className="island-title pv-l" data-testid="presenter-order-count">
          {orderCaption(map.total, map.skipped)}
        </p>
        <div className="pv-order-row">
          <OrderMap
            cells={map.cells}
            width={map.width}
            height={map.height}
            boxW={MAP_BOX.w}
            boxH={MAP_BOX.h}
            onJump={(to) => onStep?.(to)}
            renderArt={renderArt}
          />
          <div className="pv-legend">
            <p>
              {map.custom
                ? 'The order is the one you set. Click any artboard to jump there.'
                : 'The order follows the canvas: row by row, left to right. Click any artboard to jump there.'}
            </p>
            <p className="pv-legend-r">
              <StIcon name="eye-off" size={13} />
              Skipped — it stays on the canvas, out of the run.
            </p>
            <p className="pv-quiet">Order and notes… changes it.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
