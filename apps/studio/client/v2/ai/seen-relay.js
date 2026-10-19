// client/v2/ai/seen-relay.js — S4.15 (15 Annotations `an-ai-read`): the shell tells the open canvas where the
// AI's "Make these changes" offer points, so the annotation layer can outline it ("✦ The hero picture").
// Parent → iframe only; the canvas never answers.
//
// The offer card (OfferCard.jsx) puts its targets here while it is the latest message and takes them away when it
// is answered or the chat moves on. What leaves the shell is `{dgn:'ai-seen', targets: [{ref, tag}]}` — a host
// ref and a tag built from the ref alone (ai-offer.js `seenTargetsFor`); never a word of the answer (DDR-054).
//
// Which frames: every canvas iframe (`canvas-frame`) — a target that does not exist on a canvas draws nothing
// there. A frame that has just loaded does not listen yet, so it is told again on `loaded` / `canvas-rendered`.

import { useEffect } from 'react';

const FRAME = 'iframe[data-testid="canvas-frame"]';

export function createSeenStore() {
  let targets = [];
  let key = '[]';
  const subs = new Set();
  return {
    get: () => targets,
    /** Replace the outlined targets (`[]` clears). An unchanged list is not news. */
    set(next) {
      const list = Array.isArray(next) ? next : [];
      const k = JSON.stringify(list);
      if (k === key) return;
      key = k;
      targets = list;
      for (const fn of subs) fn();
    },
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
  };
}

let shared = null;
/** The one store the offer card writes and the relay reads. */
export const getSeenStore = () => {
  if (!shared) shared = createSeenStore();
  return shared;
};

export function createSeenLane({
  store = getSeenStore(),
  doc = globalThis.document,
  win = globalThis.window,
} = {}) {
  const spoken = new WeakMap(); // Window → the JSON last sent to it
  const frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])];

  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    const targets = store.get();
    const json = JSON.stringify(targets);
    const before = spoken.get(target);
    if (!force && before === json) return;
    // a frame never spoken to with nothing to say stays quiet; one that had outlines is told they are gone
    if (before === undefined && json === '[]') return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'ai-seen', targets }, '*');
    } catch {
      /* detached */
    }
  };
  const tellAll = () => {
    for (const f of frames()) tell(f);
  };

  const unsub = store.subscribe(tellAll);
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
    win?.removeEventListener?.('message', onMessage);
  };
}

/** Mount once (the AI island is always mounted): keeps the open canvas's outlines current. */
export function useAiSeenLane(store) {
  useEffect(() => createSeenLane({ store: store || getSeenStore() }), [store]);
}
