// client/v2/assets/spotlight.jsx — an Assets tile, large (2.0.4, issue #191; decision v2-204-asset-spotlight).
//
// A double-click on a tile (or Space on the picked one — the registry action `assets.spotlight`) opens its picture, clip or
// sound over the app. A picture fits the window, a clip plays with its controls, a sound plays too; anything else says its
// name and size. Under it: the file's name, path and size, and the rows the tile already offers. ← → walk the tiles the tab
// shows, esc or a click outside closes, and focus goes back to the tile. The window is modal: Tab stays inside it.
//
// `AssetSpotlight` is the pure render over the panel's state (spotlight-model.js holds the words and the order).

import { useId, useState } from 'react';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { portalToBody } from '../portal-scope.jsx';
import { useModalFocus } from '../shell/modal-focus.js';
import {
  pathWords,
  previewKind,
  SPOTLIGHT_WORDS as W,
  sizeLine,
  stepIndex,
} from './spotlight-model.js';

/** The media for one asset. Keyed by path by the caller, so a step remounts it (a clip starts from its first frame). */
function Stage({ asset, url }) {
  const kind = previewKind(asset);
  const [broken, setBroken] = useState(false);
  if (kind === 'image' && !broken)
    return (
      <img
        className="v2-spot-img"
        data-testid="spotlight-image"
        src={url}
        alt={asset.name}
        draggable={false}
        onError={() => setBroken(true)}
      />
    );
  if (kind === 'video' && !broken)
    return (
      // biome-ignore lint/a11y/useMediaCaption: the person's own footage; captions are a sidecar of the clip, not of the library
      <video
        className="v2-spot-video"
        data-testid="spotlight-video"
        src={url}
        controls
        playsInline
        preload="metadata"
        onError={() => setBroken(true)}
      />
    );
  if (kind === 'audio' && !broken)
    return (
      <div className="v2-spot-sound" data-testid="spotlight-sound">
        <StIcon name="resolve" size={28} />
        {/* biome-ignore lint/a11y/useMediaCaption: a sound has no captions to show */}
        <audio src={url} controls preload="metadata" onError={() => setBroken(true)} />
      </div>
    );
  // a font, or any file the window cannot draw: what it is, so the person knows it is the right one
  return (
    <div className="v2-spot-file" data-testid="spotlight-file">
      <StIcon name="image" size={28} />
      <p className="v2-spot-file-n">{asset.name}</p>
      {sizeLine(asset) ? <p className="v2-spot-file-s">{sizeLine(asset)}</p> : null}
      <p className="v2-spot-file-s">{broken ? W.failed : W.noPreview}</p>
    </div>
  );
}

/**
 * @param {object} p
 * @param {Array<{ path: string, name: string, kind: string, size?: number }>} p.items the tiles ← → walks, in the tab's order
 * @param {number} p.index which one is showing
 * @param {(path: string) => string} p.urlOf the SAME address the tile draws (main origin, read-only)
 * @param {Array<{ id: string, label: string, keys?: string }>} [p.rows] the tile's own actions
 * @param {(index: number) => void} p.onIndex
 * @param {() => void} p.onClose esc, the close button and a click outside
 * @param {(id: string) => void} [p.onRow]
 */
export function AssetSpotlight({ items, index, urlOf, rows = [], onIndex, onClose, onRow }) {
  const titleId = useId();
  const ref = useModalFocus({ onClose });
  const asset = items[index];
  if (!asset) return null;
  const n = items.length;
  const step = (delta) => {
    const to = stepIndex(index, delta, n);
    if (to !== index) onIndex(to);
  };
  const onKeyDown = (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    // a focused clip or sound keeps its own arrows (seek); everything else steps
    if (e.target?.closest?.('video, audio, input, select, textarea')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault();
      e.stopPropagation();
      step(e.key === 'ArrowRight' ? 1 : -1);
    }
  };
  const path = pathWords(asset);
  const size = sizeLine(asset);
  return portalToBody(
    <div className="v2-spot" data-testid="asset-spotlight" data-asset={asset.path}>
      <div
        className="v2-spot-scrim"
        data-testid="spotlight-scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={ref}
        className="v2-spot-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="v2-spot-head">
          <h2 id={titleId} className="v2-spot-title" data-testid="spotlight-title">
            {asset.name || W.fallbackName}
          </h2>
          <span className="v2-spot-pos" role="status" data-testid="spotlight-position">
            {n > 1 ? W.position(index, n) : ''}
          </span>
          <button
            type="button"
            className="sh-iconbtn"
            data-testid="spotlight-close"
            aria-label={W.close}
            onClick={onClose}
          >
            <StIcon name="x" size={14} />
          </button>
        </header>
        {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: a click on the empty space is a pointer door; esc and the close button are the keyboard's */}
        <div
          className="v2-spot-stage"
          data-testid="spotlight-stage"
          onClick={(e) => {
            // the empty space around the picture is "outside" too
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <button
            type="button"
            className="sh-iconbtn v2-spot-nav v2-spot-nav--prev"
            data-testid="spotlight-prev"
            aria-label={W.previous}
            disabled={index <= 0}
            title={index <= 0 ? W.atFirst : undefined}
            onClick={() => step(-1)}
          >
            <StIcon name="chevron-right" size={16} />
          </button>
          <Stage key={asset.path} asset={asset} url={urlOf(asset.path)} />
          <button
            type="button"
            className="sh-iconbtn v2-spot-nav"
            data-testid="spotlight-next"
            aria-label={W.next}
            disabled={index >= n - 1}
            title={index >= n - 1 ? W.atLast : undefined}
            onClick={() => step(1)}
          >
            <StIcon name="chevron-right" size={16} />
          </button>
        </div>
        <footer className="v2-spot-foot">
          <p className="v2-spot-meta" data-testid="spotlight-meta">
            <span className="v2-spot-path" data-testid="spotlight-path">
              {path}
            </span>
            {size ? (
              <span className="v2-spot-size" data-testid="spotlight-size">
                {size}
              </span>
            ) : null}
          </p>
          {rows.length ? (
            <span className="v2-spot-rows">
              {rows.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="btn btn--sm"
                  data-testid={`spotlight-row-${r.id}`}
                  onClick={() => onRow?.(r.id)}
                >
                  {r.label}
                  {r.keys ? <Kbd>{r.keys}</Kbd> : null}
                </button>
              ))}
            </span>
          ) : null}
        </footer>
      </div>
    </div>
  );
}
