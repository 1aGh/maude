// client/v2/create/open-sizes.js — R2-P2 (TD2): a new canvas opens with the F size picker already up.
//
// The picker is normally asked for by the CANVAS (F over empty canvas → `tool-panel-open {panel:'sizes'}`). A
// canvas that has only just been made has not asked yet, so the door that made it asks for it here: a request
// for the file, remembered until that canvas is the open one (SizePickerHost watches `activePath`), then taken.
// A request is good for `OPEN_SIZES_TTL_MS`: a canvas that never opens must not pop the picker up on whatever
// the person is looking at ten minutes later.

export const OPEN_SIZES_EVENT = 'maude:open-sizes';
export const OPEN_SIZES_TTL_MS = 15_000;

let pending = null; // { file, at } | null

/** Ask for the size picker on `file` once it is the open canvas. */
export function requestSizePicker(file, target = globalThis.window, now = Date.now()) {
  if (typeof file !== 'string' || !file) return;
  pending = { file, at: now };
  target?.dispatchEvent?.(new CustomEvent(OPEN_SIZES_EVENT, { detail: { file } }));
}

const baseOf = (p) => String(p).split('/').pop();

/**
 * If a request is waiting and `activePath` is its canvas (or the same file after a move into a folder: the
 * name is the match), take it and answer the canvas the picker should open for; else null.
 */
export function takeSizePicker(activePath, now = Date.now()) {
  if (!pending || typeof activePath !== 'string' || !activePath) return null;
  if (now - pending.at > OPEN_SIZES_TTL_MS) {
    pending = null;
    return null;
  }
  if (activePath !== pending.file && baseOf(activePath) !== baseOf(pending.file)) return null;
  pending = null;
  return activePath;
}

/** Test seam: forget any waiting request. */
export function clearSizePickerRequest() {
  pending = null;
}
