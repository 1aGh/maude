// client/v2/create/duplicate-done.js — S6.16b (01 cf-duplicate-done): the toast after "Duplicate at another width".
//
//   "Duplicated at Laptop — 1280 wide."  +  Undo
//
// The SHELL says it, not the canvas. The canvas's write reaches the server through the shell (`edit-op`,
// use-canvas-bridge.jsx), so the shell sees both the request and the server's answer, and builds the words from
// those. A canvas notice never carries an action (decision maude/v2-sec-a-canvas-toast-no-undo: the canvas cannot
// prove an Undo button is the person's own step); this toast is the shell's own, the same way the inspector's
// "Add a width" toast is (S7.21, add-width.js). That one has the first turn: it knows what it asked for, so it
// settles before this does and the person never gets two toasts for one write.
//
//   settleDuplicateAtWidth(body, result, undo) → { message, action? } | null
//     body    the edit-op request the shell forwarded
//     result  the answer it got
//     undo    the shell's own ⌘Z (the bridge passes menuRunner.run('edit.undo'))

import { WIDTH_PRESETS } from '../../../editing/artboard-resize.ts';

const PRESET_NAME = new Map(WIDTH_PRESETS.map((p) => [p.w, p.label]));

/** A width a board could honestly have (api.ts `dim`: 64 … 8192 world px). */
const honest = (w) => typeof w === 'number' && Number.isFinite(w) && w >= 64 && w <= 8192;

/** 1280 → "Duplicated at Laptop — 1280 wide."; a width that is no preset → "Duplicated at 1000 wide." (01 words). */
export function duplicatedAtWords(width) {
  const name = PRESET_NAME.get(width);
  return name ? `Duplicated at ${name} — ${width} wide.` : `Duplicated at ${width} wide.`;
}

/**
 * @param {{ op?: string, params?: { items?: Array<{ width?: number }> } } | undefined} body
 * @param {{ ok?: boolean } | undefined} result
 * @param {(() => void) | undefined} [undo]
 * @returns {{ message: string, action?: { label: string, onClick: () => void } } | null}
 */
export function settleDuplicateAtWidth(body, result, undo) {
  if (body?.op !== 'artboard.duplicate-at-width' || !result?.ok) return null;
  const items = body.params?.items;
  if (!Array.isArray(items) || items.length === 0) return null;
  const width = items[0]?.width;
  // one sentence needs one width: "Tablet and Mobile" (two widths) is the inspector's toast, not this one
  if (!honest(width) || !items.every((i) => i?.width === width)) return null;
  const message = duplicatedAtWords(width);
  return undo ? { message, action: { label: 'Undo', onClick: () => undo() } } : { message };
}
