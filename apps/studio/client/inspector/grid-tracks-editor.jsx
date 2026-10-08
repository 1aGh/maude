// inspector/grid-tracks-editor.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { GRID_KEYWORD_UNITS } from '../../grid-track-handles.ts';
import { NumberField, Select, UnitSelect } from '../inspector-controls.jsx';
import { GRID_TRACK_UNITS } from './css-vocab.jsx';

// feature-3-web-artboards T5 (absorbed feature-grid-track-editor stub) — the
// CssKnobs "Grid" section's track-list editor: one row per track (a
// NumberField + UnitSelect for a numeric px/%/fr/em track, a bare Select for
// a keyword auto/min-content/max-content track since it carries no numeric
// value), + add/remove. `tracks`/`onChange` are the parsed/serialized shape
// from `grid-track-handles.ts` — the SAME module the on-canvas gutter-drag
// overlay uses, so the Inspector and the drag handles never disagree.
export function GridTracksEditor({ label, tracks, editable, onChange }) {
  const setUnit = (idx, unit) => {
    const cur = tracks[idx];
    onChange(
      tracks.map((t, i) =>
        i === idx
          ? GRID_KEYWORD_UNITS.has(unit)
            ? { value: 0, unit }
            : { value: cur.value || 1, unit }
          : t
      )
    );
  };
  const setValue = (idx, value) => {
    onChange(tracks.map((t, i) => (i === idx ? { ...t, value } : t)));
  };
  const addTrack = () => onChange([...tracks, { value: 1, unit: 'fr' }]);
  const removeTrack = (idx) => onChange(tracks.filter((_, i) => i !== idx));
  return (
    <div className="st-cp-gridtracks">
      <div className="st-cp-gridtracks-hd">
        <span className="st-cp-gridtracks-label">{label}</span>
        <button
          type="button"
          className="st-btn st-cp-gridtracks-add"
          disabled={!editable}
          onClick={addTrack}
        >
          + Track
        </button>
      </div>
      {tracks.length === 0 ? (
        <div className="st-cp-note">
          No explicit tracks — add one to start defining {label.toLowerCase()}.
        </div>
      ) : (
        tracks.map((t, idx) => {
          const isKeyword = GRID_KEYWORD_UNITS.has(t.unit);
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: tracks have no stable id;
            // add/remove/reorder all rebuild the array positionally, same as every
            // other index-keyed list in this file (e.g. the Layers tree rows).
            <div className="st-cp-gridtrack-row" key={idx}>
              {isKeyword ? (
                <Select
                  value={t.unit}
                  ariaLabel={`${label} track ${idx + 1}`}
                  options={GRID_TRACK_UNITS.map((u) => ({ value: u, label: u }))}
                  onChange={(u) => setUnit(idx, u)}
                />
              ) : (
                <NumberField
                  value={t.value}
                  min={t.unit === 'fr' ? 0.1 : 0}
                  step={t.unit === 'fr' ? 0.1 : 1}
                  ariaLabel={`${label} track ${idx + 1} value`}
                  lead={String(idx + 1)}
                  unitSlot={
                    <UnitSelect
                      value={t.unit}
                      units={GRID_TRACK_UNITS}
                      ariaLabel={`${label} track ${idx + 1} unit`}
                      onChange={(u) => setUnit(idx, u)}
                    />
                  }
                  onCommit={(n) => setValue(idx, n)}
                />
              )}
              <button
                type="button"
                className="st-btn st-cp-gridtrack-remove"
                aria-label={`remove ${label} track ${idx + 1}`}
                disabled={!editable || tracks.length <= 1}
                onClick={() => removeTrack(idx)}
              >
                ×
              </button>
            </div>
          );
        })
      )}
    </div>
  );
}
