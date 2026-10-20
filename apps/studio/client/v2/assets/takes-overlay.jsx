// client/v2/assets/takes-overlay.jsx — "Take 3 of 4" and "Picture made by AI" over the canvas (S8.16; 12 · ia-gen-placed).
//
// With a generated picture selected the shell shows one small island at the bottom of the canvas: ‹ Take 3 of 4 › with
// ← → beside it (the arrows run `image.prev-take` / `image.next-take`, the same function the keys do), and the
// picture's own "Picture made by AI" line — the picture carries it, not the artboard. A picture with one take shows the
// line alone; a picture no AI made shows nothing. Edit mode only (Preview, Viewing and Present keep the canvas clean).
//
// `TakesIsland` is the pure render; `ShellTakes` mounts the lane (use-takes-lane.js) from the shell store.

import { useSyncExternalStore } from 'react';
import { Kbd, StIcon } from '../../shell/icons.jsx';
import { useShellStore } from '../../stores/shell-store.jsx';
import { shellMode } from '../shell/use-canvas-mode-lane.js';
import { runTakeStep, useSelectedTakes, useTakesLane } from './use-takes-lane.js';

export const MADE_BY_AI = 'Picture made by AI';

/** @param {{ label: string | null, madeByAi: object | null, canStep: boolean, onStep: (dir: 'next' | 'prev') => void }} p */
export function TakesIsland({ label, madeByAi, canStep, onStep }) {
  if (!label && !madeByAi) return null;
  return (
    <div className="v2-takes" data-testid="takes-island">
      {madeByAi ? (
        <span className="v2-takes-made" data-testid="takes-made-by-ai">
          <StIcon name="sparkle" size={11} />
          {MADE_BY_AI}
        </span>
      ) : null}
      {label ? (
        <span className="v2-takes-pill" data-testid="takes-pill">
          <button
            type="button"
            className="st-iconbtn v2-takes-b v2-takes-b--prev"
            data-testid="takes-prev"
            aria-label="Previous take"
            disabled={!canStep}
            onClick={() => onStep('prev')}
          >
            <StIcon name="chevron-right" size={12} />
          </button>
          <span className="v2-takes-t" role="status" data-testid="takes-label">
            {label}
          </span>
          <button
            type="button"
            className="st-iconbtn v2-takes-b"
            data-testid="takes-next"
            aria-label="Next take"
            disabled={!canStep}
            onClick={() => onStep('next')}
          >
            <StIcon name="chevron-right" size={12} />
          </button>
          <span className="v2-takes-k" aria-hidden="true">
            <Kbd>←</Kbd>
            <Kbd>→</Kbd>
          </span>
        </span>
      ) : null}
    </div>
  );
}

/** The app mount (one line in app.jsx). */
export function ShellTakes() {
  const {
    shellCore: { activePath, cfg, iframesRef, postToActiveCanvas, selected, viewerMode },
  } = useShellStore();
  useTakesLane({ activePath, selected, viewerMode, postToActiveCanvas, iframesRef, cfg });
  const snap = useSyncExternalStore(shellMode.subscribe, shellMode.get, shellMode.get);
  const shown = useSelectedTakes(activePath, selected);
  if (!shown || (snap?.mode && snap.mode !== 'edit') || snap?.present) return null;
  return (
    <TakesIsland
      label={shown.label}
      madeByAi={shown.madeByAi}
      canStep={!viewerMode}
      onStep={(dir) =>
        void runTakeStep(dir, { activePath, selected, viewerMode, postToActiveCanvas })
      }
    />
  );
}
