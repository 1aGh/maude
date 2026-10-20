// The Design system canvas's bar (S10.6, 13 `DsBar`): the system's name, the Light | Dark switch
// and — once S10.7 writes any — "N changes waiting". Light | Dark is the SYSTEM's own mode; the
// switch never touches `<html>` or the app's theme (state.ts).
//
// Drawn in neutral system colours (`Canvas` / `CanvasText`), not the system's tokens: it is Maude's
// bar over the user's design, so a locked or garish brand must not restyle it.

import { createPortal } from 'react-dom';
import { setBoardMode, useBoardMode, useBoardModel } from './state.ts';
import type { BoardMode, BoardModel } from './types.ts';

/** "1 change waiting" · "3 changes waiting"; null when nothing waits. */
export const waitingWords = (n: number): string | null =>
  n <= 0 ? null : `${n} ${n === 1 ? 'change' : 'changes'} waiting`;

/** S10.18c: a linked team library is read here and edited at home (13 · ds-many-linked). */
export const VIEW_ONLY_WORDS = 'Linked library — view only';

export function DsBarView({
  model,
  mode,
  onMode,
  onReview,
}: {
  model: BoardModel;
  mode: BoardMode;
  onMode: (m: BoardMode) => void;
  onReview?: () => void;
}) {
  const linked = !!model.library;
  // a linked library takes no edits here: nothing waits, so there is nothing to Review…
  const waiting = linked ? null : waitingWords(model.pendingCount);
  const colours = model.tokens.filter((t) => t.section === 'colour').length;
  const hasDark = model.themes.dark !== null;
  return (
    <div className="ds-bar" data-testid="ds-bar" role="toolbar" aria-label="Design system">
      <b>{model.label}</b>
      <fieldset className="ds-bar-seg" aria-label="Show the system in">
        {(['light', 'dark'] as const).map((m) => (
          <button
            key={m}
            type="button"
            className="ds-bar-b"
            data-testid={`ds-bar-mode-${m}`}
            aria-pressed={mode === m}
            disabled={m === 'dark' && !hasDark}
            onClick={() => onMode(m)}
          >
            {m === 'light' ? 'Light' : 'Dark'}
          </button>
        ))}
      </fieldset>
      {mode === 'dark' ? (
        <span className="ds-bar-p">{colours} colours in their dark values</span>
      ) : null}
      {linked ? (
        <>
          <span className="ds-bar-sep" />
          <span className="ds-bar-p" data-testid="ds-bar-library">
            {VIEW_ONLY_WORDS}
          </span>
        </>
      ) : null}
      {waiting ? (
        <>
          <span className="ds-bar-sep" />
          <span className="ds-bar-p" data-testid="ds-bar-pending">
            <span className="ds-upd-dot" />
            {waiting}
          </span>
          {onReview ? (
            <button
              type="button"
              className="ds-bar-b ds-bar-review"
              data-testid="ds-bar-review"
              onClick={onReview}
            >
              Review…
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/**
 * The connected bar a canvas mounts: reads the registered model, drives the preview, and lifts
 * itself out of the canvas's transformed world (a portal to `<body>`) so it stays put while the
 * board pans and zooms.
 */
export function DsBar({ onReview, portal = true }: { onReview?: () => void; portal?: boolean }) {
  // "Review…" asks the shell for "Update N canvases" (S10.8); a caller with its own door passes `onReview`
  const ask = onReview ?? (() => window.parent.postMessage({ dgn: 'ds-review' }, '*'));
  const model = useBoardModel();
  const mode = useBoardMode();
  if (!model) return null;
  const bar = <DsBarView model={model} mode={mode} onMode={setBoardMode} onReview={ask} />;
  return portal && typeof document !== 'undefined' ? createPortal(bar, document.body) : bar;
}
