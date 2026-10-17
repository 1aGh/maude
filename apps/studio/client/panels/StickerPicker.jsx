// StickerPicker.jsx — feature-whiteboard-annotation-improvements, Phase 4.
//
// Searchable, pack-grouped picker for MAUDE's bundled whiteboard sticker packs
// (GET /_api/stickers — main-origin only, DDR-054/DDR-088; mirrors AssetPicker's
// shell/scrim treatment in app.jsx). Triggered from the canvas-side tool
// toolbar's Stickers button via `postMessage({dgn:'tool-panel-open', panel:'stickers'})` (V2-4.5c;
// it was `open-sticker-picker` until the palette retired);
// `onPick(sticker)` hands the caller `{ file, keywords, url }` — app.jsx
// re-uploads the picked PNG's bytes through the existing /_api/asset lane
// (content-addressed, canvas-origin-allowlisted) and relays the resulting
// project path down to the canvas, exactly like the replace-annotation-media
// flow already does for AssetPicker.

import { useEffect, useMemo, useState } from 'react';

function StIcon({ name, size = 15 }) {
  if (name === 'x') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M4 4l8 8M12 4l-8 8"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    );
  }
  return null;
}

/** `placePanel`'s output → fixed-position CSS. */
function anchoredStyle(a) {
  const st = { left: a.left, width: a.width, maxHeight: a.maxHeight };
  if (a.top != null) st.top = a.top;
  if (a.bottom != null) st.bottom = a.bottom;
  return st;
}

/**
 * @param anchor V2-4.5c — a `placePanel` placement (`{left, width, maxHeight, top | bottom}`) that pins
 *   the picker above/below the canvas toolbar; null = today's centred dialog. Either way the scrim
 *   stays (an outside click closes, and an open modal dialog is what the mode lane's M4 check reads).
 */
export default function StickerPicker({ onPick, onClose, anchor = null }) {
  const [packs, setPacks] = useState(null); // null = loading
  const [query, setQuery] = useState('');

  useEffect(() => {
    let alive = true;
    fetch('/_api/stickers')
      .then((r) => r.json())
      .then((j) => alive && setPacks(j.ok ? j.packs : []))
      .catch(() => alive && setPacks([]));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const filteredPacks = useMemo(() => {
    if (!packs) return [];
    const q = query.trim().toLowerCase();
    if (!q) return packs;
    return packs
      .map((pack) => ({
        ...pack,
        stickers: pack.stickers.filter(
          (s) =>
            s.file.toLowerCase().includes(q) ||
            (s.keywords || []).some((k) => k.toLowerCase().includes(q))
        ),
      }))
      .filter((pack) => pack.stickers.length > 0);
  }, [packs, query]);

  const totalShown = filteredPacks.reduce((n, p) => n + p.stickers.length, 0);

  return (
    <div
      className={anchor ? 'st-scrim st-scrim--anchored' : 'st-scrim'}
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={
          anchor
            ? 'st-dialog st-sticker-picker st-sticker-picker--anchored'
            : 'st-dialog st-sticker-picker'
        }
        data-testid="tool-panel-stickers"
        data-placement={anchor?.placement}
        style={anchor ? anchoredStyle(anchor) : undefined}
        role="dialog"
        aria-modal="true"
        aria-label="Stickers"
      >
        <div className="st-dialog-hd">
          <span className="st-dialog-title">Stickers</span>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <StIcon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <input
            className="input"
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search stickers…"
            aria-label="Search stickers"
            autoFocus
          />
          <div className="st-sp-body">
            {packs == null ? (
              <div className="st-sp-empty">Loading…</div>
            ) : totalShown === 0 ? (
              <div className="st-sp-empty">
                {query.trim() ? `No stickers match "${query.trim()}"` : 'No stickers bundled'}
              </div>
            ) : (
              filteredPacks.map((pack) => (
                <div key={pack.slug}>
                  <div className="st-sp-pack-hd">
                    <span className="st-sp-pack-name">{pack.name}</span>
                    {pack.author && <span className="st-sp-pack-author">by {pack.author}</span>}
                  </div>
                  <div className="st-sp-grid">
                    {pack.stickers.map((s) => (
                      <button
                        type="button"
                        key={s.file}
                        className="st-sp-cell"
                        title={s.keywords?.[0] || s.file}
                        onClick={() => onPick(s)}
                      >
                        <img
                          className="st-sp-thumb"
                          src={s.url}
                          alt={s.keywords?.[0] || s.file}
                          loading="lazy"
                        />
                      </button>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
        {packs && packs.length > 0 && (
          <div className="st-sp-ft">
            {packs.map((pack) => (
              <span key={pack.slug}>
                {pack.name}
                {pack.author ? ` — ${pack.author}` : ''}
                {pack.attributionUrl ? (
                  <>
                    {' '}
                    (
                    <a href={pack.attributionUrl} target="_blank" rel="noreferrer">
                      source
                    </a>
                    )
                  </>
                ) : null}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
