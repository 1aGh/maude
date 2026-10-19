// client/v2/ai/ask-selection-lane.js — S2.19: the shell's half of ⌘/ on a selection (14 `ed-edge-ask`).
//
// The canvas says two things, both through the dgn table (bridge/dgn-protocol.ts, c2s, gate 'active'):
//   `ask-selection { refs, selection, rect }`   ⌘/ was pressed with these elements selected, here (iframe px)
//   `ask-selection-rect { rect }`               the AI outline over the asked elements is here now (`null`: gone)
//
// The bubble is drawn by the shell — the words are the person's and a canvas never sees them. This lane is the
// bubble's state machine:
//
//   closed ──open──▶ input ──submit(text)──▶ asked ──outline gone / grace──▶ closed
//                      └─────────────── esc / canvas switched ──────────────▶ closed
//
// `asked` follows the outline's rect (pan, zoom, a moving page). It closes when the outline that had appeared
// is gone (the run is over), or — if no outline ever came (a queued ask, a refused one) — after GRACE_MS.
//
// No DOM, no React: test/v2-ask-selection.test.ts runs it directly.

import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';
import { artboardScope, elementsScope } from './scope.js';

/** How long an `asked` bubble waits for its outline before it gives up. */
export const GRACE_MS = 10_000;
const SELECTED_MAX = 12;

const CLOSED = Object.freeze({ phase: 'closed' });

/**
 * @param {{ canvasOrigin: () => string, activePath: () => string|null|undefined,
 *   frameOf: (path: string) => { contentWindow?: Window|null }|undefined, now?: () => number }} deps
 */
export function createAskSelectionLane(deps) {
  const now = deps.now ?? Date.now;
  let state = CLOSED;
  const subs = new Set();
  const set = (next) => {
    state = next;
    for (const fn of subs) fn();
  };
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };

  return {
    get: () => state,
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    /** The window `message` handler. Everything is validated by the dgn table before it is read. */
    onMessage(e) {
      const t = e?.data?.dgn;
      if (t !== 'ask-selection' && t !== 'ask-selection-rect') return;
      const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
      if (!m) return;
      const path = deps.activePath();
      if (!path) return;
      if (m.dgn === 'ask-selection') {
        // S2.21 — an artboard's “Ask AI about this artboard” names the artboard (no elements): its whole page
        const scope =
          m.artboard && !m.refs.length
            ? artboardScope(m.artboard)
            : elementsScope(
                m.refs,
                (m.selection || []).slice(0, SELECTED_MAX).map((s) => ({ ...s, file: path }))
              );
        if (!scope || !m.rect) return;
        set({ phase: 'input', path, scope, rect: m.rect, text: '', at: now(), seen: false });
      } else if (m.dgn === 'ask-selection-rect' && state.phase === 'asked') {
        if (m.rect) set({ ...state, rect: m.rect, seen: true });
        else if (state.seen) set(CLOSED);
      }
    },

    /** ↵ in the bubble: the words are on their way; the bubble now shows them while the run works. */
    submit(text) {
      if (state.phase !== 'input') return false;
      const words = String(text ?? '').trim();
      if (!words) return false;
      set({ ...state, phase: 'asked', text: words, at: now(), seen: false });
      return true;
    },

    /** A clock tick: an `asked` bubble whose outline never came gives up. */
    tick() {
      if (state.phase === 'asked' && !state.seen && now() - state.at > GRACE_MS) set(CLOSED);
    },

    close() {
      if (state.phase !== 'closed') set(CLOSED);
    },

    /** The active canvas changed: a bubble is about one canvas. */
    switched() {
      if (state.phase !== 'closed' && state.path !== deps.activePath()) set(CLOSED);
    },
  };
}
