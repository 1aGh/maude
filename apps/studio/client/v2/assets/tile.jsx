// client/v2/assets/tile.jsx — one tile of the Assets tab (S8.12; 12 · ia-assets-panel, ia-assets-keys).
//
// The picture comes first and nothing else is drawn on it. The name and where it is used show on hover AND on keyboard
// focus (a tip over the foot of the tile), and a screen reader hears the same two lines as the tile's name. A picture drags
// onto a frame (tile-drag.js); a right-click opens the tile menu. Video shows its first frame, sound a glyph.

import { StIcon } from '../../shell/icons.jsx';
import { tileDragProps } from './tile-drag.js';
import { usageWords } from './use-assets.js';

const KB = 1024;
const MB = KB * KB;

/** "4 KB" · "2.3 MB" — a size a person can read. */
export function sizeWords(bytes) {
  const n = Number(bytes) || 0;
  if (n >= MB) return `${(n / MB).toFixed(n >= 10 * MB ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(n / KB))} KB`;
}

/** @returns {string} the tile's accessible name: "IMG_2231.jpg. Used in 4 canvases" */
export function tileLabel(asset) {
  const used = usageWords(asset);
  return used ? `${asset.name}. ${used}` : asset.name;
}

/** "Uploading IMG_2231.jpg" · "Uploading IMG_2231.jpg, 64%" — a screen reader hears the bar too. */
export function uploadWords(name, up) {
  if (!up) return '';
  return typeof up.progress === 'number'
    ? `Uploading ${name}, ${Math.round(up.progress * 100)}%`
    : `Uploading ${name}`;
}

// `uploading`: { progress?: 0..1 } while this Mac still owes the cloud this file (S8.14) — a thin bar along the foot.
export function AssetTile({
  asset,
  url,
  picked,
  canDrag,
  onPick,
  onMenu,
  caption = false,
  uploading = null,
}) {
  const used = usageWords(asset);
  const isImage = asset.kind === 'image';
  return (
    <button
      type="button"
      className={caption ? 'lp-tile lp-tile--cap' : 'lp-tile'}
      data-testid="assets-tile"
      data-asset={asset.path}
      data-kind={asset.kind}
      aria-pressed={picked}
      aria-label={
        uploading ? `${tileLabel(asset)}. ${uploadWords(asset.name, uploading)}` : tileLabel(asset)
      }
      onClick={(e) => onPick(asset.path, e)}
      onContextMenu={(e) => {
        onPick(asset.path, e, true);
        onMenu(e, asset);
      }}
      {...(isImage && canDrag ? tileDragProps(asset.path) : {})}
    >
      {asset.kind === 'video' ? (
        <video className="lp-thumb" src={url} muted playsInline preload="metadata" />
      ) : asset.kind === 'audio' ? (
        <span className="lp-thumb lp-thumb--sound">
          <StIcon name="resolve" size={16} />
        </span>
      ) : (
        <img className="lp-thumb" src={url} alt="" loading="lazy" draggable={false} />
      )}
      {uploading && !caption ? (
        <span
          className="lp-tile-up"
          data-testid="assets-tile-up"
          data-known={typeof uploading.progress === 'number' ? 'true' : 'false'}
          aria-hidden="true"
        >
          <b
            style={
              typeof uploading.progress === 'number'
                ? { width: `${Math.round(uploading.progress * 100)}%` }
                : undefined
            }
          />
        </span>
      ) : null}
      {caption ? (
        // the wide Browse view names every picture under it; the hover tip would cover the next row
        <span className="lp-tile-cap" aria-hidden="true">
          {asset.name}
        </span>
      ) : (
        <span className="lp-tile-tip" aria-hidden="true">
          <strong>{asset.name}</strong>
          {used ? <span>{used}</span> : null}
        </span>
      )}
    </button>
  );
}
