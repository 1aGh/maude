// client/v2/annotations/stickers-gallery.jsx — S4.3: the Stickers gallery (E), one island above the toolbar
// (canvas 15 an-stk-gallery / an-stk-search). It replaces the V2-4.5c StickerPicker dialog and keeps its
// contract: GET /_api/stickers (main origin only, DDR-054), `onPick(sticker)` hands the caller
// `{ file, keywords, url, pack, id }` (app.jsx re-uploads the PNG through /_api/asset and relays the
// project path down to the canvas), the scrim closes on an outside click, Escape closes.
//
//   Stamps row · Recent (≤ 12, per person) · the four packs in CONTRACT C13 order with "+N" · credits
//   Search: keywords across the packs and the stamps, word chips, "6 of 80", and the empty line
//
// Words are CONTRACT §3–§4: "Stickers", "Search stickers…", "Recent", "Stamps", "Packs from the Figma
// Community". Placing at 160 px / Replace / Flip / the stamps themselves are S4.13 (`onPickStamp`).
//
// The dialog keeps `.st-scrim` / `.st-dialog.st-sticker-picker` and the `tool-panel-stickers` testid so
// the mode lane's M4 check (an open modal dialog) and the e2e hooks read it unchanged.

import { useEffect, useMemo, useRef, useState } from 'react';
import { orderPacks, resolveRecent, searchStickers } from './sticker-search.js';
import { annotationPrefsStore } from '../shell/use-annotation-prefs.js';
import { loadRecent, rememberSticker } from './recent-stickers.js';
import StampRow from './stamp-row.jsx';
import { StampGlyph, STAMPS } from './stamps-glyphs.jsx';

/** Stickers shown per pack before the "+N" cell (canvas 15 `PACKS[].show`). */
export const PACK_PREVIEW = 5;

function Icon({ name, size = 14 }) {
  if (name === 'search') {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
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
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/** `placePanel`'s output → fixed-position CSS. */
function anchoredStyle(a) {
  const st = { left: a.left, width: a.width, maxHeight: a.maxHeight };
  if (a.top != null) st.top = a.top;
  if (a.bottom != null) st.bottom = a.bottom;
  return st;
}

/** The folded row keeps the gallery's spot but not its width. */
function rowStyle(a) {
  const { width: _w, maxHeight: _h, ...pos } = anchoredStyle(a);
  return pos;
}

function Cell({ sticker, label, onPick }) {
  const word = sticker.keywords?.[0] || sticker.file;
  return (
    <button
      type="button"
      className={label ? 'st-sp-cell sg-cell sg-cell--kw' : 'st-sp-cell sg-cell'}
      title={word}
      data-testid={`sticker-${sticker.pack}-${sticker.file}`}
      onClick={() => onPick(sticker)}
    >
      <img className="st-sp-thumb" src={sticker.url} alt={word} loading="lazy" />
      {label ? <em>{label}</em> : null}
    </button>
  );
}

function StampButton({ stamp, onPickStamp }) {
  return (
    <button
      type="button"
      className={`sg-stamp sg-stamp--${stamp.tone}`}
      title={stamp.name}
      aria-label={stamp.name}
      data-testid={`stickers-stamp-${stamp.id}`}
      disabled={!onPickStamp}
      onClick={() => onPickStamp?.(stamp.id)}
    >
      <StampGlyph id={stamp.id} size={18} />
    </button>
  );
}

/**
 * @param onPick (sticker) => void — `{file, keywords, url, pack, id}`
 * @param onPickStamp (stampId) => void — the canvas arms it (S4.13); with no handler the row is shown but inert.
 *        After one stamp the gallery folds to the Stamps row (stamp-row.jsx) so voting is one click per spot.
 * @param prefs the per-person annotation prefs store (the Recent list lives in it; tests pass their own)
 * @param anchor a `placePanel` placement pinning the gallery above/below the toolbar; null = centred
 */
export default function StickersGallery({
  onPick,
  onPickStamp,
  onClose,
  anchor = null,
  prefs = annotationPrefsStore,
}) {
  const [packs, setPacks] = useState(null); // null = loading
  const [query, setQuery] = useState('');
  const [chip, setChip] = useState(null);
  const [open, setOpen] = useState(() => new Set()); // packs expanded past the "+N" cell
  const [recentRefs, setRecentRefs] = useState(() => loadRecent(prefs));
  // S4.13: the armed stamp once one was picked: the gallery is then the one-row island.
  const [stampArmed, setStampArmed] = useState(null);

  // typing starts at once (E opened the island on purpose); a ref instead of `autoFocus`
  const searchRef = useRef(null);
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  useEffect(() => {
    let alive = true;
    fetch('/_api/stickers')
      .then((r) => r.json())
      .then((j) => alive && setPacks(j.ok ? orderPacks(j.packs) : []))
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

  const result = useMemo(
    () => (packs ? searchStickers(packs, STAMPS, query, chip) : null),
    [packs, query, chip]
  );
  const recent = useMemo(
    () => (packs ? resolveRecent(packs, recentRefs) : []),
    [packs, recentRefs]
  );

  const pick = (sticker) => {
    setRecentRefs(rememberSticker({ pack: sticker.pack, id: sticker.id }, prefs));
    onPick(sticker);
  };
  const setQ = (v) => {
    setQuery(v);
    setChip(null);
  };

  const armStamp = (id) => {
    setStampArmed(id);
    onPickStamp?.(id);
  };
  if (stampArmed && onPickStamp) {
    return (
      <StampRow
        active={stampArmed}
        onPickStamp={armStamp}
        onExpand={() => setStampArmed(null)}
        onClose={onClose}
        style={anchor ? rowStyle(anchor) : undefined}
        placement={anchor?.placement}
      />
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the scrim is a click-outside surface; Escape (window listener) and the Close button are the keyboard routes
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
            ? 'st-dialog st-sticker-picker sg st-sticker-picker--anchored'
            : 'st-dialog st-sticker-picker sg'
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
          <kbd className="kbd sg-key">E</kbd>
          <button type="button" className="st-iconbtn" aria-label="Close" onClick={onClose}>
            <Icon name="x" size={15} />
          </button>
        </div>
        <div className="st-dialog-bd">
          <label className="sg-q">
            <Icon name="search" />
            <input
              className="input sg-q-in"
              data-testid="stickers-search"
              type="text"
              value={query}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search stickers…"
              aria-label="Search stickers"
              ref={searchRef}
            />
            {query ? (
              <button
                type="button"
                className="sg-q-x"
                aria-label="Clear search"
                onClick={() => setQ('')}
              >
                <Icon name="x" size={12} />
              </button>
            ) : null}
          </label>

          <div className="st-sp-body sg-body">
            {packs == null ? (
              <div className="st-sp-empty">Loading…</div>
            ) : result ? (
              <SearchView
                result={result}
                chip={chip}
                onChip={setChip}
                onWord={setQ}
                onPick={pick}
                onPickStamp={onPickStamp ? armStamp : undefined}
              />
            ) : (
              <BrowseView
                packs={packs}
                recent={recent}
                open={open}
                onOpen={(slug) => setOpen((s) => new Set(s).add(slug))}
                onPick={pick}
                onPickStamp={onPickStamp ? armStamp : undefined}
              />
            )}
          </div>
        </div>
        {packs && packs.length > 0 && (
          <div className="st-sp-ft sg-credits" data-testid="stickers-credits">
            <span>Packs from the Figma Community:</span>
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

function BrowseView({ packs, recent, open, onOpen, onPick, onPickStamp }) {
  if (packs.length === 0) return <div className="st-sp-empty">No stickers bundled</div>;
  return (
    <>
      <section className="sg-pk" data-testid="stickers-stamps">
        <p className="sg-ph">
          <strong>Stamps</strong>
        </p>
        <div className="sg-stamps">
          {STAMPS.map((s) => (
            <StampButton key={s.id} stamp={s} onPickStamp={onPickStamp} />
          ))}
        </div>
      </section>
      {recent.length > 0 && (
        <section className="sg-pk" data-testid="stickers-recent">
          <p className="sg-ph">
            <strong>Recent</strong>
          </p>
          <div className="sg-grid">
            {recent.map((s) => (
              <Cell key={`${s.pack}/${s.file}`} sticker={s} onPick={onPick} />
            ))}
          </div>
        </section>
      )}
      {packs.map((pack) => {
        const all = pack.stickers.map((s) => ({ ...s, pack: pack.slug, id: s.file }));
        const expanded = open.has(pack.slug);
        const shown = expanded ? all : all.slice(0, PACK_PREVIEW);
        const more = all.length - shown.length;
        return (
          <section key={pack.slug} className="sg-pk" data-testid={`stickers-pack-${pack.slug}`}>
            <p className="sg-ph">
              <strong>{pack.name}</strong>
              <span>
                {all.length}
                {pack.author ? ` · by ${pack.author}` : ''}
              </span>
            </p>
            <div className="sg-grid">
              {shown.map((s) => (
                <Cell key={s.file} sticker={s} onPick={onPick} />
              ))}
              {more > 0 && (
                <button
                  type="button"
                  className="sg-more"
                  data-testid={`stickers-more-${pack.slug}`}
                  aria-label={`Show ${more} more from ${pack.name}`}
                  onClick={() => onOpen(pack.slug)}
                >
                  +{more}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </>
  );
}

function SearchView({ result, chip, onChip, onWord, onPick, onPickStamp }) {
  if (result.empty) {
    return (
      <div className="sg-nil" data-testid="stickers-empty">
        <strong>No stickers match {`“${result.query}”`}</strong>
        <span>Sticker words are English — try</span>
        {result.suggest.map((w) => (
          <button key={w} type="button" className="chip sg-chip" onClick={() => onWord(w)}>
            {w}
          </button>
        ))}
      </div>
    );
  }
  return (
    <>
      {result.chips.length > 0 && (
        <div className="sg-chips" data-testid="stickers-chips">
          <button
            type="button"
            className="chip sg-chip"
            aria-pressed={chip == null}
            onClick={() => onChip(null)}
          >
            All · {result.all}
          </button>
          {result.chips.map((c) => (
            <button
              key={c.word}
              type="button"
              className="chip sg-chip"
              data-testid={`stickers-chip-${c.word}`}
              aria-pressed={chip === c.word}
              onClick={() => onChip(chip === c.word ? null : c.word)}
            >
              {c.word} · {c.count}
            </button>
          ))}
        </div>
      )}
      {result.stamps.length > 0 && (
        <section className="sg-pk">
          <p className="sg-ph">
            <strong>Stamps</strong>
          </p>
          <div className="sg-stamps">
            {result.stamps.map((s) => (
              <StampButton key={s.id} stamp={s} onPickStamp={onPickStamp} />
            ))}
          </div>
        </section>
      )}
      {result.packs.map((p) => (
        <section key={p.slug} className="sg-pk" data-testid={`stickers-pack-${p.slug}`}>
          <p className="sg-ph">
            <strong>{p.name}</strong>
            <span>
              {p.stickers.length} of {p.total}
            </span>
          </p>
          <div className="sg-grid sg-grid--3">
            {p.stickers.map((s) => (
              <Cell key={s.file} sticker={s} label={s.word} onPick={onPick} />
            ))}
          </div>
        </section>
      ))}
      {result.missing.length > 0 && (
        <p className="sg-none" data-testid="stickers-none">
          No {`“${result.query}”`} in {listJoin(result.missing)}
          {result.noStamp ? ' · no stamp either' : ''}
        </p>
      )}
    </>
  );
}

/** "A, B or C" */
function listJoin(names) {
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
}
