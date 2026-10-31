// client/v2/inspector/sections/colour-popover.jsx — P6 T2 (inspector-ux-rules IR-8, IR-10; Michal O2a): the colour picker.
//
// One popover, opened from the chip, beside the Inspector card, on the TOP LAYER (the Popover API — it escapes the card's
// clipping and stacking; `placePopover` keeps it inside the window, F31). Top to bottom:
//   Search            filters by the token's name and its role word
//   Recent            the last 8 colours used in this project (recent-colours.js)
//   the system        a swatch grid grouped by role, schema order (colour-groups.js); a two-theme system shows Light | Dark
//                     split diagonally on each swatch; the selected token is ringed
//   Other colour…     the drawn OKLCH picker (ds/colour-picker.jsx) + a field for hex or oklch(); committing a raw colour
//                     in a system asks once (ds/off-system.jsx): "Use <nearest>" or "Add it to the system"
//   None              where a value may be absent
// With no design system the grid is replaced by one line, "This project has no design system yet", and one action.
// Keys (F30): focus starts in Search; ↓ enters the grid; ← → move within a group, ↑ ↓ between groups; ↵ picks; esc
// closes and gives focus back to the chip; Tab out closes.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { tokenLabel } from '../../../../edit-ops/words-css.ts';
import { isCssColor, paintFromCss } from '../../../../edit-ops/words-paint.ts';
import { deltaE } from '../../../../ds/nearest.ts';
import { ColourPicker } from '../../ds/colour-picker.jsx';
import { requestDsMake } from '../../ds/default-write.js';
import { addColourNow } from '../../ds/edge-write.js';
import { OffSystemQuestion } from '../../ds/off-system.jsx';
import { colourGroups, groupOf, swatchOf } from '../colour-groups.js';
import { rgbOf } from './colour-words.js';

export const POPOVER_W = 264;
const MARGIN = 8;
const GAP = 8;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), Math.max(lo, hi));

/**
 * Where the popover goes (F31 — it never runs off the window): beside the card on its left when there is room, else below
 * the chip, else above it, else wherever more room is (and it scrolls). Pure.
 * @param {{ chip: DOMRect|{left:number,top:number,right:number,bottom:number}, card?: {left:number}|null }} anchor
 * @param {{ w: number, h: number }} size
 * @param {{ w: number, h: number }} viewport
 */
export function placePopover(anchor, size, viewport) {
  const { chip } = anchor;
  const card = anchor.card || chip;
  const w = Math.min(size.w, viewport.w - 2 * MARGIN);
  const fullH = viewport.h - 2 * MARGIN;
  const h = Math.min(size.h, fullH);
  const besideLeft = card.left - GAP - w;
  if (besideLeft >= MARGIN) {
    return {
      side: 'left',
      left: besideLeft,
      top: clamp(chip.top - 12, MARGIN, viewport.h - MARGIN - h),
      maxHeight: fullH,
    };
  }
  const left = clamp(chip.left, MARGIN, viewport.w - MARGIN - w);
  const below = viewport.h - MARGIN - (chip.bottom + GAP);
  const above = chip.top - GAP - MARGIN;
  if (h <= below) return { side: 'below', left, top: chip.bottom + GAP, maxHeight: below };
  if (h <= above) return { side: 'above', left, top: chip.top - GAP - h, maxHeight: above };
  return below >= above
    ? { side: 'below', left, top: chip.bottom + GAP, maxHeight: below }
    : { side: 'above', left, top: MARGIN, maxHeight: above };
}

const asRgb = ([r, g, b]) => ({ r, g, b });
// within one step of 8-bit sRGB on every channel: the same colour to the eye (ds/nearest.ts `exact`)
const sameColour = (a, b) => a.every((v, i) => Math.abs(v - b[i]) <= 1);

/** The system token nearest to a raw colour (OKLab ΔE), within the slot's own group first (kg S10.17). */
export function nearestToken(css, colors, vals, preferGroup) {
  const rgb = rgbOf(css);
  if (!rgb) return null;
  const score = (names) => {
    let best = null;
    for (const n of names) {
      const t = rgbOf(vals[n]);
      if (!t) continue;
      const d = deltaE(asRgb(rgb), asRgb(t));
      if (!best || d < best.d) best = { token: n, d, exact: sameColour(rgb, t) };
    }
    return best;
  };
  const inGroup = preferGroup ? colors.filter((n) => groupOf(n) === preferGroup) : [];
  const best = (inGroup.length > 1 && score(inGroup)) || score(colors);
  return best ? { token: best.token, label: tokenLabel(best.token), exact: best.exact } : null;
}

function Swatch({ sw }) {
  return (
    <i
      className={`insp-pop-sw${sw.dark ? ' insp-pop-sw--two' : ''}`}
      aria-hidden="true"
      style={{
        '--sw-l': sw.light || 'transparent',
        '--sw-d': sw.dark || sw.light || 'transparent',
      }}
    />
  );
}

/**
 * @param {{ name: string, label: string, current: string|null, colors: string[], vals: Record<string,string>,
 *   themes?: object, hasSystem: boolean, systemLabel?: string, dsName?: string|null, slotGroup?: string|null,
 *   recent: string[], allowNone?: boolean, noneLabel?: string, isNone?: boolean, rawValue?: string|null,
 *   anchorRef: { current: HTMLElement|null }, onPick: (paint: object) => void, onNone: () => void,
 *   onClose: (opts?: { refocus?: boolean }) => void }} props
 */
export function ColourPopover({
  name,
  label,
  current,
  colors,
  vals,
  themes,
  hasSystem,
  systemLabel,
  dsName,
  slotGroup = null,
  recent,
  allowNone,
  noneLabel = 'None',
  isNone = false,
  rawValue = null,
  anchorRef,
  onPick,
  onNone,
  onClose,
}) {
  const ref = useRef(null);
  const [query, setQuery] = useState('');
  const [custom, setCustom] = useState(false);
  const [draft, setDraft] = useState(rawValue || '');
  const [bad, setBad] = useState(false);
  const [asked, setAsked] = useState(null); // the off-system question for the colour just written
  const [place, setPlace] = useState(null);
  const tokens = useMemo(() => ({ themes, vals }), [themes, vals]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    return colourGroups(colors)
      .map((g) => ({
        ...g,
        tokens: q
          ? g.tokens.filter(
              (t) =>
                t.toLowerCase().includes(q) ||
                tokenLabel(t).toLowerCase().includes(q) ||
                g.label.toLowerCase().includes(q)
            )
          : g.tokens,
      }))
      .filter((g) => g.tokens.length);
  }, [colors, query]);

  // top layer + collision-aware placement, measured once the popover has its size (and again when it grows)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `custom` / `asked` change the popover's height
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    try {
      if (typeof el.showPopover === 'function' && !el.matches?.(':popover-open')) el.showPopover();
    } catch {
      /* a host without the Popover API keeps it in flow, still placed */
    }
    const measure = () => {
      const chip = anchorRef.current?.getBoundingClientRect?.();
      if (!chip) return;
      const cardEl = anchorRef.current.closest?.('.insp');
      const card = cardEl?.getBoundingClientRect?.() || null;
      const r = el.getBoundingClientRect();
      setPlace(
        placePopover(
          { chip, card },
          { w: POPOVER_W, h: r.height || 360 },
          { w: window.innerWidth || 1280, h: window.innerHeight || 800 }
        )
      );
    };
    measure();
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('resize', measure);
      try {
        el.hidePopover?.();
      } catch {}
    };
  }, [anchorRef, custom, asked]);

  // a press anywhere else — the panel, the shell, or the canvas frame (the window loses focus) — puts it away
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const down = (e) => {
      const t = e.target;
      if (ref.current?.contains(t) || anchorRef.current?.contains(t)) return;
      closeRef.current();
    };
    const away = () => closeRef.current();
    document.addEventListener('pointerdown', down, true);
    window.addEventListener('blur', away);
    return () => {
      document.removeEventListener('pointerdown', down, true);
      window.removeEventListener('blur', away);
    };
  }, [anchorRef]);

  const commitRaw = (raw) => {
    const t = String(raw ?? '').trim();
    if (!t) return;
    if (!isCssColor(t)) return setBad(true);
    setBad(false);
    onPick({ css: t }, { keepOpen: hasSystem });
    if (!hasSystem) return onClose();
    // IR-10: the write happens first; the question is asked once, under the field, and never blocks
    const near = nearestToken(t, colors, vals, slotGroup);
    setAsked({ literal: t, nearest: near, target: near ? near.token : null });
  };

  // ← → within a group, ↑ ↓ between groups; ↓ from Search enters the grid
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      return onClose({ refocus: true });
    }
    const cells = [...(ref.current?.querySelectorAll('[data-cell]') ?? [])];
    const at = cells.indexOf(document.activeElement);
    const inSearch = document.activeElement?.dataset?.search === 'true';
    if (inSearch && e.key === 'ArrowDown' && cells[0]) {
      e.preventDefault();
      return cells[0].focus();
    }
    if (at < 0) return;
    const cell = cells[at];
    const g = Number(cell.dataset.g);
    const i = Number(cell.dataset.i);
    const inGroup = (gi) => cells.filter((c) => Number(c.dataset.g) === gi);
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const row = inGroup(g);
      const d = e.key === 'ArrowRight' ? 1 : -1;
      next = row[(i + d + row.length) % row.length];
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const gs = [...new Set(cells.map((c) => Number(c.dataset.g)))];
      const gi = gs.indexOf(g) + (e.key === 'ArrowDown' ? 1 : -1);
      if (gi < 0) {
        next = ref.current?.querySelector('[data-search="true"]');
      } else if (gi < gs.length) {
        const row = inGroup(gs[gi]);
        next = row[Math.min(i, row.length - 1)];
      }
    }
    if (next) {
      e.preventDefault();
      next.focus();
    }
  };
  const onBlur = (e) => {
    const to = e.relatedTarget;
    if (to && ref.current && !ref.current.contains(to) && !anchorRef.current?.contains(to))
      onClose();
  };

  const style = place
    ? { position: 'fixed', left: place.left, top: place.top, maxHeight: place.maxHeight }
    : { position: 'fixed', visibility: 'hidden' };

  return (
    <div
      ref={ref}
      className="insp-pop"
      role="dialog"
      aria-label={label}
      popover="manual"
      data-testid={`insp-menu-${name}`}
      data-side={place?.side}
      style={style}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <input
        className="insp-pop-search"
        type="search"
        aria-label={`Search ${label.toLowerCase()}`}
        placeholder="Search colours"
        data-search="true"
        data-testid={`insp-pop-search-${name}`}
        value={query}
        autoFocus
        onChange={(e) => setQuery(e.currentTarget.value)}
      />
      {recent.length ? (
        <div className="insp-pop-g" data-testid={`insp-pop-recent-${name}`}>
          <p className="insp-pop-gt">Recent</p>
          <div className="insp-pop-grid">
            {recent.map((css, i) => {
              const p = paintFromCss(css);
              const sw = 'token' in p ? swatchOf(p.token, tokens) : { light: css, dark: null };
              const word = 'token' in p ? tokenLabel(p.token) : css;
              return (
                <button
                  key={css}
                  type="button"
                  className="insp-pop-cell"
                  data-cell="true"
                  data-g={-1}
                  data-i={i}
                  aria-label={word}
                  title={word}
                  data-testid={`insp-recent-${name}-${i}`}
                  onClick={() => onPick(p)}
                >
                  <Swatch sw={{ light: sw.light || p.fallback || css, dark: sw.dark }} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {hasSystem ? (
        groups.map((g, gi) => (
          <div key={g.id} className="insp-pop-g" data-testid={`insp-pop-group-${name}-${g.id}`}>
            <p className="insp-pop-gt">{g.label}</p>
            <div className="insp-pop-grid">
              {g.tokens.map((t, i) => {
                const word = tokenLabel(t);
                const on = current === t;
                return (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={on}
                    className="insp-pop-cell"
                    data-cell="true"
                    data-g={gi}
                    data-i={i}
                    aria-label={`${word}, ${g.label}`}
                    title={`${word} · ${g.label}`}
                    data-testid={`insp-color-${name}-${t.replace(/^--/, '')}`}
                    onClick={() => onPick({ token: t })}
                  >
                    <Swatch sw={swatchOf(t, tokens)} />
                  </button>
                );
              })}
            </div>
          </div>
        ))
      ) : (
        <div className="insp-pop-nods" data-testid={`insp-pop-nods-${name}`}>
          <p>This project has no design system yet.</p>
          <button
            type="button"
            className="insp-pop-link"
            data-testid={`insp-pop-make-ds-${name}`}
            onClick={() => {
              onClose();
              requestDsMake({});
            }}
          >
            Make a design system
          </button>
        </div>
      )}
      {hasSystem && !groups.length ? (
        <p className="insp-pop-empty" data-testid={`insp-pop-empty-${name}`}>
          No colour is called “{query.trim()}”.
        </p>
      ) : null}
      <div className="insp-pop-foot">
        <button
          type="button"
          className="insp-menu-i"
          aria-expanded={custom}
          data-testid={`insp-colorcss-${name}`}
          onClick={() => setCustom((c) => !c)}
        >
          Other colour…
        </button>
        {custom ? (
          <div className="insp-pop-custom" data-testid={`insp-pop-custom-${name}`}>
            <ColourPicker
              label={label}
              value={isCssColor(draft) ? draft : '#808080'}
              onChange={(hex) => {
                setDraft(hex);
                setBad(false);
              }}
              onEnd={() => {}}
            />
            <span className="insp-num">
              <input
                className="insp-num-in insp-color-in"
                type="text"
                aria-label={`${label} — a colour`}
                aria-invalid={bad || undefined}
                data-testid={`insp-colorin-${name}`}
                placeholder="Example: #1E6BFF"
                value={draft}
                onChange={(e) => setDraft(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRaw(e.currentTarget.value);
                }}
              />
            </span>
            <button
              type="button"
              className="btn btn--primary insp-pop-use"
              data-testid={`insp-pop-use-${name}`}
              disabled={!draft.trim()}
              onClick={() => commitRaw(draft)}
            >
              Use this colour
            </button>
            {bad ? (
              <p className="insp-pop-bad" role="alert" data-testid={`insp-pop-bad-${name}`}>
                That isn’t one colour. Try a hex like #1E6BFF.
              </p>
            ) : null}
          </div>
        ) : null}
        {asked ? (
          <OffSystemQuestion
            finding={asked}
            systemLabel={systemLabel}
            canvasName={label}
            onUse={async () => {
              if (asked.target) onPick({ token: asked.target });
              onClose();
              return { ok: true };
            }}
            onAdd={async () => {
              const r = await addColourNow({ ds: dsName, value: asked.literal });
              if (r.ok) onClose();
              return r;
            }}
            onDismiss={() => setAsked(null)}
          />
        ) : null}
        {allowNone ? (
          <button
            type="button"
            aria-pressed={isNone}
            className="insp-menu-i"
            data-testid={`insp-none-${name}`}
            onClick={onNone}
          >
            {noneLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
