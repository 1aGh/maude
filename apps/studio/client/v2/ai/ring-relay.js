// client/v2/ai/ring-relay.js — S5.11 (P3): the shell tells the open canvas which artboards an AI is on, so the
// canvas can draw the spark outline and the tag (artboard-activity-overlay.tsx). Parent → iframe only; the
// canvas never answers and never reads the registry itself.
//
// The message is `{dgn:'ai-runs', artboards: Record<artboardId, {state, who, tag, waiting}>}` — built by
// `ringsFor` (runs-model.js), which carries a state, a name and a count and never a prompt.
//
// Which frames: the ACTIVE canvas iframe (`canvas-frame`, `data-path` = its file). A frame that has just
// loaded does not listen yet, so it is told again on `loaded` / `canvas-rendered`; an unchanged answer is
// not re-sent to a frame that already has it.

import { useEffect } from 'react';
import { getMadeByAiStore, madeByAiRings } from './made-by-ai.js';
import { mergeRings, ringsFor, doneRings } from './runs-model.js';
import { getRunsStore } from './runs-store.js';

const FRAME = 'iframe[data-testid="canvas-frame"]';

export function createRingsLane({
  store,
  // S5.15 — "Made by AI" (made-by-ai.js): settled rings that last until the next person's change
  madeByAi = getMadeByAiStore(),
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const spoken = new WeakMap(); // Window → the JSON last sent to it
  const frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])];

  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    const { view, done } = store.getSnapshot();
    const file = frame.getAttribute('data-path') || frame.dataset?.path || '';
    const artboards = mergeRings(ringsFor(view, { activeCanvas: file }), {
      ...madeByAiRings(madeByAi?.getSnapshot(), file),
      ...doneRings(Object.keys(done)),
    });
    const json = JSON.stringify(artboards);
    const before = spoken.get(target);
    if (!force && before === json) return;
    // a frame never spoken to with nothing to say stays quiet; one that had rings is told they are gone
    if (before === undefined && json === '{}') return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'ai-runs', artboards }, '*');
    } catch {
      /* detached */
    }
  };

  const tellAll = () => {
    for (const f of frames()) tell(f);
  };

  const unsub = store.subscribe(tellAll);
  const unsubMade = madeByAi?.subscribe(tellAll);
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
  return () => {
    unsub();
    unsubMade?.();
    win?.removeEventListener?.('message', onMessage);
  };
}

/** Mount once (the AI island is always mounted): keeps the open canvas's rings current. */
export function useAiRingsLane(store) {
  useEffect(() => createRingsLane({ store: store || getRunsStore() }), [store]);
}
