// inspector/inspect-computed.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { cssSplitUnit } from './color.js';

// Phase 12.3 — live computed readout for the Inspect tab (replaces the stale
// "lands with the live CSS bridge (Phase 12)" callout — that bridge shipped).
// Reads the resolved values the selection already carries (dom-selection
// styleMapsFor → el.computed). Read-only; the CSS tab is where you edit.
export function InspectComputed({ el }) {
  const c = el?.computed || {};
  const a = el?.authored || {};
  // Prefer the authored token name (var(--accent) → "--accent") as the label;
  // fall back to the resolved value. The swatch always shows the RESOLVED color.
  const valueLabel = (prop) => {
    const av = a[prop];
    if (av && /var\(\s*--/.test(av)) return av.replace(/^var\(\s*|\s*\)$/g, '');
    return c[prop] || av || '';
  };
  const colorRow = (lbl, prop) => {
    const resolved = c[prop] || a[prop];
    if (!resolved) return null;
    return (
      <div className="st-insp-row" key={lbl}>
        <span className="st-insp-label">{lbl}</span>
        <div className="st-swatch-row">
          <span className="st-insp-swatch" style={{ background: resolved }} aria-hidden="true" />
          <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-1)' }}>
            {valueLabel(prop)}
          </span>
        </div>
      </div>
    );
  };
  const hasRadius = c['border-radius'] && c['border-radius'] !== '0px';
  const radiusN = hasRadius ? cssSplitUnit(c['border-radius']).n || c['border-radius'] : null;
  const font =
    c['font-size'] || c['font-weight']
      ? [c['font-size'], c['font-weight']].filter(Boolean).join(' / ')
      : null;
  const anyType = c['background-color'] || c.color || hasRadius || font;
  if (!anyType) return null;
  return (
    <>
      {hasRadius ? (
        <div className="st-insp-row">
          <span className="st-insp-label">Radius</span>
          <div className="st-insp-fields">
            <span className="st-fmini" style={{ flex: '0 0 auto', maxWidth: 84 }}>
              <span className="st-mtag">r</span>
              <input value={radiusN} readOnly aria-label="border radius" />
            </span>
            <span className="st-insp-unit">px</span>
          </div>
        </div>
      ) : null}
      {colorRow('Fill', 'background-color')}
      {colorRow('Text', 'color')}
      {font ? (
        <div className="st-insp-row">
          <span className="st-insp-label">Font</span>
          <div className="st-insp-fields">
            <span className="st-mono" style={{ fontSize: 11, color: 'var(--fg-0)' }}>
              {font}
            </span>
          </div>
        </div>
      ) : null}
    </>
  );
}
