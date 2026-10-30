// client/v2/assets/browse-view.jsx — "Photos 120 ›" widens Assets into big pictures (S8.13; 12 · ia-assets-browse).
//
// One kind, a search, a sort and a size. Pictures are picked with a click, ⌘/ctrl-click and ⇧-click (multi-select.js); the foot
// says how many and how big and offers "Place 6 in <artboard>" — ↵ does the same: the six frames of the selected artboard take
// the six pictures in reading order (`image.place` mode fill-in-order, the same writer as a drop). A tile's right-click menu is
// the narrow tab's. The view is presentational: the panel owns the state (assets-panel.jsx) so the key, the menu and the buttons
// are one code path (assets-bus.js).
//
// It sits over the canvas beside the panel (position: fixed, from the panel's own box) rather than resizing the dock, so the
// panel's width and the canvas camera are untouched; esc or "‹ Assets" goes back.

import { Kbd, StIcon } from '../../shell/icons.jsx';
import { bytesOf, inOrder } from './multi-select.js';
import {
  browseRows,
  drawOrder,
  KIND_WORDS,
  placeWords,
  runsOf,
  SIZES,
  SORTS,
} from './browse-model.js';
import { AssetTile, sizeWords } from './tile.jsx';

/** How many pictures one ↵ may fill (the studio refuses more: edit-ops/image-fit.ts MAX_ASSETS). */
export const MAX_PLACE = 50;

/** The view's draw order for `view` over `assets` — the ids ⇧ ranges and ↵ read. */
export function browseOrder(assets, view) {
  return drawOrder(runsOf(browseRows(assets, view.kind, view.query, view.sort), view.sort));
}

export function BrowseView({
  view,
  assets,
  url,
  readOnly,
  placeLabel,
  canPlace,
  box,
  onChange,
  onPick,
  onMenu,
  onBack,
  onClear,
  onPlace,
  note = null,
  onKeyDown,
}) {
  const words = KIND_WORDS[view.kind] ?? KIND_WORDS.image;
  const total = assets.filter((a) => a.kind === view.kind).length;
  const rows = browseRows(assets, view.kind, view.query, view.sort);
  const runs = runsOf(rows, view.sort);
  const ids = drawOrder(runs);
  const picked = inOrder(ids, view.selected);
  const n = picked.length;
  const isImage = view.kind === 'image';
  const tooMany = n > MAX_PLACE;
  const placeable = !readOnly && isImage && n > 0;
  const placeDisabled = !canPlace || tooMany;
  const style = box
    ? { left: box.left, top: box.top, height: box.height, width: box.width }
    : undefined;

  return (
    <section
      className={`lp-browse lp-browse--${view.size}`}
      style={style}
      aria-label={`${words.title}, browse`}
      data-testid="assets-browse"
      data-kind={view.kind}
      onKeyDown={onKeyDown}
    >
      <div className="lp-browse-hd">
        <button
          type="button"
          className="lp-browse-back"
          data-testid="assets-browse-back"
          onClick={onBack}
        >
          <StIcon name="submenu" size={12} />
          Assets
        </button>
        <strong className="lp-browse-t">
          {words.title} <span className="lp-count">{total}</span>
        </strong>
        <label className="lp-find lp-browse-find">
          <StIcon name="search" size={13} />
          <input
            type="search"
            data-testid="assets-browse-search"
            placeholder={words.search}
            aria-label={words.search}
            value={view.query}
            onChange={(e) => onChange({ query: e.target.value })}
          />
        </label>
        <select
          className="lp-browse-sort"
          data-testid="assets-browse-sort"
          aria-label="Sort"
          value={view.sort}
          onChange={(e) => onChange({ sort: e.target.value })}
        >
          {SORTS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
        {/* biome-ignore lint/a11y/useSemanticElements: a three-way size toggle, not a form fieldset */}
        <span className="lp-browse-size" role="group" aria-label="Size">
          {SIZES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="lp-browse-size-b"
              data-testid={`assets-browse-size-${s.id}`}
              aria-pressed={view.size === s.id}
              onClick={() => onChange({ size: s.id })}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <div className="lp-browse-body">
        {rows.length === 0 ? (
          <p className="lp-empty-b" data-testid="assets-browse-nohits">
            {view.query ? `Nothing called “${view.query}”.` : 'Nothing here yet.'}
          </p>
        ) : (
          runs.map((run) => (
            // biome-ignore lint/a11y/useSemanticElements: a labelled day of tiles, not a form fieldset — a fieldset would bring its own border and min-width
            <div
              key={run.key}
              className="lp-browse-run"
              role="group"
              aria-label={run.title ?? words.title}
            >
              {run.title ? <p className="lp-browse-day">{run.title}</p> : null}
              <div className="lp-browse-grid">
                {run.rows.map((a) => (
                  <AssetTile
                    key={a.path}
                    asset={a}
                    url={url(a.path)}
                    picked={view.selected.has(a.path)}
                    canDrag={!readOnly}
                    caption
                    pickCircle
                    onPick={(path, e, isMenu) => onPick(ids, path, e, isMenu)}
                    onMenu={onMenu}
                  />
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {note}
      {n > 0 ? (
        <div className="lp-browse-bar" data-testid="assets-browse-bar">
          <span className="lp-browse-sel" data-testid="assets-browse-count">
            <strong>{n} selected</strong> · {sizeWords(bytesOf(rows, view.selected))}
          </span>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            data-testid="assets-browse-clear"
            onClick={onClear}
          >
            Clear
          </button>
          {placeable ? (
            <>
              <span className="lp-browse-or">or drag a picture onto an artboard</span>
              <button
                type="button"
                className="btn btn--primary btn--sm"
                data-testid="assets-browse-place"
                disabled={placeDisabled}
                title={
                  tooMany
                    ? `Place up to ${MAX_PLACE} at a time.`
                    : canPlace
                      ? undefined
                      : 'Select an artboard first.'
                }
                onClick={() => onPlace(picked)}
              >
                {placeWords(n, placeLabel)} <Kbd>↵</Kbd>
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
