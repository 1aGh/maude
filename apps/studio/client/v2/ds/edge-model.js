// client/v2/ds/edge-model.js — S10.17: the words and the small decisions of the three edges (13 · ds-edge-contrast,
// ds-edge-trash, ds-edge-suggest). Pure: nothing here reads the page or the network. The numbers are the server's
// (ds/edges.ts judges again); this file only says them.

import { fixContrast } from '../../../ds/contrast.ts';
import { themeValues } from './contrast.js';

export const EDGE_WORDS = Object.freeze({
  show: 'Show',
  trash: 'Move to trash',
  trashOpen: 'Move to trash…',
  cancel: 'Cancel',
  close: 'Close',
  use: (name) => `Use ${name}`,
  add: 'Add it to the system',
  dismiss: 'Not now',
  fixed: 'Fixed. Update canvases to use it.',
  added: 'Added. Update canvases to use it.',
  used: 'Done. One undo puts the colour back.',
  moved: 'In the Trash. Restore puts it back everywhere.',
  forbidden: 'You can look here; ask to edit.',
  stale: 'The colour moved. Looking again.',
  unreachable: 'Not changed. The studio could not be reached; try again.',
  failed: 'Not changed; try again.',
  nothing: 'Nothing to change here.',
  tier1: 'This is one of the system’s main colours. It can’t go to the trash.',
  locked: 'This is a locked brand colour. It can’t go to the trash.',
  alone: 'Nothing else in the system could stand in for it.',
});

/** A refusal code from the routes → the person's words. */
export function edgeWords(code) {
  switch (code) {
    case 'forbidden':
      return EDGE_WORDS.forbidden;
    case 'ds-nothing-to-fix':
      return EDGE_WORDS.nothing;
    case 'ds-pending-conflict':
    case 'stale':
      return EDGE_WORDS.stale;
    case 'ds-token-locked':
      return EDGE_WORDS.locked;
    case 'ds-trash-tier1':
      return EDGE_WORDS.tier1;
    case 'unreachable':
      return EDGE_WORDS.unreachable;
    default:
      return EDGE_WORDS.failed;
  }
}

export const canvasesWords = (n) => (n === 1 ? '1 canvas' : `${n} canvases`);

/* ------------------------------------------------------------------ contrast */

/**
 * What the "Lighten to 4.5:1" button offers for a token whose contrast line failed: its label, the bar, and the modes
 * it fixes. null when nothing can be fixed by lightness alone (the person picks). `edited` is the value being tried.
 */
export function fixOffer(model, css, fails, edited = {}) {
  if (!model?.themes || !fails?.length) return null;
  const themes = [...new Set(fails.map((f) => f.theme))];
  const fixes = [];
  for (const theme of themes) {
    const f = fixContrast(css, themeValues(model, theme, { [css]: edited[theme] }));
    if (f) fixes.push({ theme, direction: f.direction, ratio: f.ratio });
  }
  if (!fixes.length) return null;
  const need = Math.max(...fails.map((f) => f.need));
  const dirs = new Set(fixes.map((f) => f.direction));
  const verb = dirs.size === 1 ? (dirs.has('lighten') ? 'Lighten' : 'Darken') : 'Fix';
  const bar = Number.isInteger(need) ? need : need.toFixed(1);
  return { label: `${verb} to ${bar}:1`, need, themes: fixes.map((f) => f.theme), fixes };
}

/** "Falls short in 3 canvases" — the canvases that use the token (the pair falls short wherever it is read). */
export function shortWords(used) {
  return typeof used === 'number' && used > 0 ? `Falls short in ${canvasesWords(used)}` : null;
}

/* --------------------------------------------------------------------- trash */

/**
 * The trash sheet's words from the server's answer (`GET /_api/ds/nearest?css=`):
 *   { title, lines: [string…], back, blocked: string | null, canGo: boolean, replacement }
 */
export function trashWords(q) {
  const name = q?.label ?? q?.css ?? 'this colour';
  const title = `Move “${name}” to the trash?`;
  if (!q) return { title, lines: [], blocked: EDGE_WORDS.failed, canGo: false };
  if (q.trashable === false)
    return {
      title,
      lines: [],
      blocked: q.reason === 'locked' ? EDGE_WORDS.locked : EDGE_WORDS.tier1,
      canGo: false,
    };
  const used = typeof q.used === 'number' ? q.used : null;
  const r = q.replacement;
  if (!r) return { title, lines: [], blocked: EDGE_WORDS.alone, canGo: false };
  const who =
    used === null
      ? 'Canvases that use it'
      : used === 0
        ? 'No canvas uses it'
        : `${canvasesWords(used)} ${used === 1 ? 'uses' : 'use'} it`;
  const follows =
    used === 0
      ? `If one does later, it follows ${r.label}, the closest colour, so nothing breaks.`
      : `${used === 1 ? 'It switches' : 'They switch'} to ${r.label}, the closest colour, so nothing breaks.`;
  const back =
    used === null || used === 0
      ? 'Restore from the Trash puts it back.'
      : `Restore from the Trash puts it back in ${used === 1 ? 'it' : `all ${used}`}.`;
  return {
    title,
    lines: [`${who}. ${follows}`],
    back,
    blocked: null,
    canGo: true,
    replacement: r,
  };
}

/* -------------------------------------------------------------- off-system */

/** The one quiet question for an off-system finding. */
export function offSystemWords(finding, systemLabel) {
  const n = finding?.nearest;
  const sys = systemLabel || 'the system';
  if (!n) return { text: `A colour picked by hand isn’t in ${sys}.`, canUse: false };
  if (n.exact)
    return {
      text: `This colour is ${n.label} in ${sys}, but it is written by hand.`,
      canUse: true,
      use: EDGE_WORDS.use(n.label),
    };
  return {
    text: `A colour picked by hand isn’t in ${sys}. The closest is ${n.label}.`,
    canUse: true,
    use: EDGE_WORDS.use(n.label),
  };
}

/** A finding's identity across polls: the same place says the same thing once. */
export const findingKey = (f) => `${f.file}:${f.line}:${f.col}:${f.literal}`;

/** The first finding the person has not put away, or null. */
export function nextFinding(findings, dismissed) {
  return (findings ?? []).find((f) => !dismissed.has(findingKey(f))) ?? null;
}
