// client/v2/export/annotations-policy.js — S4.20 (an-print): may this export carry the annotation layer?
//
// The client half of exporters/scope.ts `annotationsExportPolicy` (the server strips the layer either way;
// this is what the sheet SHOWS). Canvas 15 an-print / 09 Export: for a print file "Include annotations"
// stays unchecked and disabled, with the line "Print files never carry them — pick PDF for a review copy."
// A video, a ZIP or a deck can't carry it either, but they are not "print files", so they get the
// disabled box without that line.
//
// Pure: no React, no fetch.

import { PRINT_NEVER_NOTE } from './export-copy.js';

const TEMPORAL = new Set(['mp4', 'webm', 'gif', 'audio']);
const DECK = new Set(['pptx', 'canva']);

/**
 * @param {string} format  the sheet's picked format
 * @param {{ kinds?: Iterable<string>, print?: boolean }} [ctx]  the artboard kinds the estimate names
 * @returns {{ off: boolean, print: boolean, note: string|undefined }}
 *   `off` — the checkbox is disabled and unchecked; `print` — the reason is "a print file"; `note` — the
 *   line under the box (only for print).
 */
export function annotationsState(format, ctx = {}) {
  const kinds = new Set(ctx.kinds ?? []);
  const print = format === 'pdf' && (ctx.print === true || kinds.has('print'));
  const off = print || TEMPORAL.has(format) || format === 'zip' || DECK.has(format);
  return { off, print, note: print ? PRINT_NEVER_NOTE : undefined };
}
