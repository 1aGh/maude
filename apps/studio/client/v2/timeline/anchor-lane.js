// client/v2/timeline/anchor-lane.js — S7.7: the shell's side of the canvas's `artboard-anchor`; S7.8 adds
// `space-tap` (a quick Space on the canvas = play) under the same active-frame gate.
//
// Only the ACTIVE canvas's frame is believed (a background or synced canvas is untrusted, DDR-054), and the
// message is validated by the dgn table before any of it is read. What passes goes to the timeline store;
// the canvas's label is untrusted text and is clipped here. Pure (the window, the frame and the store are
// injected) so the rule is a unit test.

import { acceptFromCanvas } from '../../../bridge/dgn-protocol.ts';
import { SYSTEM_TAB } from '../../shell/constants.js';

const LABEL_MAX = 120;
const KEY_MAX = 4000;

/**
 * A selection's identity for "is this the same pick?": its file + selector per item, '' for nothing selected, or null
 * when it cannot be read (then it always counts as a new pick). Untrusted canvas data — only strings are read.
 */
function pickKey(sel) {
  if (sel == null) return '';
  const one = (s) =>
    s && typeof s === 'object' && typeof s.selector === 'string'
      ? `${typeof s.file === 'string' ? s.file : ''}\u0000${s.selector}`
      : null;
  const parts = (Array.isArray(sel) ? sel : [sel]).map(one);
  if (parts.some((p) => p === null)) return null;
  const key = parts.join('\u0001');
  return key.length > KEY_MAX ? null : key;
}

/**
 * @param {{ canvasOrigin: () => string, activePath: () => string|null,
 *   frameOf: (path: string) => { contentWindow: Window|null }|undefined,
 *   store: { anchor: (m: object) => void }, onSpaceTap?: () => void, onCanvasSelect?: () => void }} deps
 */
export function createAnchorLane(deps) {
  const activeWin = () => {
    const p = deps.activePath();
    return p && p !== SYSTEM_TAB ? (deps.frameOf(p)?.contentWindow ?? null) : null;
  };
  /** What the active canvas last said was selected (selector keys only), to tell a pick from a re-announce. */
  let lastPick;
  return {
    /** The window `message` handler. */
    onMessage(e) {
      const kind = e?.data?.dgn;
      // S7.10 — the person picked something on the canvas: the clip selected on the Timeline lets go (one thing is
      // selected at a time). Only that the ACTIVE frame made it is trusted; of the pick only its selector keys are
      // compared: a canvas that reloads re-announces the selection it already had, and that is no new pick (the
      // Inspector's rule too, P8 c6) — it must not take the inspector back from the clip.
      if (kind === 'select' || kind === 'select-set' || kind === 'clear-select') {
        if (
          deps.onCanvasSelect &&
          e.origin === deps.canvasOrigin() &&
          e.source &&
          e.source === activeWin()
        ) {
          const key = kind === 'clear-select' ? '' : pickKey(e.data.selection);
          if (key !== null && key === lastPick) return;
          lastPick = key ?? undefined;
          deps.onCanvasSelect();
        }
        return;
      }
      if (kind !== 'artboard-anchor' && kind !== 'space-tap') return;
      const m = acceptFromCanvas(e, { canvasOrigin: deps.canvasOrigin(), active: activeWin() });
      if (!m) return;
      if (kind === 'space-tap') {
        deps.onSpaceTap?.();
        return;
      }
      deps.store.anchor({
        artboardId: m.artboardId,
        kind: m.kind,
        label: typeof m.label === 'string' ? m.label.slice(0, LABEL_MAX) : undefined,
        rect: m.rect,
      });
    },
  };
}
