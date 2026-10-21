// client/v2/export/other-formats.jsx — S8.2: Other… — every format, one list away (09 ex-formats).
//
// What fits the kind sits up front in the section; this menu lists every other format, grouped by what
// you are making. A format that cannot apply stays in the list, greyed, with a one-line reason; search
// finds every row, enabled or not. Rows re-emit the v1 hooks `export-format-<id>` (png pdf svg html pptx
// mp4 gif canva zip shadcn) and add jpg, webm, audio.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { matchOther, OTHER_LABEL, OTHER_NONE, OTHER_SEARCH } from './export-copy.js';

const GAP = 4;
const EDGE = 16;
const MENU_MAX = 420;

/**
 * Where the Other… list sits, fixed to the window: below the button when it fits, else on the side with more
 * room, and no taller than that room. `rect` is the button's client rect; null (no layout yet) = no style.
 */
export function menuPlace(rect, viewH) {
  if (!rect) return null;
  const below = viewH - rect.bottom - GAP - EDGE;
  const above = rect.top - GAP - EDGE;
  const side = below >= Math.min(MENU_MAX, 240) || below >= above ? 'below' : 'above';
  const room = Math.max(120, Math.min(MENU_MAX, side === 'below' ? below : above));
  const style = { position: 'fixed', left: Math.round(rect.left), maxHeight: Math.round(room) };
  if (side === 'below') style.top = Math.round(rect.bottom + GAP);
  else Object.assign(style, { top: 'auto', bottom: Math.round(viewH - rect.top + GAP) });
  return { side, style };
}

/**
 * @param groups   `otherFormats(ctx)` — rows with `disabled` and `reason`
 * @param format   the picked format (its row is checked)
 * @param onPick   (row) => void — the sheet decides what a row does (a format, or the handoff)
 */
export function OtherFormats({ groups, format, onPick, open, setOpen }) {
  const [query, setQuery] = useState('');
  const root = useRef(null);
  const button = useRef(null);
  const search = useRef(null);
  const shown = matchOther(groups, query);
  const [place, setPlace] = useState(null);

  // gate-B polish (09 ex-formats): the sheet scrolls (`overflow: auto`), so an absolutely placed list was cut at
  // its edge and lay over Cancel. The list is fixed to the window instead, under the button — or above it when
  // the window has no room below — and never taller than the room it has.
  useLayoutEffect(() => {
    if (!open) return undefined;
    const measure = () =>
      setPlace(menuPlace(button.current?.getBoundingClientRect(), window.innerHeight));
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    setQuery('');
    search.current?.focus();
    const away = (e) => {
      if (!root.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open, setOpen]);

  const rows = () => [
    ...(root.current?.querySelectorAll('[role="menuitemradio"]:not([aria-disabled])') ?? []),
  ];
  const close = () => {
    setOpen(false);
    button.current?.focus();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const all = rows();
    if (all.length === 0) return;
    e.preventDefault();
    const at = all.indexOf(document.activeElement);
    const next = e.key === 'ArrowDown' ? at + 1 : at - 1;
    all[(next + all.length) % all.length]?.focus();
  };
  const pick = (row) => {
    if (row.disabled) return;
    setOpen(false);
    onPick(row);
  };

  return (
    <span className="ex-other" ref={root}>
      <button
        ref={button}
        type="button"
        className="btn btn--ghost btn--sm"
        aria-haspopup="menu"
        aria-expanded={open}
        data-testid="export-other"
        onClick={() => setOpen(!open)}
      >
        {OTHER_LABEL}
      </button>
      {open ? (
        // biome-ignore lint/a11y/noStaticElementInteractions: the menu handles ↑ ↓ esc for its rows
        // gate-b-a11y B-ex: the search box is NOT a child of `role=menu` (axe aria-required-children) — the
        // popover is a plain container; only the format rows live in the menu.
        <div
          className="ex-other-menu island"
          data-testid="export-other-menu"
          data-place={place?.side}
          style={place?.style}
          onKeyDown={onKey}
        >
          <input
            ref={search}
            type="search"
            className="ex-other-search"
            placeholder={OTHER_SEARCH}
            aria-label={OTHER_SEARCH}
            data-testid="export-other-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onInput={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                e.stopPropagation();
                const first = shown.flatMap((g) => g.items).find((i) => !i.disabled);
                if (first) pick(first);
              }
            }}
          />
          {shown.length === 0 ? (
            <p className="ex-other-none" data-testid="export-other-none">
              {OTHER_NONE}
            </p>
          ) : (
            <div role="menu" aria-label={OTHER_LABEL} className="ex-other-list">
              {shown.map(({ group, items }) => (
                <div key={group} className="ex-other-grp" role="group" aria-label={group}>
                  <p className="ex-other-gh" aria-hidden="true">
                    {group}
                  </p>
                  {items.map((it) => (
                    // biome-ignore lint/a11y/useSemanticElements: a menu row with a checked state
                    <button
                      key={it.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={!it.handoff && !it.needs && it.format === format}
                      aria-disabled={it.disabled ? true : undefined}
                      className="ex-other-row"
                      data-testid={`export-format-${it.id}`}
                      data-reason={it.reason ?? undefined}
                      onClick={() => pick(it)}
                    >
                      <span className="ex-other-l">{it.label}</span>
                      {it.keys ? <kbd className="ex-kbd">{it.keys}</kbd> : null}
                      <small className="ex-other-n">{it.note}</small>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </span>
  );
}
