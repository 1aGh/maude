// client/v2/annotations/stamp-row.jsx — S4.13 (canvas 15 `an-stamps`, `.an-stpop`): after ONE stamp the
// Stickers gallery folds to this row, so voting is one click per spot. The picked stamp is lit; picking
// another changes which one the canvas has armed; the chevron opens the whole gallery again; Esc lets go (the board draws no
// Done button).
//
// It is the gallery's own island, not a second panel (the mode lane's M4 check and the tool-panel gate still
// see ONE `tool-panel-stickers`). No scrim: the clicks that stamp must reach the canvas.

import { STAMPS, StampGlyph } from './stamps-glyphs.jsx';
import { v2Scope } from './v2-scope.js';

/**
 * @param active the armed stamp id
 * @param onPickStamp (stampId) => void — arms another stamp
 * @param onExpand () => void — back to the whole gallery
 * @param style the gallery's anchored placement (so the row sits where the gallery was)
 */
export default function StampRow({ active, onPickStamp, onExpand, style, placement }) {
  return (
    <div
      {...v2Scope('island sg-stamprow')}
      data-testid="tool-panel-stickers"
      data-folded="stamps"
      data-placement={placement}
      data-anchor={style && '--sg-slot-x' in style ? 'slot' : undefined}
      style={style}
      role="toolbar"
      aria-label="Stamps"
    >
      <span className="sg-stamprow-l">Stamps</span>
      {STAMPS.map((s) => (
        <button
          key={s.id}
          type="button"
          className={`sg-stamprow-b sg-stamp--${s.tone}`}
          title={s.name}
          aria-label={s.name}
          aria-pressed={s.id === active}
          data-testid={`stamps-row-${s.id}`}
          data-on={s.id === active ? 'true' : undefined}
          onClick={() => onPickStamp(s.id)}
        >
          <StampGlyph id={s.id} size={18} />
        </button>
      ))}
      <button
        type="button"
        className="sg-stamprow-more"
        title="All stickers"
        aria-label="All stickers"
        data-testid="stamps-row-more"
        onClick={onExpand}
      >
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path
            d="M4 10l4-4 4 4"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </div>
  );
}
