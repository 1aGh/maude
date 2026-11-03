// client/v2/assets/ds-library-view.jsx — the Assets tab with a design system as its source (2.0.2; ds-library.js).
//
// The library's own folders first (a row per folder with its count), then its pictures in the same tiles as the
// project's: hover names them, a picture or a clip drags onto a frame, ↵ places the picked one on the selected artboard
// (`assets.place` → `placeAsset`, one edit-op, one undo step). What lands on the canvas is the picture's LITERAL
// reference (`/<designRel>/system/<ds>/assets/…`), never a copy. A breadcrumb walks back up; the search reads names
// below the current folder; the next page comes when the end of the list scrolls into view (or on "Show more").

import { useCallback, useEffect, useRef, useState } from 'react';
import { StIcon } from '../../shell/icons.jsx';
import { crumbsOf, filesWords, useDsLibrary } from './ds-library.js';
import { placeAsset, SELECT_ARTBOARD_LINE } from './place-asset.js';
import { AssetTile } from './tile.jsx';

/** "Placed the photo in Fotky ze zápasu." — the design system keeps the picture; nothing is copied. */
export function dsPlacedWords(label) {
  return label ? `Placed the photo in ${label}.` : 'Placed the photo.';
}

const NOT_PLACEABLE =
  'This file’s name can’t be used on a canvas. Rename it in the design system first.';

export function DsLibraryView({
  ds,
  designRel = '.design',
  readOnly = false,
  placeTarget = null,
  placeLabel = null,
  onRecord = undefined,
  toast = undefined,
  // the panel's ↵ reaches the picked tile through this (assets-bus `place` / `tileSelected`)
  apiRef = undefined,
  fetchImpl = undefined,
}) {
  const [dir, setDir] = useState('');
  const [typed, setTyped] = useState('');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [err, setErr] = useState('');
  const rootRef = useRef(null);
  const sentinel = useRef(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  // another system is a fresh view: the panel keys this by `ds`, so it starts at the library's top
  // a burst of keys is one search
  useEffect(() => {
    const t = setTimeout(() => setQuery(typed), 180);
    return () => clearTimeout(t);
  }, [typed]);

  const { state, error, loading, loadMore } = useDsLibrary({
    ds,
    dir,
    q: query,
    designRel,
    fetchImpl,
  });
  const rows = state?.rows ?? [];
  const byPath = new Map(rows.map((r) => [r.path, r]));

  const place = useCallback(
    async (path) => {
      if (readOnly) return;
      const asset = rows.find((r) => r.path === path);
      if (!asset || (asset.kind !== 'image' && asset.kind !== 'video')) return;
      if (!asset.placeable) {
        setErr(NOT_PLACEABLE);
        return;
      }
      if (!placeTarget) {
        setErr(SELECT_ARTBOARD_LINE);
        return;
      }
      setErr('');
      const tile = Array.from(rootRef.current?.querySelectorAll?.('[data-asset]') ?? []).find(
        (el) => el.dataset.asset === path
      );
      const img = tile?.querySelector?.('img');
      const natural =
        img?.naturalWidth > 0 && img?.naturalHeight > 0
          ? { w: img.naturalWidth, h: img.naturalHeight }
          : undefined;
      const r = await placeAsset(
        { asset: path, target: placeTarget, natural },
        { record: onRecord }
      );
      if (!alive.current) return;
      if (!r.ok) setErr(r.message);
      else toast?.(dsPlacedWords(placeLabel));
    },
    [readOnly, rows, placeTarget, placeLabel, onRecord, toast]
  );

  if (apiRef)
    apiRef.current = {
      place: () => (picked ? place(picked) : undefined),
      tileSelected: () => !!picked && !!rootRef.current?.contains(document.activeElement),
    };

  // the next page when the end of the list comes into view
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !state?.next || typeof IntersectionObserver !== 'function') return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) void loadMore();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [state?.next, loadMore]);

  const open = (d) => {
    setDir(d);
    setTyped('');
    setQuery('');
    setPicked(null);
    setErr('');
  };
  const crumbs = crumbsOf(ds, dir);
  const searching = !!query.trim();
  const dirs = searching ? [] : (state?.dirs ?? []);

  return (
    <div className="lp-ds-lib" data-testid="assets-ds" data-ds={ds} data-dir={dir} ref={rootRef}>
      <div className="lp-head-row">
        <label className="lp-find">
          <StIcon name="search" size={14} />
          <input
            type="search"
            data-testid="assets-ds-search"
            placeholder={`Search ${ds}`}
            aria-label={`Search ${ds}`}
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
      </div>
      <nav
        className="lp-ds-crumbs"
        aria-label="Where in the library"
        data-testid="assets-ds-crumbs"
      >
        {crumbs.map((c, i) => (
          <span key={c.dir || '/'} className="lp-ds-crumb-w">
            {i > 0 ? (
              <span className="lp-ds-sep" aria-hidden="true">
                ›
              </span>
            ) : null}
            <button
              type="button"
              className="lp-ds-crumb"
              data-testid="assets-ds-crumb"
              data-dir={c.dir}
              aria-current={i === crumbs.length - 1 ? 'location' : undefined}
              onClick={() => open(c.dir)}
            >
              {c.label}
            </button>
          </span>
        ))}
      </nav>
      <div className="lp-assets-list">
        {state === null ? <p className="lp-empty-b">Loading…</p> : null}
        {error ? (
          <p className="lp-note lp-note--err" role="alert" data-testid="assets-ds-error">
            {error}
          </p>
        ) : null}
        {dirs.length ? (
          <ul className="lp-ds-dirs" data-testid="assets-ds-dirs">
            {dirs.map((d) => (
              <li key={d.dir}>
                <button
                  type="button"
                  className="lp-ds-dir"
                  data-testid="assets-ds-folder"
                  data-dir={d.dir}
                  onClick={() => open(d.dir)}
                >
                  <StIcon name="folder" size={14} />
                  <span className="lp-ds-dir-n">{d.name}</span>
                  <span className="lp-count">{d.count}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        {state && rows.length ? (
          <>
            <p className="lp-group">
              <span className="lp-group-s">
                {searching ? `Matching “${query.trim()}”` : 'Files'}
                <span className="lp-count" data-testid="assets-ds-total">
                  {state.total}
                </span>
              </span>
            </p>
            <div className="lp-grid" data-testid="assets-ds-grid">
              {rows.map((a) => (
                <AssetTile
                  key={a.path}
                  asset={a}
                  url={a.path}
                  picked={picked === a.path}
                  canDrag={!readOnly && a.placeable}
                  onPick={(p) => {
                    setPicked(p);
                    setErr('');
                  }}
                  onMenu={() => {}}
                />
              ))}
            </div>
          </>
        ) : null}
        {state && !rows.length && !dirs.length && !error ? (
          <div
            className="lp-empty"
            data-testid={searching ? 'assets-ds-nohits' : 'assets-ds-empty'}
          >
            <p className="lp-empty-t">
              {searching ? `Nothing called “${query.trim()}”.` : 'Nothing in here yet.'}
            </p>
            <p className="lp-empty-b">
              {searching
                ? 'Try another word — search reads names.'
                : `Pictures added to ${ds} show here.`}
            </p>
          </div>
        ) : null}
        {state?.next ? (
          <button
            type="button"
            ref={sentinel}
            className="lp-mac"
            data-testid="assets-ds-more"
            disabled={loading}
            onClick={() => void loadMore()}
          >
            {loading
              ? 'Loading…'
              : `Show more · ${filesWords(Math.max(0, state.total - rows.length))} left`}
          </button>
        ) : null}
        {err ? (
          <p className="lp-note lp-note--err" role="alert" data-testid="assets-ds-note">
            {err}
          </p>
        ) : null}
      </div>
      {picked && byPath.get(picked) ? (
        <p className="lp-foot" data-testid="assets-ds-foot">
          {byPath.get(picked)?.name}
        </p>
      ) : null}
    </div>
  );
}
