// client/v2/shell/shell-panels-relay.js - V2-8.5 c7 (15 an-stk-gallery, 04 md-edit-image): the shell tells every open
// canvas which of ITS tool panels is up, so the dock presses the slot that opened it (Stickers · E under the
// gallery, Image · I beside the Assets panel). Parent -> iframe only; the canvas never answers.
//
//   { dgn: 'shell-panels', v: 1, open: 'stickers' | 'assets' | 'components' | null }
//
// A state, not an event: the whole answer each time. A frame that has just loaded does not listen yet, so it is
// told again on `loaded` / `canvas-rendered`; an unchanged answer is not re-sent to a frame that already has it.
// The Stickers gallery wins when several are up (it is the one anchored to the dock), then the Component picker
// (P8 C8, 04 md-edit-component: its slot is pressed while the picker is open), then Assets.

import { useEffect, useRef } from 'react';

const FRAME = 'iframe[data-testid="canvas-frame"]';

/** What the canvas is told for the two shell facts. */
export function openPanel({ stickers, assets, components = false }) {
  return stickers ? 'stickers' : components ? 'components' : assets ? 'assets' : null;
}

export function createShellPanelsLane({
  doc = globalThis.document,
  win = globalThis.window,
  frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])],
} = {}) {
  let open = null;
  const spoken = new WeakMap(); // Window -> the answer last sent to it
  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    // a frame never spoken to, with nothing to say, stays quiet; one that was told 'stickers' hears the null
    if (!force && (spoken.has(target) ? spoken.get(target) === open : open === null)) return;
    spoken.set(target, open);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'shell-panels', v: 1, open }, '*');
    } catch {
      /* detached */
    }
  };
  const tellAll = () => {
    for (const f of frames()) tell(f);
  };
  function set(next) {
    if (next === open) return;
    open = next;
    tellAll();
  }
  function onMessage(e) {
    const dgn = e?.data?.dgn;
    if (dgn !== 'loaded' && dgn !== 'canvas-rendered') return;
    for (const f of frames()) {
      if (f.contentWindow && f.contentWindow === e.source) {
        spoken.delete(f.contentWindow); // a reloaded document forgot it
        tell(f);
      }
    }
  }
  const attach = () => win?.addEventListener?.('message', onMessage);
  const detach = () => win?.removeEventListener?.('message', onMessage);
  return {
    set,
    onMessage,
    tellAll,
    attach,
    detach,
    get open() {
      return open;
    },
  };
}

/** Mounted once by the shell (app.jsx). */
export function useShellPanelsRelay({ stickersOpen, assetsOpen, componentsOpen = false }) {
  const laneRef = useRef(null);
  if (!laneRef.current) laneRef.current = createShellPanelsLane();
  const lane = laneRef.current;
  useEffect(() => {
    lane.attach();
    return () => lane.detach();
  }, [lane]);
  const next = openPanel({
    stickers: !!stickersOpen,
    assets: !!assetsOpen,
    components: !!componentsOpen,
  });
  useEffect(() => {
    lane.set(next);
  }, [lane, next]);
}
