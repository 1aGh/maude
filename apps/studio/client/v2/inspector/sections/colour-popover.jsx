// client/v2/inspector/sections/colour-popover.jsx — P6 T2 (inspector-ux-rules IR-8, IR-10; Michal O2a) + r4 #4 (Michal: "color
// picker bych udelal jak ma Figma, at tam jsou tabs jednotlivych backgrounds"): the colour picker.
//
// One popover, opened from the chip, beside the Inspector card, on the TOP LAYER (the Popover API — it escapes the card's
// clipping and stacking; `placePopover` keeps it inside the window, F31). Top to bottom, as Figma has it:
//   Custom | Libraries                the two sources of a colour                                              [✕]
//   Solid · Gradient · Image          what the fill IS (only on a Fill; every other colour is a solid)
//   Custom                            Solid: the saturation × brightness area, hue, opacity, eyedropper, Hex/RGB/HSL;
//                                     Gradient: type, stops bar, stops + the picker for the selected stop;
//                                     Image: upload or a path; then Recent and "On this page"
//   Libraries                         Search, Recent, the design system's colours grouped by role (colour-groups.js); a
//                                     two-theme system shows Light | Dark split diagonally; the selected token is ringed;
//                                     with no system, one line and one action; None where a value may be absent
// The popover opens on Libraries when the project has a design system and the colour is a token, else on Custom.
// A raw colour committed in a system asks once (ds/off-system.jsx): "Use <nearest>" or "Add it to the system" (IR-10).
// Keys (F30): focus starts in Search (or the open tab); ↓ enters the swatches; ← → move within a row, ↑ ↓ between rows;
// ↵ picks; esc closes and gives focus back to the chip; Tab out closes.

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { tokenLabel } from '../../../../edit-ops/words-css.ts';
import { isCssColor, paintFromCss, paintToCss } from '../../../../edit-ops/words-paint.ts';
import { deltaE } from '../../../../ds/nearest.ts';
import { requestDsMake } from '../../ds/default-write.js';
import { addColourNow } from '../../ds/edge-write.js';
import { OffSystemQuestion } from '../../ds/off-system.jsx';
import { colourGroups, groupOf, swatchOf } from '../colour-groups.js';
import {
  GradientEditor,
  ImageEditor,
  PageColours,
  SolidEditor,
  useGradientFill,
  usePageColours,
} from './colour-custom.jsx';
import { kindOfFill, parseRgba, rgbToHex, rgbaCss, switchKind } from './colour-model.js';
import { rgbOf } from './colour-words.js';

export const POPOVER_W = 280;
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

const KINDS = [
  ['solid', 'Solid'],
  ['gradient', 'Gradient'],
  ['image', 'Image'],
];
const round2 = (n) => Math.round(n * 100) / 100;

/** A Recent swatch row (the store's last colours, tokens and raw alike). Shared by Custom and Libraries. */
function RecentRow({ name, recent, tokens, onPick }) {
  if (!recent.length) return null;
  return (
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
  );
}

/**
 * @param {{ name: string, label: string, current: string|null, colors: string[], vals: Record<string,string>,
 *   themes?: object, hasSystem: boolean, systemLabel?: string, dsName?: string|null, slotGroup?: string|null,
 *   recent: string[], allowNone?: boolean, noneLabel?: string, isNone?: boolean,
 *   value?: { paint: object, opacity: number }|null, showOpacity?: boolean, canvasFile?: string|null,
 *   fillApi?: { fill: object, set: Function, live: Function, upload?: Function, start: string, end: string }|null,
 *   anchorRef: { current: HTMLElement|null }, onPick: (paint: object, opts?: object) => void,
 *   onCustom: (paint: object, opacity: number) => void, onNone: () => void,
 *   onClose: (opts?: { refocus?: boolean }) => void }} props
 *   `fillApi` is only given by a Fill: it is what makes the Solid · Gradient · Image tabs (a text or border colour is
 *   always a solid). `onCustom` is a committed colour from the Custom tab; `onPick` a swatch (a token, Recent, the page).
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
  value = null,
  showOpacity = false,
  canvasFile = null,
  fillApi = null,
  anchorRef,
  onPick,
  onCustom,
  onNone,
  onClose,
}) {
  const ref = useRef(null);
  const [query, setQuery] = useState('');
  const fillKind = fillApi ? kindOfFill(fillApi.fill) : 'solid';
  const [kind, setKind] = useState(fillKind);
  const [tab, setTab] = useState(() => {
    const rawColour =
      !!value &&
      !('token' in value.paint) &&
      !/^\s*(?:currentcolor|inherit)/i.test(value.paint.css ?? '');
    return hasSystem && fillKind === 'solid' && !rawColour ? 'libraries' : 'custom';
  });
  const [asked, setAsked] = useState(null); // the off-system question for the colour just written
  const [place, setPlace] = useState(null);
  const tokens = useMemo(() => ({ themes, vals }), [themes, vals]);
  const pageColours = usePageColours(canvasFile);
  const gf = useGradientFill(fillApi, vals);

  // the kind follows the file when it changes under the popover (an undo, a teammate); an Image tab with nothing chosen yet
  // is only on screen, so a solid fill does not pull it back
  const seen = useRef(fillKind);
  useEffect(() => {
    if (seen.current === fillKind) return;
    seen.current = fillKind;
    setKind(fillKind);
  }, [fillKind]);

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
  // biome-ignore lint/correctness/useExhaustiveDependencies: tab / kind / asked change the popover's height
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
  }, [anchorRef, tab, kind, asked, pageColours.length]);

  // F30: focus starts in Search (Libraries) or on the open tab (Custom). Not `autoFocus` — that runs at mount, before
  // showPopover(), and a browser ignores focus() on a popover that is not rendered yet (the chip kept focus; r2-p6b IC1).
  // Nor on the mount commit either: the popover is `visibility: hidden` until it is placed. So: once, in the commit that
  // first has a place.
  const focused = useRef(false);
  useLayoutEffect(() => {
    if (!place || focused.current) return;
    focused.current = true;
    (
      ref.current?.querySelector('[data-search="true"]') ??
      ref.current?.querySelector('[role="tab"][aria-selected="true"]')
    )?.focus?.({ preventScroll: true });
  }, [place]);

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

  // ── what the person did ──────────────────────────────────────────────────────────────────────────────────────
  // IR-10: the write happens first; the question is asked once, under the editor, and never blocks
  const askOffSystem = (css) => {
    if (!hasSystem) return;
    const near = nearestToken(css, colors, vals, slotGroup);
    setAsked({ literal: css, nearest: near, target: near ? near.token : null });
  };
  const solidParts = (c) =>
    showOpacity
      ? { css: rgbToHex(c), opacity: Math.round(c.a * 100) }
      : { css: rgbaCss(c), opacity: value?.opacity ?? 100 };
  const onSolidLive = fillApi
    ? (c) => {
        const { css, opacity } = solidParts(c);
        fillApi.live({ ...fillApi.fill, color: { paint: { css }, opacity }, layers: [] });
      }
    : undefined;
  const onSolidCommit = (c) => {
    const { css, opacity } = solidParts(c);
    onCustom({ css }, opacity);
    askOffSystem(css);
  };
  const onRaw = (t) => {
    if (!isCssColor(t)) return false;
    onCustom({ css: t }, value?.opacity ?? 100);
    askOffSystem(t);
    return true;
  };
  const chooseKind = (k) => {
    if (k === kind) return;
    setKind(k);
    if (!fillApi || k === 'image') return; // an image is a fill once one is chosen
    const next = switchKind(fillApi.fill, k, { vals, start: fillApi.start, end: fillApi.end });
    if (next !== fillApi.fill) fillApi.set(next);
  };
  // a swatch (a token, Recent, a colour on the page): on a gradient it is the selected stop's colour; on an image it
  // replaces the picture with that colour; otherwise it is the fill's colour, as it always was
  const pickPaint = (paint) => {
    if (fillApi && kind === 'gradient' && gf.g) {
      gf.setColour(gf.sel, paintToCss(paint));
      return;
    }
    if (fillApi && kind === 'image') {
      setKind('solid');
      onPick(paint, { replaceLayers: true, keepOpen: tab === 'custom' });
      return;
    }
    onPick(paint, { keepOpen: tab === 'custom' });
  };

  // ← → within a row, ↑ ↓ between rows; ↓ from Search enters the grid
  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      e.preventDefault();
      return onClose({ refocus: true });
    }
    if (e.target?.getAttribute?.('role') === 'slider' || e.target?.tagName === 'SELECT') return;
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

  // the colour the Solid editor starts from: the fill's own, with its opacity
  const valueRgba = useMemo(() => {
    if (!value) return null;
    const c = parseRgba(paintToCss(value.paint), vals);
    return c ? { ...c, a: round2(c.a * (value.opacity / 100)) } : null;
  }, [value, vals]);

  const tabBtn = (id, text) => (
    <button
      type="button"
      role="tab"
      id={`insp-tab-${id}-${name}`}
      aria-selected={tab === id}
      className="insp-pk-tab"
      data-testid={`insp-tab-${id}-${name}`}
      onClick={() => setTab(id)}
    >
      {text}
    </button>
  );

  return (
    <div
      ref={ref}
      className="insp-pop"
      role="dialog"
      aria-label={label}
      popover="manual"
      data-testid={`insp-menu-${name}`}
      data-side={place?.side}
      data-tab={tab}
      style={style}
      onKeyDown={onKeyDown}
      onBlur={onBlur}
    >
      <div className="insp-pk-top">
        <div role="tablist" aria-label="Where the colour comes from" className="insp-pk-tabs">
          {tabBtn('custom', 'Custom')}
          {tabBtn('libraries', 'Libraries')}
        </div>
        <button
          type="button"
          className="insp-pk-icon"
          aria-label="Close"
          title="Close"
          data-testid={`insp-pop-close-${name}`}
          onClick={() => onClose({ refocus: true })}
        >
          <X size={14} />
        </button>
      </div>
      {fillApi ? (
        <div
          role="tablist"
          aria-label="Kind of fill"
          className="insp-pk-kinds"
          data-testid={`insp-kinds-${name}`}
        >
          {KINDS.map(([id, text]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kind === id}
              className="insp-pk-kind"
              data-testid={`insp-kind-${id}-${name}`}
              onClick={() => chooseKind(id)}
            >
              {text}
            </button>
          ))}
        </div>
      ) : null}

      {tab === 'custom' ? (
        <div
          className="insp-pk-body"
          role="tabpanel"
          aria-labelledby={`insp-tab-custom-${name}`}
          data-testid={`insp-pop-custom-${name}`}
        >
          {kind === 'solid' ? (
            <SolidEditor
              name={name}
              rgba={valueRgba}
              onLive={onSolidLive}
              onCommit={onSolidCommit}
              onRaw={onRaw}
            />
          ) : kind === 'gradient' && fillApi ? (
            <GradientEditor name={name} gf={gf} vals={vals} />
          ) : fillApi ? (
            <ImageEditor name={name} fillApi={fillApi} />
          ) : null}
          {kind !== 'image' ? (
            <>
              <RecentRow name={name} recent={recent} tokens={tokens} onPick={pickPaint} />
              <PageColours name={name} colours={pageColours} onPick={(css) => pickPaint({ css })} />
            </>
          ) : null}
        </div>
      ) : (
        <div
          className="insp-pk-body"
          role="tabpanel"
          aria-labelledby={`insp-tab-libraries-${name}`}
        >
          <input
            className="insp-pop-search"
            type="search"
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search colours"
            data-search="true"
            data-testid={`insp-pop-search-${name}`}
            value={query}
            onChange={(e) => setQuery(e.currentTarget.value)}
          />
          {kind === 'gradient' ? (
            <p className="insp-pop-empty" data-testid={`insp-pop-stophint-${name}`}>
              A colour you pick here goes to the stop you have selected.
            </p>
          ) : null}
          <RecentRow name={name} recent={recent} tokens={tokens} onPick={pickPaint} />
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
                        onClick={() => pickPaint({ token: t })}
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
        </div>
      )}

      {asked && tab === 'custom' ? (
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
        <div className="insp-pop-foot">
          <button
            type="button"
            aria-pressed={isNone}
            className="insp-menu-i"
            data-testid={`insp-none-${name}`}
            onClick={onNone}
          >
            {noneLabel}
          </button>
        </div>
      ) : null}
    </div>
  );
}
