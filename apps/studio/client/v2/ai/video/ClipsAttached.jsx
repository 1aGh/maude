// client/v2/ai/video/ClipsAttached.jsx — S7.15 (07 · ve-ai-watch, ve-ai-cut): the footage an ask came with,
// as one quiet line under it — a little stack of the first three, "12 clips · 1:20 of footage · from Assets".
// Presentational: `model` is card-model.js `clipsAttachedModel`; `urlOf(asset)` is where the studio serves it.

import { posterSrc } from './clip-pic.js';

export function ClipsAttached({ model, urlOf }) {
  if (!model) return null;
  return (
    <span className="ai-vatt" data-testid="ai-clips-attached">
      <span className="ai-vatt-stack" aria-hidden="true">
        {model.assets.map((a) => (
          <span key={a}>
            <video src={posterSrc(urlOf(a))} preload="metadata" muted playsInline tabIndex={-1} />
          </span>
        ))}
      </span>
      <span>
        <b>{model.title}</b> <span className="ai-vatt-m">· {model.meta}</span>
      </span>
    </span>
  );
}
