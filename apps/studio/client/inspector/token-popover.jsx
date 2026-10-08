// inspector/token-popover.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useEffect, useRef, useState } from 'react';
import { StIcon } from '../shell/icons.jsx';
import { createPortal } from 'react-dom';
import { ColorPicker } from './color-picker.jsx';
import { cssColorToHex } from './color.js';

// Phase 12.3 (W2.1) — token picker as a Figma-style popover instead of a native
// <select>. `kind='color'` renders a swatch grid (resolved DS color values);
// `kind='value'` a variable list (pretty name + resolved value, à la Figma's
// variable picker). Picking commits `var(--token)`. Portals to <body> +
// fixed-positions from the trigger rect so the panel's overflow never clips it.
export function TokenPopover({ kind, groups, current, onPick, label, swatchBg, seedHex, activeDs, swatchClassName }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState(null);
  // Phase 12.3 (#4) — colour popover gets two tabs: a normal colour input
  // (Custom) + the DS variables swatch list (Variables). Token-able non-colour
  // popovers stay single-mode.
  const [mode, setMode] = useState('custom');
  const [query, setQuery] = useState('');
  const btnRef = useRef(null);
  const popRef = useRef(null);
  const bound = typeof current === 'string' && /var\(\s*--/.test(current);
  const isOn = (n) => current === `var(${n})`;
  const pretty = (n) => n.replace(/^--/, '').replace(/-/g, ' ');
  const gs = groups || [];
  const total = gs.reduce((s, g) => s + (g.names?.length || 0), 0);
  const showDsHeaders = gs.length > 1; // group by DS only when there's >1
  // Search filter over the token name + resolved value, per group.
  const q = query.trim().toLowerCase();
  const filteredGs = !q
    ? gs
    : gs
        .map((g) => ({
          ...g,
          names: (g.names || []).filter(
            (n) =>
              pretty(n).toLowerCase().includes(q) ||
              n.toLowerCase().includes(q) ||
              (g.vals?.[n] || '').toLowerCase().includes(q)
          ),
        }))
        .filter((g) => g.names.length);

  useEffect(() => {
    if (!open) {
      setQuery('');
      return undefined;
    }
    const place = () => {
      const r = btnRef.current?.getBoundingClientRect();
      if (!r) return;
      const W = 224;
      const MAXH = 300;
      let left = Math.min(r.right - W, window.innerWidth - W - 8);
      if (left < 8) left = 8;
      const below = window.innerHeight - r.bottom;
      const top = below > MAXH + 8 ? r.bottom + 4 : Math.max(8, r.top - MAXH - 4);
      setPos({ left, top, width: W, maxHeight: MAXH });
    };
    place();
    const onDoc = (e) => {
      if (popRef.current?.contains(e.target) || btnRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Task 6 (feature-inspector-controls-redesign) — RE-ANCHOR on scroll/resize
    // instead of dismissing. `place()` computes viewport-relative coordinates
    // from `getBoundingClientRect()`, but this fixed-positioned popover's actual
    // containing block is whichever ANCESTOR (if any) has a transform/filter/
    // will-change — e.g. the right panel's mount-in `st-panel-in` transform —
    // not necessarily the viewport. Re-running place() keeps it glued to the
    // trigger through any layout change instead of vanishing on the first
    // scroll (the old dismiss-on-scroll workaround for the same root cause).
    const onScroll = (e) => {
      if (popRef.current?.contains(e.target)) return;
      place();
    };
    document.addEventListener('pointerdown', onDoc, true);
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', place);
    document.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('pointerdown', onDoc, true);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', place);
      document.removeEventListener('scroll', onScroll, true);
    };
  }, [open]);

  // Transform-ancestor compensation — regardless of WHICH ancestor ends up
  // establishing this fixed popover's containing block, measure where it
  // actually landed vs where `place()` intended (viewport-relative) and cancel
  // out the delta. This is correct independent of the cause, so it doesn't
  // require hunting down every transform/filter/will-change that could ever
  // apply between `document.body` (the portal target) and this element.
  // Converges in at most one correction: once the delta is compensated, the
  // measured rect matches the intended position and the effect is a no-op.
  useEffect(() => {
    if (!open || !pos || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    const dx = pos.left - r.left;
    const dy = pos.top - r.top;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      setPos((p) => (p ? { ...p, left: p.left + dx, top: p.top + dy } : p));
    }
  }, [open, pos]);

  // Pick a token. #3 — apply CORRECTLY across design systems: a token from the
  // canvas's OWN active DS commits `var(--token)` (round-trips + resolves right);
  // a token from ANOTHER DS commits its RESOLVED value (literal), because
  // `var(--token)` would resolve against the canvas's DS scope and paint the WRONG
  // colour. So what you click is always what's applied ("natvrdo").
  // SECURITY (ethical-hacker A3) — a cross-DS token value is committed as a
  // LITERAL, and its source is a (possibly hub-pushed, untrusted) tokens CSS.
  // A colour-shaped value can still smuggle a fetch primitive (e.g.
  // `rgb(1 2 3) url(//x)` passes the colour sniff). Refuse to write a literal
  // carrying url()/image-set()/expression()/@import — fall back to var(), which
  // resolves against the CANVAS's own DS (never the attacker's value).
  const UNSAFE_TOKEN_VALUE = /url\(|image-set\(|cross-fade\(|element\(|expression\(|@import|javascript:/i;
  const pickFrom = (ds, n, resolved) => {
    if (activeDs && ds && ds !== activeDs && resolved && !UNSAFE_TOKEN_VALUE.test(resolved)) {
      onPick(resolved);
    } else {
      onPick(`var(${n})`);
    }
    setOpen(false);
  };
  // Custom colour / hex applies LIVE without closing, so the user can keep
  // tweaking; the popover dismisses on outside-click / Esc like everything else.
  const applyRaw = (v) => {
    const val = (v || '').trim();
    if (val) onPick(val);
  };
  // A search field over the token list (name + value). Auto-focuses so the user
  // can type straight away.
  const searchBar = (
    <div className="st-cp-pop-search">
      <StIcon name="search" size={12} />
      <input
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search variables"
        aria-label="search variables"
        // biome-ignore lint/a11y/noAutofocus: focusing the search on open is the intent.
        autoFocus
      />
    </div>
  );
  // #2 — colour Variables as a scannable LIST (swatch · name · value), per DS.
  const swatchList = (grps) =>
    grps.map((g) => (
      <div className="st-cp-pop-group" key={g.ds}>
        {showDsHeaders ? <div className="st-cp-pop-ds">{g.ds}</div> : null}
        <div className="st-cp-pop-list">
          {g.names.map((n) => (
            <button
              key={`${g.ds}:${n}`}
              type="button"
              className={`st-cp-pop-row st-cp-pop-crow${isOn(n) ? ' is-on' : ''}`}
              onClick={() => pickFrom(g.ds, n, g.vals?.[n])}
            >
              <span
                className="st-cp-pop-cswatch"
                style={{ background: g.vals?.[n] || 'transparent' }}
                aria-hidden="true"
              />
              <span className="st-cp-pop-name">{pretty(n)}</span>
              <span className="st-cp-pop-val">{g.vals?.[n] || ''}</span>
            </button>
          ))}
        </div>
      </div>
    ));
  // The value-token list (non-colour), per DS.
  const valueList = (grps) =>
    grps.map((g) => (
      <div className="st-cp-pop-group" key={g.ds}>
        {showDsHeaders ? <div className="st-cp-pop-ds">{g.ds}</div> : null}
        <div className="st-cp-pop-list">
          {g.names.map((n) => (
            <button
              key={`${g.ds}:${n}`}
              type="button"
              className={`st-cp-pop-row${isOn(n) ? ' is-on' : ''}`}
              onClick={() => pickFrom(g.ds, n, g.vals?.[n])}
            >
              <span className="st-cp-pop-name">{pretty(n)}</span>
              <span className="st-cp-pop-val">{g.vals?.[n] || ''}</span>
            </button>
          ))}
        </div>
      </div>
    ));
  const noMatch = <div className="st-cp-pop-empty">No match</div>;

  return (
    <>
      {swatchBg !== undefined ? (
        // Colour rows: the swatch IS the trigger — one popover, no separate native
        // OS picker + ◇ (the "two popovers" the user flagged). Shows the current
        // colour; bound-to-token gets the accent ring.
        <button
          type="button"
          ref={btnRef}
          className={`${swatchClassName || 'st-cp-swatch st-cp-swatch--mini st-cp-swatch--trigger'}${bound && !swatchClassName ? ' is-bound' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || 'pick a colour'}
          title={current || 'pick a colour'}
          onClick={() => setOpen((v) => !v)}
        >
          <span style={{ position: 'absolute', inset: 0, background: swatchBg || 'transparent' }} />
        </button>
      ) : (
        <button
          type="button"
          ref={btnRef}
          className={`st-cp-tokbtn${bound ? ' is-bound' : ''}`}
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={label || 'pick a design token'}
          title="design tokens"
          onClick={() => setOpen((v) => !v)}
        >
          <span className="st-cp-tokbtn-glyph" aria-hidden="true" />
        </button>
      )}
      {open && pos
        ? createPortal(
            <div
              ref={popRef}
              // Portalled to <body> (outside the App's `.maude` div), so it must
              // re-establish the maude token scope itself — otherwise var(--bg-*)
              // resolves to the legacy :root project palette (the cream popover bug).
              className="maude st-cp-pop"
              data-theme={
                (typeof document !== 'undefined' &&
                  document.documentElement.getAttribute('data-theme')) ||
                'dark'
              }
              role="dialog"
              aria-label={label || 'design tokens'}
              style={{
                left: pos.left,
                top: pos.top,
                width: pos.width,
                maxHeight: pos.maxHeight,
              }}
            >
              {kind === 'color' ? (
                <>
                  <div className="st-cp-poptabs" role="tablist">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'custom'}
                      className={`st-cp-poptab${mode === 'custom' ? ' is-active' : ''}`}
                      onClick={() => setMode('custom')}
                    >
                      Custom
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={mode === 'vars'}
                      className={`st-cp-poptab${mode === 'vars' ? ' is-active' : ''}`}
                      onClick={() => setMode('vars')}
                    >
                      Variables
                    </button>
                  </div>
                  {mode === 'custom' ? (
                    <ColorPicker seed={seedHex || cssColorToHex(current) || '#000000'} onApply={applyRaw} />
                  ) : !total ? (
                    <div className="st-cp-pop-empty">No color tokens</div>
                  ) : (
                    <>
                      {searchBar}
                      {filteredGs.length ? swatchList(filteredGs) : noMatch}
                    </>
                  )}
                </>
              ) : !total ? (
                <div className="st-cp-pop-empty">No tokens for this property</div>
              ) : (
                <>
                  {searchBar}
                  {filteredGs.length ? valueList(filteredGs) : noMatch}
                </>
              )}
            </div>,
            document.body
          )
        : null}
    </>
  );
}
