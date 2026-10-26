// client/v2/kinds/SizePicker.jsx — S7.20: the F size picker (08 `ak-picker`, `ak-picker-full`), a shell panel.
//
// F over empty canvas (no artboard selected) arms the Frame tool and the canvas asks for this panel
// (`tool-panel-open {panel:'sizes'}`, V2-4.5c lane, use-tool-panels.js), anchored above the toolbar. It READS
// `GET /_api/kinds/presets?file=<canvas>` (main origin, minRole edit — the server refuses a viewer; the panel is
// also not drawn for one) and only EMITS: `onGhost(message)` — the `size-ghost` the canvas draws as a dashed
// outline — and `onPlace(message)` — the `run-action artboard.insert-preset` the canvas answers with ONE edit-op.
//
//   Search sizes — “A5”, “story”, “1920”  ·  Recent chips  ·  App · Web page · Social · Print · Video
//   each group: three sizes up front, "All N ›" opens the rest (Print ends with Custom size…)
//   hover or ↑ ↓ a tile       the dashed outline appears on the canvas where it would land
//   click a tile or ↵          the artboard lands, with its kind
//   Custom size…               mm island: Width · Height · Orientation · Bleed · Safe margin → Add artboard
//   esc, a press outside, or focus moving into the canvas (a drag draws a Fixed size artboard) closes it
//
// The panel does not take the pointer from the canvas: no scrim, so a drag on empty canvas still reaches F's
// overlay. Tokens only (size-picker.css).

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DigitalIcon,
  ImageIcon,
  LaptopIcon,
  PrintIcon,
  VideoIcon,
  WebIcon,
} from '../canvases/canvas-icons.jsx';
import {
  badgeTone,
  CUSTOM_DEFAULTS,
  CUSTOM_TITLE,
  customInput,
  customNote,
  FOOT_LINE,
  flatTiles,
  ghostMessage,
  NOTHING_LINE,
  orientationOf,
  placeMessage,
  SEARCH_PLACEHOLDER,
  tileShape,
  viewGroups,
  withOrientation,
} from './size-picker-model.js';

const KIND_ICON = { digital: DigitalIcon, web: WebIcon, print: PrintIcon, video: VideoIcon };
// 08: App is a laptop, Social a picture — the phone is the kind's glyph (Recent chips), not the group's
const GROUP_ICON = {
  laptop: LaptopIcon,
  web: WebIcon,
  image: ImageIcon,
  print: PrintIcon,
  video: VideoIcon,
};

function Svg({ children, size = 14 }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}
const SearchIcon = () => (
  <Svg>
    <circle cx="7" cy="7" r="4.25" />
    <path d="M10.2 10.2L13.5 13.5" />
  </Svg>
);
// the kit's `chevron` (down) when open, `submenu` (right) when not — "Grows as you add" and "Fewer" point down
const ChevronIcon = ({ open }) => (
  <Svg size={11}>
    <path d={open ? 'M4 6l4 4 4-4' : 'M6 3.5l4.5 4.5L6 12.5'} />
  </Svg>
);
const LockIcon = () => (
  <Svg size={10}>
    <rect x="3.5" y="7" width="9" height="6.5" rx="1" />
    <path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" />
  </Svg>
);
const PlusIcon = () => (
  <Svg size={12}>
    <path d="M8 3.5v9M3.5 8h9" />
  </Svg>
);

/** `placePanel`'s output → fixed-position CSS. */
function anchoredStyle(a) {
  const st = { left: a.left, width: a.width, maxHeight: a.maxHeight };
  if (a.top != null) st.top = a.top;
  if (a.bottom != null) st.bottom = a.bottom;
  return st;
}

function Shape({ tile, kind }) {
  const s = tileShape(tile, kind);
  return (
    <>
      <span className="sz-shape" data-k={kind} style={{ width: s.w, height: s.h }}>
        {s.play ? <VideoIcon size={10} /> : null}
      </span>
      {s.grows ? (
        <span className="sz-shape-more">
          <ChevronIcon open />
        </span>
      ) : null}
    </>
  );
}

function Tile({ tile, kind, on, onEnter, onPick }) {
  return (
    <button
      type="button"
      className="sz-tile"
      data-testid={`size-picker-tile-${tile.id}`}
      data-hl={on ? 'true' : undefined}
      data-k={kind}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onClick={onPick}
    >
      <span className="sz-tile-pic">
        <Shape tile={tile} kind={kind} />
      </span>
      <span className="sz-tile-name">{tile.name}</span>
      <span className="sz-tile-size">{tile.sizeText}</span>
    </button>
  );
}

function CustomTile({ tile, on, onEnter, onPick }) {
  return (
    <button
      type="button"
      className="sz-tile sz-tile--custom"
      data-testid={`size-picker-tile-${tile.id}`}
      data-hl={on ? 'true' : undefined}
      onMouseEnter={onEnter}
      onFocus={onEnter}
      onClick={onPick}
    >
      <span className="sz-tile-pic">
        <span className="sz-shape sz-shape--custom">
          <PlusIcon />
        </span>
      </span>
      <span className="sz-tile-name">{tile.name}</span>
      <span className="sz-tile-size">{tile.sizeText}</span>
    </button>
  );
}

function MmField({ label, id, value, onChange }) {
  return (
    <div className="sz-custom-r">
      <label htmlFor={id}>{label}</label>
      <span className="sz-mm">
        <input
          id={id}
          data-testid={`size-picker-custom-${id.replace('sz-', '')}`}
          type="text"
          inputMode="decimal"
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <em>mm</em>
      </span>
    </div>
  );
}

/** Custom size… — the mm island. Width · Height · Orientation · Bleed · Safe margin, then Add artboard. */
export function CustomPrint({ onAdd, onCancel, initial = CUSTOM_DEFAULTS }) {
  const [f, setF] = useState(initial);
  const [line, setLine] = useState('');
  const set = (k) => (v) => {
    setLine('');
    setF((cur) => ({ ...cur, [k]: v }));
  };
  const orientation = orientationOf(f);
  const add = () => {
    const r = customInput(f);
    if (!r.ok) return setLine(r.line);
    onAdd(r.value);
  };
  return (
    <form
      className="sz-custom"
      data-testid="size-picker-custom"
      aria-label={CUSTOM_TITLE}
      onSubmit={(e) => {
        e.preventDefault();
        add();
      }}
    >
      <p className="sz-custom-t">
        <PrintIcon size={14} />
        {CUSTOM_TITLE}
      </p>
      <MmField label="Width" id="sz-width" value={f.width} onChange={set('width')} />
      <MmField label="Height" id="sz-height" value={f.height} onChange={set('height')} />
      <div className="sz-custom-r">
        <span id="sz-orientation-l">Orientation</span>
        {/* biome-ignore lint/a11y/useSemanticElements: a segmented control; a fieldset would bring its own border and legend */}
        <span className="sz-seg" role="group" aria-labelledby="sz-orientation-l">
          {['Portrait', 'Landscape'].map((o) => (
            <button
              key={o}
              type="button"
              className="sz-seg-b"
              data-testid={`size-picker-custom-orientation-${o.toLowerCase()}`}
              aria-pressed={orientation === o}
              onClick={() => setF((cur) => withOrientation(cur, o))}
            >
              {o}
            </button>
          ))}
        </span>
      </div>
      <MmField label="Bleed" id="sz-bleed" value={f.bleed} onChange={set('bleed')} />
      <MmField label="Safe margin" id="sz-margin" value={f.margin} onChange={set('margin')} />
      <p className="sz-custom-n" data-testid="size-picker-custom-note">
        {customNote(f)}
      </p>
      {line ? (
        <p
          className="sz-custom-n sz-custom-err"
          role="alert"
          data-testid="size-picker-custom-error"
        >
          {line}
        </p>
      ) : null}
      <span className="sz-custom-a">
        <button
          type="button"
          className="btn"
          data-testid="size-picker-custom-cancel"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button type="submit" className="btn btn--primary" data-testid="size-picker-custom-add">
          Add artboard
        </button>
      </span>
    </form>
  );
}

/**
 * @param props.canvas the active canvas path
 * @param props.anchor `placePanel` output or null (centred)
 * @param props.canEdit false for a viewing role: nothing is drawn (the server refuses anyway)
 * @param props.onGhost (message) => void — the `size-ghost` dgn for the active canvas
 * @param props.onPlace (message) => void — the `run-action artboard.insert-preset` for the active canvas
 * @param props.onClose () => void
 * @param props.load (canvas) => Promise<data> — tests only
 */
export default function SizePicker({
  canvas,
  anchor = null,
  canEdit = true,
  onGhost,
  onPlace,
  onClose,
  load,
}) {
  const [data, setData] = useState(null);
  const [state, setState] = useState('loading'); // loading | ready | error
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(null); // the group whose "All N" is open
  const [active, setActive] = useState(0);
  const [showGhost, setShowGhost] = useState(false);
  const [custom, setCustom] = useState(false);
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const live = useRef({ onGhost, onClose });
  live.current = { onGhost, onClose };

  useEffect(() => {
    if (canEdit === false) return undefined;
    let alive = true;
    const run =
      load ??
      (async (file) => {
        const r = await fetch(`/_api/kinds/presets?file=${encodeURIComponent(file ?? '')}`);
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      });
    Promise.resolve()
      .then(() => run(canvas))
      .then((d) => {
        if (!alive) return;
        setData(d);
        setState('ready');
      })
      .catch(() => alive && setState('error'));
    return () => {
      alive = false;
    };
  }, [canvas, canEdit, load]);

  // esc closes; a press outside closes; focus moving into the canvas closes (a drag there draws a Fixed size
  // artboard — S2.13 — and the picker is out of its way)
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        live.current.onClose?.();
      }
    };
    const onDown = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) live.current.onClose?.();
    };
    const onBlur = () => live.current.onClose?.();
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // the outline goes when the panel does
  useEffect(
    () => () => {
      live.current.onGhost?.(ghostMessage(null));
    },
    []
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: `state` is the trigger, not a value read
  useEffect(() => {
    inputRef.current?.focus();
  }, [state]);

  const view = useMemo(() => viewGroups(data, open, query), [data, open, query]);
  const flat = useMemo(() => flatTiles(view), [view]);
  const at = Math.min(active, Math.max(0, flat.length - 1));
  const hot = showGhost ? flat[at] : null;

  // the dashed outline follows the highlighted tile
  const hotId = hot?.id ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the identity of the outline
  useEffect(() => {
    live.current.onGhost?.(ghostMessage(hot));
  }, [hotId]);

  if (canEdit === false) return null;

  const pick = (tile) => {
    if (tile.id === 'print-custom') {
      setShowGhost(false);
      setCustom(true);
      return;
    }
    onPlace?.(placeMessage(tile));
    onClose?.();
  };
  const addCustom = (value) => {
    onPlace?.(placeMessage({ id: 'print-custom' }, value));
    onClose?.();
  };

  const onKeyDown = (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (flat.length === 0) return;
      setShowGhost(true);
      setActive(
        (i) =>
          (Math.min(i, flat.length - 1) + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) %
          flat.length
      );
    } else if (e.key === 'Enter' && !e.nativeEvent?.isComposing) {
      e.preventDefault();
      const tile = flat[at];
      if (tile && (query.trim() || showGhost)) pick(tile);
    }
  };
  const enter = (id) => () => {
    const i = flat.findIndex((t) => t.id === id);
    if (i >= 0) setActive(i);
    setShowGhost(true);
  };

  const tileOn = (id) => (custom && id === 'print-custom') || (showGhost && flat[at]?.id === id);

  return (
    <div
      ref={rootRef}
      className={
        anchor
          ? 'sh-dialog sh-sticker-picker sz sh-sticker-picker--anchored'
          : 'sh-dialog sh-sticker-picker sz'
      }
      data-testid="tool-panel-sizes"
      data-placement={anchor?.placement}
      style={anchor ? anchoredStyle(anchor) : undefined}
      role="dialog"
      aria-label="New artboard"
      onMouseLeave={() => setShowGhost(false)}
    >
      {custom ? (
        // 08 ak-picker-full: the picker stays open; the mm island sits BESIDE it (its own floating plane)
        <div className="sz-island" data-testid="size-picker-island">
          <CustomPrint onAdd={addCustom} onCancel={() => setCustom(false)} />
        </div>
      ) : null}
      {
        <>
          <label className="sz-find" data-on={query ? 'true' : undefined}>
            <SearchIcon />
            <input
              ref={inputRef}
              className="sz-find-in"
              data-testid="size-picker-search"
              type="text"
              placeholder={SEARCH_PLACEHOLDER}
              aria-label="Search sizes"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
                setShowGhost(true);
              }}
              onKeyDown={onKeyDown}
            />
          </label>

          <div className="sz-body">
            {state === 'loading' ? <p className="sz-note">Loading…</p> : null}
            {state === 'error' ? (
              <p className="sz-note" data-testid="size-picker-error">
                The sizes could not be read. Try again.
              </p>
            ) : null}

            {view.search ? (
              view.search.length === 0 ? (
                <p className="sz-note" data-testid="size-picker-empty">
                  {NOTHING_LINE(query)}
                </p>
              ) : (
                <div className="sz-tiles" data-testid="size-picker-results">
                  {view.search.map((t) => (
                    <Tile
                      key={t.id}
                      tile={t}
                      kind={t.kind}
                      on={tileOn(t.id)}
                      onEnter={enter(t.id)}
                      onPick={() => pick(t)}
                    />
                  ))}
                </div>
              )
            ) : null}

            {!view.search && view.recent.length > 0 ? (
              <div className="sz-recent" data-testid="size-picker-recent">
                <span className="sz-recent-l">Recent</span>
                {view.recent.map((t) => {
                  const Ic = KIND_ICON[t.kind] ?? DigitalIcon;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      className="sz-chip"
                      data-testid={`size-picker-recent-${t.id}`}
                      title={`${t.name} · ${data?.kinds?.[t.kind] ?? ''}`}
                      onClick={() => pick(t)}
                    >
                      <Ic size={11} />
                      {t.name}
                    </button>
                  );
                })}
              </div>
            ) : null}

            {view.groups.map((g) => {
              const GIc = GROUP_ICON[g.icon] ?? DigitalIcon;
              const tone = badgeTone(g.kind);
              return (
                // biome-ignore lint/a11y/useSemanticElements: a labelled run of tiles; a fieldset would bring its own border and legend
                <div
                  key={g.id}
                  className="sz-g"
                  role="group"
                  aria-label={g.title}
                  data-testid={`size-picker-group-${g.id}`}
                  data-open={g.open ? 'true' : undefined}
                >
                  <span className="sz-h">
                    <span className="sz-h-ic">
                      <GIc size={13} />
                    </span>
                    <span className="sz-h-t">{g.title}</span>
                    <span className="sz-badge" data-tone={tone}>
                      {tone === 'fixed' ? (
                        <LockIcon />
                      ) : tone === 'grow' ? (
                        <ChevronIcon open />
                      ) : null}
                      {g.badge}
                    </span>
                    {g.more ? (
                      <button
                        type="button"
                        className="sz-all"
                        data-testid={`size-picker-all-${g.id}`}
                        aria-expanded={g.open}
                        onClick={() => setOpen(g.open ? null : g.id)}
                      >
                        {g.open ? 'Fewer' : `All ${g.more}`}
                        <ChevronIcon open={g.open} />
                      </button>
                    ) : null}
                  </span>
                  <div className="sz-tiles">
                    {g.tiles.map((t) => (
                      <Tile
                        key={t.id}
                        tile={t}
                        kind={g.kind}
                        on={tileOn(t.id)}
                        onEnter={enter(t.id)}
                        onPick={() => pick(t)}
                      />
                    ))}
                    {g.custom ? (
                      <CustomTile
                        tile={g.custom}
                        on={tileOn(g.custom.id)}
                        onEnter={enter(g.custom.id)}
                        onPick={() => pick(g.custom)}
                      />
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="sz-foot" data-testid="size-picker-foot">
            {FOOT_LINE}
          </p>
        </>
      }
    </div>
  );
}
