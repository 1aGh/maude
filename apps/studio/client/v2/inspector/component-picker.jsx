// client/v2/inspector/component-picker.jsx — S2.16: the Component picker (⇧I), a shell panel
// (canvas 14 `ed-comp-pick`, "⇧I lists the <system> system: Brand, Components, Patterns").
//
// Opened by `tool-panel-open {panel:'components'}` (V2-4.5c lane, use-tool-panels.js), anchored above the
// canvas toolbar. It READS `GET /_api/ds/components?file=<canvas>` (main origin, minRole edit — the
// server refuses a viewer; this panel is also not drawn for one) and only EMITS: `onPlace(message)` where
// the message is the `place-component` dgn the canvas's place-ghost.tsx understands.
//
//   Search components · the system line ("Alligators brand system") · Brand · Components (the highlighted
//   row shows its variant chips) · Patterns (hidden while empty — Q13: S10 serves them) · Open Design system
//
//   click a row or a chip   the pick follows the pointer on the canvas until a click places it   (mode 'ghost')
//   ↵                       places the highlighted pick in the selected frame                        (mode 'selection')
//   ↑ ↓ move, esc closes. Tokens only (component-picker.css).
//
//   P8 c8 (14 ed-comp-pick): while the panel is open the highlighted row is drawn on the canvas as a ghost on the
//   artboard's centre line (`onPreview` — `place-component` mode 'preview', 'cancel' when the panel closes
//   without a pick), so the picker and "where it goes" read together.

import { useEffect, useMemo, useRef, useState } from 'react';

export const GROUPS = Object.freeze([
  { key: 'brand', label: 'Brand' },
  { key: 'components', label: 'Components' },
  { key: 'patterns', label: 'Patterns' },
]);

/** Diacritics off, lower case — "tlacitko" finds "Tlačítko". */
const fold = (s) =>
  String(s ?? '')
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase();

/** The list narrowed to rows whose label or export name contains `query`. Empty groups stay empty. */
export function filterList(list, query) {
  const q = fold(query).trim();
  const out = {};
  for (const { key } of GROUPS) {
    const rows = list?.[key] ?? [];
    out[key] = q ? rows.filter((r) => fold(r.label).includes(q) || fold(r.name).includes(q)) : rows;
  }
  return out;
}

/** The groups the panel draws, in order. An empty group is hidden (Q13). */
export function visibleGroups(groups) {
  return GROUPS.filter((g) => (groups?.[g.key]?.length ?? 0) > 0).map((g) => ({
    ...g,
    rows: groups[g.key],
  }));
}

/** Every drawn row in reading order — what ↑ ↓ walk. */
export function flatRows(groups) {
  return visibleGroups(groups).flatMap((g) => g.rows.map((item) => ({ group: g.key, item })));
}

/** "2 variants" / "12 glyphs" / "" — the quiet note at a row's end. */
export function rowNote(item) {
  if (item.glyphs) return `${item.glyphs} glyphs`;
  const n = item.variants?.length ?? 0;
  return n > 1 ? `${n} variants` : '';
}

/** The `place-component` message for a pick (`variantKey` null = the component's first variant). */
export function placeMessage(item, variantKey, mode) {
  const variant = variantKey ?? item.variants?.[0]?.key ?? null;
  const vLabel = item.variants?.find((v) => v.key === variant)?.label;
  const msg = {
    dgn: 'place-component',
    component: item.name,
    label: vLabel ? `${item.label} · ${vLabel}` : item.label,
    mode,
  };
  if (variant) msg.variant = variant;
  if (item.glyph) msg.glyph = item.glyph;
  return msg;
}

/** `placePanel`'s output → fixed-position CSS. */
function anchoredStyle(a) {
  const st = { left: a.left, width: a.width, maxHeight: a.maxHeight };
  if (a.top != null) st.top = a.top;
  if (a.bottom != null) st.bottom = a.bottom;
  return st;
}

function SearchIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.25" stroke="currentColor" strokeWidth="1.5" />
      <path
        d="M10.2 10.2L13.5 13.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ComponentIcon() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M12 3.5l3.2 3.2L12 9.9 8.8 6.7zM6.7 8.8l3.2 3.2-3.2 3.2L3.5 12zM17.3 8.8l3.2 3.2-3.2 3.2-3.2-3.2zM12 14.1l3.2 3.2L12 20.5l-3.2-3.2z"
        stroke="currentColor"
        strokeWidth="1.75"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * @param props.canvas the active canvas path (the server picks that canvas's system)
 * @param props.anchor `placePanel` output or null (centred)
 * @param props.canEdit false for a viewing role: nothing is drawn (the server refuses anyway)
 * @param props.onPlace (message) => void — the `place-component` dgn, for the active canvas
 * @param props.onOpenDesignSystem () => void
 * @param props.onClose () => void
 * @param props.load (canvas) => Promise<list> — tests only
 */
export default function ComponentPicker({
  canvas,
  anchor = null,
  canEdit = true,
  onPlace,
  onPreview,
  onOpenDesignSystem,
  onClose,
  load,
}) {
  const [list, setList] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [chosen, setChosen] = useState({}); // component name → variant key
  const inputRef = useRef(null);

  useEffect(() => {
    if (canEdit === false) return undefined;
    let live = true;
    const run =
      load ??
      (async (file) => {
        const r = await fetch(`/_api/ds/components?file=${encodeURIComponent(file ?? '')}`);
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
    Promise.resolve()
      .then(() => run(canvas))
      .then((l) => {
        if (!live) return;
        setList(l);
        setState('ready');
      })
      .catch(() => live && setState('error'));
    return () => {
      live = false;
    };
  }, [canvas, canEdit, load]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // focus the search field once the list has settled (loading → ready / error)
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state` is the trigger, not a value read
  useEffect(() => {
    inputRef.current?.focus();
  }, [state]);

  const groups = useMemo(() => filterList(list, query), [list, query]);
  const rows = useMemo(() => flatRows(groups), [groups]);
  const at = Math.min(active, Math.max(0, rows.length - 1));

  // P8 c8 (14 ed-comp-pick): the highlighted row rides on the canvas as a ghost; closing without a pick takes it back
  const previewRef = useRef({ send: onPreview, name: null, placed: false });
  previewRef.current.send = onPreview;
  const lit = rows[at]?.item ?? null;
  const litVariant = lit ? (chosen[lit.name] ?? lit.variants?.[0]?.key ?? null) : null;
  useEffect(() => {
    if (!lit || previewRef.current.placed) return;
    previewRef.current.name = lit.name;
    previewRef.current.send?.(placeMessage(lit, litVariant, 'preview'));
  }, [lit, litVariant]);
  useEffect(
    () => () => {
      const p = previewRef.current;
      if (p.name && !p.placed)
        p.send?.({ dgn: 'place-component', component: p.name, mode: 'cancel' });
    },
    []
  );

  if (canEdit === false) return null;

  const place = (item, variantKey, mode) => {
    previewRef.current.placed = true;
    onPlace?.(placeMessage(item, variantKey, mode));
    onClose?.();
  };
  const variantOf = (item) => chosen[item.name] ?? item.variants?.[0]?.key ?? null;

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (rows.length === 0) return;
      setActive(
        (i) =>
          (Math.min(i, rows.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) %
          rows.length
      );
    } else if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      const row = rows[at];
      if (row) place(row.item, variantOf(row.item), 'selection');
    }
  };

  const systemName = list?.system?.name;
  let flat = -1;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a click-outside surface; Escape (window listener) closes
    <div
      className={anchor ? 'st-scrim st-scrim--anchored' : 'st-scrim'}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose?.();
      }}
    >
      <div
        className={
          anchor
            ? 'st-dialog st-sticker-picker cp st-sticker-picker--anchored'
            : 'st-dialog st-sticker-picker cp'
        }
        data-testid="tool-panel-components"
        data-placement={anchor?.placement}
        style={anchor ? anchoredStyle(anchor) : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Components"
      >
        <label className="cp-find">
          <SearchIcon />
          <input
            ref={inputRef}
            className="cp-find-in"
            data-testid="component-picker-search"
            type="text"
            placeholder="Search components"
            aria-label="Search components"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        {systemName ? (
          <p className="cp-sys" data-testid="component-picker-system">
            {systemName}
          </p>
        ) : null}

        <div className="cp-body">
          {state === 'loading' ? <p className="cp-note">Loading…</p> : null}
          {state === 'error' ? (
            <p className="cp-note" data-testid="component-picker-error">
              The design system could not be read. Try again.
            </p>
          ) : null}
          {state === 'ready' && rows.length === 0 ? (
            <p className="cp-note" data-testid="component-picker-empty">
              {list?.system
                ? `Nothing matches “${query.trim()}”.`
                : 'This project has no design system yet.'}
            </p>
          ) : null}
          {visibleGroups(groups).map((g) => (
            // biome-ignore lint/a11y/useSemanticElements: a labelled run of menu rows; a fieldset would bring its own border and legend
            <div
              key={g.key}
              role="group"
              aria-label={g.label}
              data-testid={`component-picker-group-${g.key}`}
            >
              <span className="cp-group">{g.label}</span>
              {g.rows.map((item) => {
                flat += 1;
                const i = flat;
                const on = i === at;
                const variant = variantOf(item);
                return (
                  <div key={item.name}>
                    <button
                      type="button"
                      className="cp-row"
                      data-testid={`component-picker-row-${item.name}`}
                      data-on={on ? 'true' : undefined}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => place(item, variant, 'ghost')}
                    >
                      <span className="cp-ic">
                        <ComponentIcon />
                      </span>
                      <span className="cp-lab">{item.label}</span>
                      {rowNote(item) ? <span className="cp-n">{rowNote(item)}</span> : null}
                    </button>
                    {on && item.variants?.length > 1 ? (
                      // biome-ignore lint/a11y/useSemanticElements: chips beside a row; a fieldset would bring its own border and legend
                      <span className="cp-chips" role="group" aria-label={`${item.label} variants`}>
                        {item.variants.map((v) => (
                          <button
                            key={v.key}
                            type="button"
                            className="cp-chip"
                            data-testid={`component-picker-variant-${item.name}-${v.key}`}
                            aria-current={v.key === variant ? 'true' : undefined}
                            onClick={() => {
                              setChosen((c) => ({ ...c, [item.name]: v.key }));
                              place(item, v.key, 'ghost');
                            }}
                          >
                            {v.label}
                          </button>
                        ))}
                      </span>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="cp-sep" />
        <button
          type="button"
          className="cp-row cp-foot"
          data-testid="component-picker-open-ds"
          onClick={() => {
            onOpenDesignSystem?.();
            onClose?.();
          }}
        >
          <span className="cp-ic">
            <ComponentIcon />
          </span>
          <span className="cp-lab">Open Design system</span>
        </button>
      </div>
    </div>
  );
}
