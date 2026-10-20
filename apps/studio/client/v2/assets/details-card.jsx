// client/v2/assets/details-card.jsx — the first, plain details for an asset (S8.12: ⌘I / "Show details").
//
// What the index already knows: the file, its kind and size, and which canvases use it. The per-kind details sheet
// (Made by AI, what AI saw, Advanced) is S8.21's and replaces this card; the id `assets-details` and the Close button
// carry over. A read only: it writes nothing and works for every role.

import { displayName } from '../../shell/util.js';
import { sizeWords } from './tile.jsx';
import { usageWords } from './use-assets.js';

const KIND_WORDS = { image: 'Picture', video: 'Video', audio: 'Sound' };

const canvasName = (rel) => displayName(String(rel).split('/').pop() || rel);

export function AssetDetailsCard({ asset, onClose, onOpenCanvas }) {
  const used = asset.usedIn ?? [];
  return (
    <section
      className="lp-details"
      data-testid="assets-details"
      aria-label={`Details of ${asset.name}`}
    >
      <div className="lp-details-head">
        <strong className="lp-details-name">{asset.name}</strong>
        <button
          type="button"
          className="st-iconbtn"
          data-testid="assets-details-close"
          aria-label="Close details"
          onClick={onClose}
        >
          ×
        </button>
      </div>
      <p className="lp-details-meta">
        {KIND_WORDS[asset.kind] ?? 'File'} · {sizeWords(asset.size)}
      </p>
      <p className="lp-details-used">
        {usageWords(asset) || 'Where it is used is not known here.'}
      </p>
      {used.length ? (
        <ul className="lp-details-list">
          {used.map((rel) => (
            <li key={rel}>
              {onOpenCanvas ? (
                <button type="button" className="lp-details-link" onClick={() => onOpenCanvas(rel)}>
                  {canvasName(rel)}
                </button>
              ) : (
                canvasName(rel)
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
