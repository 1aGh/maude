// client/v2/export/copy-command.js — 06 ad-search (P8 C10): ⌘K "Copy export command" (registry
// `export.copy-command`, Export › Advanced).
//
// Export › Advanced prints the sheet's export as a terminal line with a Copy beside it (advanced/command.jsx). The
// same line is a ⌘K row, so "copy" finds it from anywhere. There is no sheet behind a ⌘K press, so the line is the
// export of what the shell is showing — the selected artboard or object, else this canvas — as a PNG; the sheet's
// own Copy is for any other export. PURE except `write`, which is injected (a test passes a spy).
//
// The words come from the sheet's one writer (`advanced/command.js`), so the line is a command the CLI's own
// parser reads back as exactly this export.

import { COMPUTED_ID_RE, ELEMENT_ID_MAX, ELEMENT_ID_RE } from '../inspector/model.js';
import { commandLines } from './advanced/command.js';
import { boundCopyState, copyTarget } from './copy-png.js';
import { buildSpec, initialState } from './use-export-spec.js';

export const COMMAND_WORDS = Object.freeze({
  copied: 'Copied the export command — paste it into a terminal.',
  noCanvas: 'Open a canvas first.',
  failed: 'Couldn’t copy the command.',
  unsafe:
    'This canvas’s name has characters a terminal can’t show safely, so there is no command to copy.',
});

/** The studio's artboard-id rule (element-ids.ts ARTBOARD_WHERE_RE — a test holds them equal). */
export const ARTBOARD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;

// V2-8.9 attacker L1 — the selection is what the CANVAS reported (planted code chooses it), and the line
// goes into a terminal or a Claude Code prompt ("locators only", S2.19). So an id names the export only
// when it is an id by the studio's own grammar; anything else and the line falls back to the canvas.
const elementIdOk = (id) =>
  typeof id === 'string' &&
  id.length <= ELEMENT_ID_MAX &&
  (ELEMENT_ID_RE.test(id) || COMPUTED_ID_RE.test(id));
const artboardIdOk = (id) => typeof id === 'string' && ARTBOARD_ID_RE.test(id);

/** The terminal line for `{ selected, canvasFile, designRel }`, or null with no canvas open (or a
 *  canvas name the line refuses to carry — `shellQuote`). */
export function exportCommandText({ selected, canvasFile, designRel }) {
  if (!canvasFile) return null;
  const t = copyTarget(selected);
  const artboards = t.ok && t.target.artboardId ? [t.target.artboardId] : [];
  const elements = t.ok && t.target.elementIds ? t.target.elementIds : [];
  const named = artboards.every(artboardIdOk) && elements.every(elementIdOk);
  const ctx = {
    designRel,
    activePath: canvasFile,
    canvasOpen: true,
    artboards: named ? artboards : [],
    elements: named ? elements : [],
  };
  const hasSelection = ctx.artboards.length + ctx.elements.length > 0;
  const state = initialState({ format: 'png' }, { hasSelection, canvasOpen: true });
  const lines = commandLines(buildSpec(state, ctx));
  return lines[0]?.text ?? null;
}

/** Put the line on the clipboard. Resolves `{ ok, message }` — the line to say. */
export async function copyExportCommand({
  state = boundCopyState(),
  write = (text) => navigator.clipboard.writeText(text),
} = {}) {
  if (!state?.canvasFile) return { ok: false, message: COMMAND_WORDS.noCanvas };
  const text = exportCommandText(state);
  if (!text) return { ok: false, message: COMMAND_WORDS.unsafe };
  try {
    await write(text);
    return { ok: true, message: COMMAND_WORDS.copied, text };
  } catch {
    return { ok: false, message: COMMAND_WORDS.failed };
  }
}
