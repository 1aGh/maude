// client/v2/transcript/captions-file-flag.js — S7.11: the seam for "Also as a file" (07 · ve-captions).
//
// Whether a video's captions are also written as a .srt on export belongs to the export sheet (S8, C19/C36:
// "captions default Off"). The Captions inspector draws the row only when S8 has registered its store here, so
// there is exactly one place the answer lives and no switch that does nothing.
//
//   registerCaptionsFileFlag({ get(canvas, artboardId) → boolean, set(canvas, artboardId, on), subscribe(fn) })

let impl = null;
const subs = new Set();
let version = 0;
const notify = () => {
  version += 1;
  for (const fn of subs) fn();
};

/** @returns {() => void} take it back out */
export function registerCaptionsFileFlag(next) {
  impl = next;
  const off = next?.subscribe?.(notify);
  notify();
  return () => {
    if (impl === next) impl = null;
    off?.();
    notify();
  };
}

export const captionsFileFlag = {
  available: () => !!impl,
  get: (canvas, artboardId) => !!impl?.get(canvas, artboardId),
  set: (canvas, artboardId, on) => impl?.set(canvas, artboardId, !!on),
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
  version: () => version,
};
