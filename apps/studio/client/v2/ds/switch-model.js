// client/v2/ds/switch-model.js — S10.14: the words and the arithmetic of "Switch canvases to …?" (13 · ds-multi-switch).
// Pure: no React, no fetch. The sheet draws it; the host fetches it.
//
// The server decides everything that matters (ds/switch.ts): which canvases can move, which keep their look and why,
// what `dsPairing` is written. This file reads the review, turns it into rows and ticks, and the ticks back into a
// request. Words follow CONTRACT §3–§4: the title asks with the verb the button repeats ("Switch canvases to
// Alligators brand?" → "Switch 5 canvases"), the other button is Cancel, a count names the noun for 1 and for many.

import { rowsOf } from './review-model.js';

export {
  defaultTicks,
  folderNote,
  groupByFolder,
  headWords,
  tickState,
  withTicks,
} from './review-model.js';

export const SWITCH_WORDS = Object.freeze({
  cancel: 'Cancel',
  fine: 'Version history keeps the old look.',
  scope: 'Scope',
  to: 'Switch to',
  thisCanvas: 'This canvas',
  wholeProject: 'Whole project',
  nothing: 'No canvas follows another system here — there is nothing to switch.',
  noOther: 'There is no other design system to switch to.',
  forbidden: 'Not switched. You can look here; ask to edit.',
  failed: 'Not switched. Nothing changed; try again.',
  offline: "No project home answers right now — switch when you're back online.",
  making: 'That system is still being made. Finish it, then switch.',
  level11: 'Made before the schema. Bring it up to the schema first, then switch.',
  noneTicked: 'Tick at least one canvas to switch.',
  restyleOff: 'Own tokens keep their look, marked off-system.',
});

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const canvasCount = (n) => plural(n, 'canvas', 'canvases');

/** "Switch canvases to Alligators brand?" */
export const switchTitle = (toLabel) => `Switch canvases to ${toLabel}?`;

/** The primary button: "Switch 5 canvases". */
export function primaryWords(n) {
  if (!Number.isInteger(n) || n <= 0) return 'Switch no canvases';
  return `Switch ${canvasCount(n)}`;
}

/** The scope segments: This canvas · Folder · 2026/combine · Whole project. A folder only when the canvas has one. */
export function scopeOptions({ canvas = null, folder = '' } = {}) {
  const out = [];
  if (canvas) out.push({ id: 'canvas', label: SWITCH_WORDS.thisCanvas });
  if (folder) out.push({ id: 'folder', label: `Folder · ${folder}` });
  out.push({ id: 'all', label: SWITCH_WORDS.wholeProject });
  return out;
}

/** The scope a sheet opens on: the canvas's folder when there is one, else the whole project. */
export const defaultScope = ({ folder = '' } = {}) => (folder ? 'folder' : 'all');

/** The request fields that name a scope (exactly one, as the route wants). */
export function scopeFields(kind, { canvas = null, folder = '' } = {}) {
  if (kind === 'canvas' && canvas) return { canvas };
  if (kind === 'folder' && folder) return { folder };
  return { all: true };
}

const BLOCK_WORDS = {
  pinned: 'Pinned — keeps its look',
  'ds-level-11': 'Made before the schema — keeps its look',
  'S9:meta': 'Follows no system yet — keeps its look',
  'S2:undefined': 'Uses a name no system has — keeps its look',
  'S2:foreign': 'Uses another system’s names — keeps its look',
  'S5:kit-module': 'Imports a system’s code — keeps its look',
  'S5:other-system': 'Imports another system — keeps its look',
  unreadable: 'Could not be read — keeps its look',
};
const blockWords = (reason) => BLOCK_WORDS[reason] ?? 'Blocked — keeps its look';

/** One row per canvas. A canvas that cannot move is locked and says why; the rest take the server's tick. */
export function switchRows(review, { fromOnly = null } = {}) {
  const rows = rowsOf(
    (review?.canvases ?? []).map((c) => ({
      path: c.path,
      folder: c.folder,
      // `rowsOf` locks a row that has a reason and is not `follows` / `left-out`
      state: c.ticked ? 'follows' : c.state,
      ticked: c.ticked === true,
      reason: c.ticked ? undefined : (c.reason ?? c.state),
    })),
    {}
  );
  return rows.map((r, i) => {
    const src = review.canvases[i];
    const off = !r.locked && fromOnly && src.from !== fromOnly;
    return {
      ...r,
      from: src.from ?? null,
      pins: src.pins ?? {},
      ticked: off ? false : r.ticked,
      reason: r.locked ? (src.reason ?? src.state) : null,
    };
  });
}

/** The quiet line under a row's name. */
export function rowNote(row, { fromLabel = null } = {}) {
  if (row.locked) return blockWords(row.reason);
  if (row.ticked) return fromLabel ? `Now in ${fromLabel}` : 'Switches';
  return 'Left out — keeps its system';
}

const KIND_WORDS = {
  display: 'display ramp',
  brand: 'brand colours',
  palette: 'illustration palette',
  chart: 'chart colours',
  texture: 'textures',
  device: 'devices',
  'signature-motion': 'signature motion',
  'accent-n': 'extra accents',
};
const joinWords = (xs) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;

/**
 * The line over the AI row: "Both follow the schema — core roles and components swap; the display ramp and
 * illustration palette pair by kind." Tone `ok`, or `warn` when a system is still missing roles.
 */
export function schemaLine(review) {
  const levels = Object.values(review?.levels ?? {});
  const fine = levels.every((l) => l === 0);
  const kinds = (review?.pairing?.kinds ?? []).map((k) => KIND_WORDS[k] ?? k);
  const tail = kinds.length
    ? `; the ${joinWords(kinds)} ${kinds.length === 1 ? 'pairs' : 'pair'} by kind.`
    : '.';
  return fine
    ? {
        tone: 'ok',
        text: `Both follow the schema — core roles and components swap${tail}`,
      }
    : {
        tone: 'warn',
        text: `A system here is missing some roles — what it lacks falls back to the standard look${tail}`,
      };
}

/**
 * What the AI would restyle among the ticked canvases: their own tokens (`--x-*`), the colours picked by hand outside
 * the system, local palettes and `ext.*` components — all counted from the server's `pins`.
 * @returns {{ tokens: string[], colours: number, palettes: number, exts: string[], any: boolean }}
 */
export function restyleSummary(rows) {
  const tokens = new Set();
  const exts = new Set();
  let colours = 0;
  let palettes = 0;
  for (const r of rows) {
    if (!r.ticked) continue;
    for (const [k, n] of Object.entries(r.pins ?? {})) {
      if (k.startsWith('own-token:')) tokens.add(k.slice('own-token:'.length));
      else if (k.startsWith('ext:')) exts.add(k.slice('ext:'.length));
      else if (k === 'literal-colour') colours += n;
      else if (k === 'local-palette') palettes += n;
    }
  }
  return {
    tokens: [...tokens].sort(),
    colours,
    palettes,
    exts: [...exts].sort(),
    any: tokens.size + exts.size + colours + palettes > 0,
  };
}

const nameOfToken = (t) => String(t).replace(/^--x-/, '').replace(/-/g, ' ');

/** The two lines of the AI row. `fromLabel`: the system the canvases leave. */
export function restyleWords(s, { fromLabel = null } = {}) {
  const own = s.tokens.length + s.exts.length;
  const title = own
    ? `AI restyles ${fromLabel ? `${fromLabel}’s` : 'the'} ${own} own ${own === 1 ? 'token' : 'tokens'}`
    : 'AI restyles the colours picked by hand';
  const names = [...s.tokens.map(nameOfToken), ...s.exts];
  const parts = [];
  if (names.length) parts.push(names.slice(0, 5).join(', ') + (names.length > 5 ? '…' : ''));
  if (s.colours)
    parts.push(
      `${s.colours} ${s.colours === 1 ? 'colour' : 'colours'} picked by hand outside the system`
    );
  if (s.palettes) parts.push(`${s.palettes} local ${s.palettes === 1 ? 'palette' : 'palettes'}`);
  parts.push('your Claude account', 'one undo step');
  return { title, sub: parts.join(' · ').replace(/ · (\d)/, ' · plus $1') };
}

/** The brief the restyle run starts from: a person's request, with the names the server reported. */
export function restyleBrief({ toLabel, rows }) {
  const moved = rows.filter((r) => r.ticked);
  const s = restyleSummary(moved);
  const lines = [
    `Switched ${canvasCount(moved.length)} to ${toLabel}. Restyle what is their own so it fits ${toLabel}, using its tokens and components, in one step that can be undone:`,
    ...moved.slice(0, 20).map((r) => `- ${r.path}`),
  ];
  if (moved.length > 20) lines.push(`- and ${moved.length - 20} more`);
  if (s.tokens.length) lines.push(`Own tokens: ${s.tokens.join(', ')}`);
  if (s.exts.length) lines.push(`Own components: ${s.exts.join(', ')}`);
  if (s.colours) lines.push(`${s.colours} colours picked by hand outside the system.`);
  return lines.join('\n');
}

/** The request body for `POST /_api/ds/switch`: the scope, the system, every row that can tick with its tick. */
export function switchBody({ to, scope, rows }) {
  return {
    to,
    ...scope,
    canvases: rows.filter((r) => !r.locked).map((r) => ({ path: r.path, ticked: r.ticked })),
  };
}

/** A refusal code → the person's words. */
export function refusalWords(code, fallback = SWITCH_WORDS.failed) {
  switch (code) {
    case 'ds-level-11':
      return SWITCH_WORDS.level11;
    case 'ds-kernel-unavailable':
      return SWITCH_WORDS.offline;
    case 'ds-making':
      return SWITCH_WORDS.making;
    case 'ds-nothing-to-switch':
      return SWITCH_WORDS.noneTicked;
    case 'forbidden':
      return SWITCH_WORDS.forbidden;
    default:
      return fallback;
  }
}

/** The toast after Switch. */
export function switchedWords(switched, kept, toLabel) {
  return kept > 0
    ? `Switched ${canvasCount(switched)} to ${toLabel}. ${kept} left out keep${kept === 1 ? 's' : ''} the old look.`
    : `Switched ${canvasCount(switched)} to ${toLabel}.`;
}
