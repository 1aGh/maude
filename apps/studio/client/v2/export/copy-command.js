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

import { commandLines } from './advanced/command.js';
import { boundCopyState, copyTarget } from './copy-png.js';
import { buildSpec, initialState } from './use-export-spec.js';

export const COMMAND_WORDS = Object.freeze({
  copied: 'Copied the export command — paste it into a terminal.',
  noCanvas: 'Open a canvas first.',
  failed: 'Couldn’t copy the command.',
});

/** The terminal line for `{ selected, canvasFile, designRel }`, or null with no canvas open. */
export function exportCommandText({ selected, canvasFile, designRel }) {
  if (!canvasFile) return null;
  const t = copyTarget(selected);
  const ctx = {
    designRel,
    activePath: canvasFile,
    canvasOpen: true,
    artboards: t.ok && t.target.artboardId ? [t.target.artboardId] : [],
    elements: t.ok && t.target.elementIds ? t.target.elementIds : [],
  };
  const hasSelection = ctx.artboards.length + ctx.elements.length > 0;
  const state = initialState({ format: 'png' }, { hasSelection, canvasOpen: true });
  const lines = commandLines(buildSpec(state, ctx));
  return lines[0].text;
}

/** Put the line on the clipboard. Resolves `{ ok, message }` — the line to say. */
export async function copyExportCommand({
  state = boundCopyState(),
  write = (text) => navigator.clipboard.writeText(text),
} = {}) {
  const text = state ? exportCommandText(state) : null;
  if (!text) return { ok: false, message: COMMAND_WORDS.noCanvas };
  try {
    await write(text);
    return { ok: true, message: COMMAND_WORDS.copied, text };
  } catch {
    return { ok: false, message: COMMAND_WORDS.failed };
  }
}
