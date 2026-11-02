// client/v2/ai/ring-relay.js — S5.11 (P3): the shell tells the open canvas which artboards an AI is on, so the
// canvas can draw the spark outline and the tag (artboard-activity-overlay.tsx). Parent → iframe only; the
// canvas never answers and never reads the registry itself.
//
// The message is `{dgn:'ai-runs', artboards: Record<artboardId, {state, who, tag, waiting}>}` — built by
// `ringsFor` (runs-model.js), which carries a state, a name and a count and never a prompt.
//
// S9.22b — beside it, `{dgn:'ai-holds', holds: [{artboard, element, occurrence?, tag, mine}]}` (`holdsFor`):
// the OBJECTS running / needs-you runs hold, for the canvas's spark outline + tag and the inspector's hold
// line (editing/hold-rings.tsx). Same rule: a fixed tag from the state and a name, never a prompt.
//
// V2-8.5 c7 (03 `ai-copy`) - and `{dgn:'ai-copies', v:1, copies:[{from, to}]}` (`copyLinksFor`): the copies a
// "Run on a copy" made, for the dashed link and "Copied from <name>" (artboard-ai-copies.tsx). Ids only.
//
// Which frames: the ACTIVE canvas iframe (`canvas-frame`, `data-path` = its file). A frame that has just
// loaded does not listen yet, so it is told again on `loaded` / `canvas-rendered`; an unchanged answer is
// not re-sent to a frame that already has it.

import { useEffect } from 'react';
import { canvasTargetOrigin } from '../kinds/kind-dim-relay.js';
import { getMadeByAiStore, madeByAiRings } from './made-by-ai.js';
import {
  copyExpiry,
  copyLinksFor,
  doneRings,
  holdsFor,
  mergeRings,
  pointExpiry,
  pointsFor,
  ringsFor,
} from './runs-model.js';
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
  const spokenHolds = new WeakMap(); // Window → the `ai-holds` JSON last sent to it
  const spokenCopies = new WeakMap(); // Window → the `ai-copies` JSON last sent to it
  const frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])];

  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    // V2-8.9 defender L2 (checklist C6): the frame's own canvas origin, never '*' — a frame that
    // navigated elsewhere (or has no origin) hears nothing
    const origin = canvasTargetOrigin(frame);
    if (!origin) return;
    const { view, done } = store.getSnapshot();
    const file = frame.getAttribute('data-path') || frame.dataset?.path || '';
    const artboards = mergeRings(ringsFor(view, { activeCanvas: file }), {
      ...madeByAiRings(madeByAi?.getSnapshot(), file),
      ...doneRings(Object.keys(done)),
    });
    const json = JSON.stringify(artboards);
    const before = spoken.get(target);
    // a frame never spoken to with nothing to say stays quiet; one that had rings is told they are gone
    if ((force || before !== json) && !(before === undefined && json === '{}')) {
      spoken.set(target, json);
      try {
        // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
        target.postMessage({ dgn: 'ai-runs', artboards }, origin);
      } catch {
        /* detached */
      }
    }
    const copies = copyLinksFor(view, { activeCanvas: file });
    const copiesJson = JSON.stringify(copies);
    const copiesBefore = spokenCopies.get(target);
    if (
      (force || copiesBefore !== copiesJson) &&
      !(copiesBefore === undefined && copiesJson === '[]')
    ) {
      spokenCopies.set(target, copiesJson);
      try {
        target.postMessage({ dgn: 'ai-copies', v: 1, copies }, origin);
      } catch {
        /* detached */
      }
    }
    const holds = [
      ...holdsFor(view, { activeCanvas: file }),
      ...pointsFor(view, { activeCanvas: file }),
    ];
    const holdsJson = JSON.stringify(holds);
    const holdsBefore = spokenHolds.get(target);
    if (!force && holdsBefore === holdsJson) return;
    if (holdsBefore === undefined && holdsJson === '[]') return;
    spokenHolds.set(target, holdsJson);
    try {
      target.postMessage({ dgn: 'ai-holds', holds }, origin);
    } catch {
      /* detached */
    }
  };

  const tellAll = () => {
    for (const f of frames()) tell(f);
  };

  // S5.19 — the spot a question marked lets go on its own: tell the frames again when it expires
  let expiryTimer = null;
  function onTick() {
    tellAll();
    const view = store.getSnapshot().view;
    const ends = [pointExpiry(view), copyExpiry(view)].filter((t) => t !== null);
    const at = ends.length ? Math.min(...ends) : null;
    clearTimeout(expiryTimer);
    expiryTimer = at === null ? null : setTimeout(onTick, Math.max(0, at - Date.now()) + 50);
  }
  const unsub = store.subscribe(onTick);
  const unsubMade = madeByAi?.subscribe(tellAll);
  const onMessage = (e) => {
    const dgn = e.data?.dgn;
    if (dgn !== 'loaded' && dgn !== 'canvas-rendered') return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    if (frame) {
      spoken.delete(frame.contentWindow);
      spokenHolds.delete(frame.contentWindow);
      spokenCopies.delete(frame.contentWindow);
      tell(frame, true);
    }
  };
  win?.addEventListener?.('message', onMessage);
  onTick();
  return () => {
    clearTimeout(expiryTimer);
    unsub();
    unsubMade?.();
    win?.removeEventListener?.('message', onMessage);
  };
}

/** Mount once (the AI island is always mounted): keeps the open canvas's rings current. */
export function useAiRingsLane(store) {
  useEffect(() => createRingsLane({ store: store || getRunsStore() }), [store]);
}
