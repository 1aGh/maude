// client/v2/present/order-map.jsx — S3.6b: the run drawn as the canvas itself (04 md-presenter).
//
// Every artboard sits where it lives on the canvas, numbered in the order Present plays them; the one on
// screen is ringed, a skipped one is dimmed with an eye-off and has no number. A click jumps both screens
// (`onJump(runIndex)` → `present-step { to }`), so the presenter finds a slide by where it lives.
//
// The cells are drawn from the artboards' rects alone — a label and a number, no pixels (the canvas has no
// per-artboard thumbnail route). `renderArt(cell)` is the slot a thumbnail will fill.

import { StIcon } from '../../shell/icons.jsx';

/**
 * @param cells `orderCells(...).cells` — { id, label, x, y, w, h, n, skipped, current }
 * @param width / height the layout's size in world units
 * @param boxW / boxH the space the map may take, in px
 * @param onJump (runIndex: number) => void
 */
export function OrderMap({ cells, width, height, boxW, boxH, onJump, renderArt = null }) {
  const k = width > 0 && height > 0 ? Math.min(boxW / width, boxH / height) : 0;
  const runTotal = cells.filter((c) => !c.skipped).length;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a scaled map of absolutely placed artboard cells, not a form fieldset
    <div
      className="pv-map"
      data-testid="presenter-order-map"
      role="group"
      aria-label="Order"
      style={{ width: width * k, height: height * k }}
    >
      {cells.map((c) => (
        <button
          key={c.id}
          type="button"
          className="pv-cell"
          data-testid={`presenter-cell-${c.id}`}
          data-n={c.n === null ? undefined : String(c.n)}
          data-skip={c.skipped ? 'true' : undefined}
          aria-current={c.current ? 'true' : undefined}
          aria-label={c.skipped ? `${c.label}, skipped` : `${c.label}, ${c.n} of ${runTotal}`}
          disabled={c.skipped}
          title={c.label}
          style={{ left: c.x * k, top: c.y * k, width: c.w * k, height: c.h * k }}
          onClick={() => {
            if (!c.skipped && c.n !== null) onJump?.(c.n - 1);
          }}
        >
          {renderArt ? renderArt(c) : null}
          <span className="pv-cell-label" aria-hidden="true">
            {c.label}
          </span>
          <span className="pv-cell-n" aria-hidden="true">
            {c.skipped ? (
              <span data-testid="presenter-skipped-mark" className="pv-cell-skip">
                <StIcon name="eye-off" size={10} />
              </span>
            ) : (
              c.n
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
