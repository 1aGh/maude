// client/v2/inspector/kinds/artboard-advanced.jsx — S2.8: the artboard's Advanced fold (A-artboard-theme).
// Kept apart from artboard.jsx because that file registers the artboard's sections on import; the fold only needs
// this one row, and importing it must not make the inspector think a section has landed.

import { useEffect, useState } from 'react';
import { Select } from '../../../inspector-controls.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { ArtboardAdvancedRows } from './artboard-advanced-rows.jsx';
import { THEME_OPTIONS, artboardFacts } from './artboard-model.js';

/** Advanced › Theme (A-artboard-theme): the pin the artboard menu's Theme submenu has always set. */
export function ArtboardAdvanced({ el, ctx }) {
  const f = artboardFacts(el);
  const h = ctx?.artboard || {};
  // the pin is session state in the canvas; the payload carries it only when the selection is re-read, so the
  // row shows what was just picked until a fresh payload says otherwise
  const [picked, setPicked] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh payload (or another artboard) drops the local pick
  useEffect(() => setPicked(null), [f.id, f.theme]);
  if (!h.onSetArtboardTheme) return null;
  return (
    <div className="insp-adv insp-adv--artboard">
      <Row k="Theme" name="ab-theme">
        <Select
          value={picked ?? f.theme}
          ariaLabel="Artboard theme"
          testId="insp-ab-theme"
          options={THEME_OPTIONS}
          onChange={(mode) => {
            if (!f.id) return;
            setPicked(mode);
            h.onSetArtboardTheme(f.id, mode);
          }}
        />
      </Row>
      <Quiet testid="insp-ab-theme-note">
        Follow chrome tracks the studio's light or dark; the others pin this artboard.
      </Quiet>
      {/* S7.21 — exact size, Clip content, Kind and the kind's facts (web page · fixed size · video) */}
      <ArtboardAdvancedRows el={el} ctx={ctx} />
    </div>
  );
}
