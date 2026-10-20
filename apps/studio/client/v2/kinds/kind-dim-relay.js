// client/v2/kinds/kind-dim-relay.js — S7.24b: the shell tells the open canvas which artboards the kind filter
// dims, so the canvas can draw them quiet (editing/kind-dim.tsx). Parent → iframe only; the canvas never answers.
//
// The message is `{dgn:'dim-artboards', ids: string[] | null}` — the ids of the artboards OUTSIDE the filter's kind
// (≤ DIM_IDS_MAX), `null` = dim nothing. The shell does the counting (the index knows each canvas's artboard
// kinds); the canvas only draws, so a planted canvas learns nothing it did not already render.
//
// Which frames: every `canvas-frame` the shell holds, each told by ITS OWN artboards (`boardsOf(file)`). A frame
// that has just loaded does not listen yet, so it is told again on `loaded` / `canvas-rendered`; an unchanged
// answer is not re-sent, and a frame never told anything with nothing to say stays quiet (the ring relay's rule).

import { getKindFilter, subscribeKindFilter } from './kind-filter-store.js';
import { dimIds } from './layers-kind-model.js';

const FRAME = 'iframe[data-testid="canvas-frame"]';

/**
 * @param {{ boardsOf: (file: string) => Array<{ id: string, kind?: string }> | undefined,
 *   doc?: Document, win?: Window }} deps
 * @returns {(() => void) & { refresh: () => void }} stop, with `.refresh()` for "the index learned something"
 */
export function createKindDimLane({
  boardsOf,
  doc = globalThis.document,
  win = globalThis.window,
}) {
  const spoken = new WeakMap(); // Window → the JSON last sent to it
  const frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])];

  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    const file = frame.getAttribute('data-path') || frame.dataset?.path || '';
    const ids = dimIds(boardsOf(file), getKindFilter());
    const json = JSON.stringify(ids);
    const before = spoken.get(target);
    if (!force && before === json) return;
    // nothing to dim and never told anything: leave the canvas alone; one that was told to dim hears "null"
    if (before === undefined && ids === null) return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'dim-artboards', ids }, '*');
    } catch {
      /* detached */
    }
  };

  const tellAll = () => {
    for (const f of frames()) tell(f);
  };

  const unsub = subscribeKindFilter(tellAll);
  const onMessage = (e) => {
    const dgn = e.data?.dgn;
    if (dgn !== 'loaded' && dgn !== 'canvas-rendered') return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    if (frame) {
      spoken.delete(frame.contentWindow);
      tell(frame, true);
    }
  };
  win?.addEventListener?.('message', onMessage);
  tellAll();

  const stop = () => {
    unsub();
    win?.removeEventListener?.('message', onMessage);
  };
  stop.refresh = tellAll;
  return stop;
}
