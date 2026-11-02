// client/v2/inspector/kinds/artboard-advanced.jsx — the artboard's Advanced fold.
// Kept apart from artboard.jsx because that file registers the artboard's sections on import; importing the fold
// must not make the inspector think a section has landed. r4 #6: no Theme row — the canvas's Light | Dark pill governs
// every artboard (canvas-theme-pill.tsx).

import { Row as AdvRow } from '../advanced-rows-default.jsx';
import { ArtboardAdvancedRows } from './artboard-advanced-rows.jsx';
import { artboardFacts } from './artboard-model.js';

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
 * (Clip content and Kind, which stay: Kind is the only place a board's kind is switched) and In code.
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

/** Advanced › Clip content / Kind and the kind's facts. There is no Theme row: the canvas's one Light | Dark pill governs every artboard (r4 #6). */
export function ArtboardAdvanced({ el, ctx, print = false }) {
  if (!print && artboardFacts(el).kind === 'digital')
    return <FixedSizeAdvanced el={el} ctx={ctx} />;
  return (
    <div className="insp-adv insp-adv--artboard">
      {/* S7.21 — exact size, Clip content, Kind and the kind's facts (web page · fixed size · video) */}
      <ArtboardAdvancedRows el={el} ctx={ctx} />
    </div>
  );
}
