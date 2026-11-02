// S10.4 (V2-1.6 §5.8 "Live updates") — when the head moves, the canvases that FOLLOW it swap their two
// links. Not under the viewer's eyes: 8 `ds-edit-review` says "Tereza's open Pricing updates when she next
// looks at it". So in the window of anyone other than the publisher the swap waits for the NEXT LOOK — a
// visibility change, a canvas switch, an artboard move — and Present holds it the way it already holds an
// AI edit (A8): the audience never sees a canvas change under them.
//
// Pure: `send(key, message)` is the only effect (the shell posts `message` into that canvas's frame; the
// canvas shell swaps `#canvas-tokens` / `#canvas-components`). No timers, no DOM — the caller says when a
// look happened.

/** What counts as "the next look". */
export const LOOKS = Object.freeze(['visible', 'canvas-switch', 'artboard-move']);

/**
 * @param {{ send: (key: string, message: { dgn: 'ds-css', tokens: string | null, components: string | null }) => void,
 *           presenting?: () => boolean }} deps
 */
export function createFollowerSwap({ send, presenting = () => false }) {
  /** key → what the frame shows now ("tokens|components") */
  const shown = new Map();
  /** key → what it must show at the next look */
  const waiting = new Map();

  const sig = (m) => `${m.tokens ?? ''}|${m.components ?? ''}`;

  function flush(key) {
    const next = waiting.get(key);
    if (!next) return false;
    waiting.delete(key);
    if (shown.get(key) === sig(next)) return false;
    shown.set(key, sig(next));
    send(key, { dgn: 'ds-css', tokens: next.tokens, components: next.components });
    return true;
  }

  return {
    /** The frame was built showing these two files (the URL's `tokens=` / `components=`). */
    seed(key, tokens, components) {
      shown.set(key, sig({ tokens, components }));
      waiting.delete(key);
    },

    /**
     * The head moved: `key`'s canvas should now show `tokens` / `components`. The publisher's own window
     * (`own`) swaps at once — they asked for it; everyone else waits for their next look. Present holds
     * both.
     */
    headMoved({ key, tokens, components, own = false }) {
      if (shown.get(key) === sig({ tokens, components })) {
        waiting.delete(key); // it moved back to what this frame already shows
        return false;
      }
      waiting.set(key, { tokens, components });
      return own && !presenting() ? flush(key) : false;
    },

    /**
     * Someone looked: `reason` ∈ LOOKS, at canvas `key` (all waiting canvases when omitted). A look that
     * is not the presenter moving on does nothing while presenting.
     * @returns {number} how many canvases swapped
     */
    look(reason, key) {
      if (!LOOKS.includes(reason)) return 0;
      if (presenting() && reason !== 'artboard-move') return 0;
      let n = 0;
      for (const k of key === undefined ? [...waiting.keys()] : [key]) if (flush(k)) n++;
      return n;
    },

    /** Present ended: everything that waited behind it lands. */
    presentEnded() {
      let n = 0;
      for (const k of [...waiting.keys()]) if (flush(k)) n++;
      return n;
    },

    /** A canvas closed. */
    forget(key) {
      shown.delete(key);
      waiting.delete(key);
    },

    /** Keys with a swap waiting. */
    pending() {
      return [...waiting.keys()];
    },
  };
}
