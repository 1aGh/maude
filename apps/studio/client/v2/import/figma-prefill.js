// client/v2/import/figma-prefill.js — the link Home's "Import from Figma" sheet carried (02 ob-adv-sheets).
//
// Home asks for the Figma link (a link is not a secret) and hands it to the project window as the import-figma
// intent's prompt. The window's own sheet opens with it filled in; the access token never rides along — it is
// asked in the window, where the project's server can keep it. The slot is taken ONCE, so a second open of the
// sheet starts empty, and only a link of the right shape ever lands in it (anything else is dropped, never run).

import { figmaLinkKind, normalizeLink } from './figma-model.js';

let slot = '';

/** Park a link for the next sheet open; anything that is not a Figma link clears the slot. */
export function setFigmaPrefill(raw) {
  const kind = figmaLinkKind(raw);
  slot = kind === 'design' || kind === 'figjam' ? normalizeLink(raw) : '';
}

/** Hand the parked link over once ('' when there is none). */
export function takeFigmaPrefill() {
  const v = slot;
  slot = '';
  return v;
}
