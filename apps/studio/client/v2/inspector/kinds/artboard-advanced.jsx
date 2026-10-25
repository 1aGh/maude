// client/v2/inspector/kinds/artboard-advanced.jsx — S2.8: the artboard's Advanced fold (A-artboard-theme).
// Kept apart from artboard.jsx because that file registers the artboard's sections on import; the fold only needs
// this one row, and importing it must not make the inspector think a section has landed.

import { useEffect, useState } from 'react';
import { Select } from '../../../inspector-controls.jsx';
import { Row as AdvRow } from '../advanced-rows-default.jsx';
import { Quiet, Row } from '../sections/row.jsx';
import { ArtboardAdvancedRows } from './artboard-advanced-rows.jsx';
import { THEME_OPTIONS, artboardFacts } from './artboard-model.js';

/**
 * Advanced › Theme (A-artboard-theme): the pin the artboard menu's Theme submenu has always set. A print board draws
 * it as the first row of "Look and layout" (08 ak-advanced), so the row is its own piece.
 */
export function ArtboardThemeRow({ el, ctx }) {
  const f = artboardFacts(el);
  const h = ctx?.artboard || {};
  // the pin is session state in the canvas; the payload carries it only when the selection is re-read, so the
  // row shows what was just picked until a fresh payload says otherwise
  const [picked, setPicked] = useState(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a fresh payload (or another artboard) drops the local pick
  useEffect(() => setPicked(null), [f.id, f.theme]);
  if (!h.onSetArtboardTheme) return null;
  return (
    <>
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
    </>
  );
}

const H = ({ children }) => (
  <p className="insp-adv-h insp-sub">
    <span>{children}</span>
  </p>
);

/** The DCArtboard as the file carries it, for a Fixed size (06 ad-pinned › In code). */
export function digitalCodeOf(f) {
  const size = `width={${Math.round(f.w ?? 0)}} height={${Math.round(f.h ?? 0)}}${f.fixed ? ' fixed' : ''}`;
  return f.id ? `<DCArtboard id="${f.id}"\n  ${size}>` : `<DCArtboard ${size}>`;
}

/**
 * 06 ad-pinned: a Fixed size's fold is the board's three blocks — Exact size (the one size line), Look and layout
 * (Theme, then Clip content and Kind, which stay: Kind is the only place a board's kind is switched) and In code.
 * The raw `kind · width · height` fact rows are not repeated: Exact size says them once.
 */
function FixedSizeAdvanced({ el, ctx }) {
  const f = artboardFacts(el);
  const size = f.w != null && f.h != null ? `${Math.round(f.w)} × ${Math.round(f.h)} px` : '—';
  return (
    <div className="insp-adv insp-adv--artboard" data-testid="insp-ab-fixed-adv">
      <div className="insp-adv-block" data-testid="insp-ab-exact">
        <H>Exact size</H>
        <AdvRow k="Artboard" mono testid="insp-ab-exact-size">
          {size}
        </AdvRow>
      </div>
      <div className="insp-adv-block" data-testid="insp-ab-look">
        <H>Look and layout</H>
        <ArtboardThemeRow el={el} ctx={ctx} />
        <ArtboardAdvancedRows el={el} ctx={ctx} digital />
      </div>
      <div className="insp-adv-block" data-testid="insp-ab-code">
        <H>In code</H>
        <pre className="insp-code" data-testid="insp-ab-code-text">
          {digitalCodeOf(f)}
        </pre>
      </div>
    </div>
  );
}

/** Advanced › Theme, then Clip content / Kind and the kind's facts. `print`: Theme sits in Look and layout instead. */
export function ArtboardAdvanced({ el, ctx, print = false }) {
  if (!print && artboardFacts(el).kind === 'digital')
    return <FixedSizeAdvanced el={el} ctx={ctx} />;
  return (
    <div className="insp-adv insp-adv--artboard">
      {print ? null : <ArtboardThemeRow el={el} ctx={ctx} />}
      {/* S7.21 — exact size, Clip content, Kind and the kind's facts (web page · fixed size · video) */}
      <ArtboardAdvancedRows el={el} ctx={ctx} />
    </div>
  );
}
