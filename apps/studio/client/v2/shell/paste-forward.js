// client/v2/shell/paste-forward.js — the shell half of Menu › Edit › Paste into the canvas (p8-sweep-leftovers 8).
//
// The canvas frame may not read the clipboard (its iframe allows `clipboard-write` only, DDR-054), so the trusted
// shell reads it on the person's own menu pick and forwards a bounded `paste-data` message (bridge/paste-data.ts).
// Only text/plain, text/html and the first allowlisted picture are read; anything past the caps is left out.

import { okImage, PASTE_IMAGE_TYPES, PASTE_TEXT_MAX } from '../../../bridge/paste-data.ts';

/**
 * What the clipboard holds, as a `paste-data` payload (without `dgn`), or null when it holds nothing we forward or
 * the read was refused.
 * @param {Clipboard | undefined} clipboard
 */
export async function readPasteData(clipboard = globalThis.navigator?.clipboard) {
  if (!clipboard) return null;
  const out = {};
  const keepText = (key, s) => {
    if (out[key] == null && typeof s === 'string' && s && s.length <= PASTE_TEXT_MAX) out[key] = s;
  };
  try {
    if (typeof clipboard.read !== 'function') throw new Error('no read');
    const items = await clipboard.read();
    for (const it of items ?? []) {
      for (const type of it.types ?? []) {
        if (type === 'text/plain' || type === 'text/html') {
          if (out[type === 'text/plain' ? 'text' : 'html'] != null) continue;
          keepText(type === 'text/plain' ? 'text' : 'html', await (await it.getType(type)).text());
        } else if (!out.image && PASTE_IMAGE_TYPES.includes(type)) {
          const b = await it.getType(type);
          const img = b?.type === type ? b : new Blob([b], { type });
          if (okImage(img)) out.image = img;
        }
      }
    }
  } catch {
    try {
      keepText('text', await clipboard.readText());
    } catch {
      return null;
    }
  }
  return out.text || out.html || out.image ? { v: 1, ...out } : null;
}
