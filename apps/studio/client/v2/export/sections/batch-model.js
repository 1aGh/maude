// client/v2/export/sections/batch-model.js — S8.3: many artboards at once, grouped by kind.
//
// Five artboards of two kinds, a folder of 31 canvases, the whole project: the server's estimate
// says which kinds the spec reaches (`byKind`), and each kind gets ITS OWN format row with its own
// default. A pick on one kind never touches another (09 ex-batch-pick: "Each group keeps its kind's
// default — change one and the other stays."). The picks live in the sheet state (`kindPicks`);
// this file turns them into the spec's `format` + `byKind`. PURE: no React, no fetch.

import { artboardsWord, countWord } from '../export-copy.js';

// ── kinds ────────────────────────────────────────────────────────────────────────────────────────
/** The order the groups are drawn in (09 ex-huge). Unknown kinds follow, in the order they came. */
export const KIND_ORDER = ['digital', 'web', 'print', 'video'];

/** `fixed` is the artboard kind a social post has; `digital` is what the estimate calls an unkinded one. */
const LABELS = {
  digital: 'Fixed size',
  fixed: 'Fixed size',
  web: 'Web page',
  print: 'Print',
  video: 'Video',
};
export const kindLabel = (kind) =>
  LABELS[kind] ?? `${String(kind).charAt(0).toUpperCase()}${String(kind).slice(1)}`;

/** Which family of choices a kind takes. */
const FAMILY = { fixed: 'digital' };
const familyOf = (kind) => FAMILY[kind] ?? kind;

// ── choices ──────────────────────────────────────────────────────────────────────────────────────
const png = (scale) => ({
  id: `png-${scale}`,
  label: `PNG · ${scale}×`,
  format: 'png',
  options: { size: { scale } },
});
const jpg = (scale) => ({
  id: `jpg-${scale}`,
  label: `JPG · ${scale}×`,
  format: 'jpg',
  options: { size: { scale } },
});
const PDF = { id: 'pdf', label: 'PDF', format: 'pdf' };
const SVG = { id: 'svg', label: 'SVG', format: 'svg' };
const PRINT_PDF = {
  id: 'print-pdf',
  label: 'Print PDF',
  format: 'pdf',
  options: { print: { bleed: true, marks: 'crop' } },
  note: 'Bleed + crop marks',
};

/** What each kind can be exported as, the default first. */
export const CHOICES = {
  digital: [png(1), png(2), jpg(1), jpg(2), SVG, PDF],
  web: [png(2), png(1), jpg(2), PDF],
  print: [PRINT_PDF, PDF, png(1), png(2)],
  video: [
    { id: 'mp4', label: 'MP4', format: 'mp4' },
    { id: 'gif', label: 'GIF', format: 'gif' },
    { id: 'webm', label: 'WebM', format: 'webm' },
    { id: 'audio', label: 'Sound only', format: 'audio' },
  ],
};

export const choicesFor = (kind) => CHOICES[familyOf(kind)] ?? CHOICES.digital;

/** The choice a kind has when nobody picked: the first of its list. */
export const defaultChoice = (kind) => choicesFor(kind)[0];

/** The choice for `kind` given the sheet's picks (`{ [kind]: choiceId }`); an unknown id falls back. */
export function choiceFor(kind, picks) {
  const id = picks?.[kind];
  return choicesFor(kind).find((c) => c.id === id) ?? defaultChoice(kind);
}

/** Kinds in drawing order. */
export function orderKinds(kinds) {
  const list = [...new Set(kinds)];
  const rank = (k) => {
    const i = KIND_ORDER.indexOf(familyOf(k));
    return i < 0 ? KIND_ORDER.length : i;
  };
  return list
    .map((k, i) => [k, i])
    .sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1])
    .map(([k]) => k);
}

// ── when the sheet is a batch ────────────────────────────────────────────────────────────────────
/** Formats a per-kind pick does not describe: the sheet is then one format for everything. */
const ONE_FORMAT = new Set(['svg', 'html', 'pptx', 'canva', 'zip']);

/**
 * Is the spec a batch: more than one kind, or a Folder / Whole project (those always sort by kind)?
 * A format picked under Other… that is not a per-kind pick (PowerPoint, ZIP …) is one format for all.
 */
export function isBatch(kinds, scope, format) {
  if (ONE_FORMAT.has(format)) return false;
  return kinds.length > 1 || (kinds.length > 0 && (scope === 'folder' || scope === 'project'));
}

/**
 * The spec's `format` (+ `byKind` + `options`) for the kinds the estimate says are reached. Two or more
 * kinds: every kind is written out (its own format and options), so a spec replays the same whatever
 * a kind's default becomes. One kind (a folder of social posts): nothing to sort, so the spec stays
 * flat — `format` and `options`, exactly what a single-format export sends.
 */
export function batchPart(picks, kinds) {
  const ordered = orderKinds(kinds);
  if (ordered.length === 0) return null;
  if (ordered.length === 1) {
    const c = choiceFor(ordered[0], picks);
    return { format: c.format, ...(c.options ? { options: structuredClone(c.options) } : {}) };
  }
  const byKind = {};
  let top = null;
  for (const kind of ordered) {
    const c = choiceFor(kind, picks);
    top ??= c;
    byKind[kind] = {
      format: c.format,
      ...(c.options ? { options: structuredClone(c.options) } : {}),
    };
  }
  return { format: top.format, byKind };
}

/**
 * "Other…" in a batch: a format that every kind can be made in lands on all of them; a kind that cannot
 * take it keeps its own pick. Returns the new picks, or null when no kind takes it (a deck, a ZIP …) —
 * the sheet then makes the whole export that one format.
 */
export function picksForOther(row, kinds, picks = {}) {
  if (ONE_FORMAT.has(row.format) && row.id !== 'svg') return null;
  const next = { ...picks };
  let any = false;
  for (const kind of kinds) {
    const hit =
      choicesFor(kind).find((c) => c.id === row.id) ??
      // Print PDF belongs to the print kind alone; every other row may land on a kind's plain choice
      (row.id === 'print-pdf'
        ? undefined
        : choicesFor(kind).find((c) => c.format === row.format && !c.options?.print));
    if (hit) {
      next[kind] = hit.id;
      any = true;
    }
  }
  return any ? next : null;
}

// ── words ────────────────────────────────────────────────────────────────────────────────────────
/** "Fixed size · 100 artboards" */
export const groupTitle = (kind, artboards) =>
  // 09 ex-huge: a print group counts PAGES ("Print · 46 pages") — a sheet of paper is a page of the PDF
  kind === 'print'
    ? `${kindLabel(kind)} · ${artboards} ${artboards === 1 ? 'page' : 'pages'}`
    : `${kindLabel(kind)} · ${artboardsWord(artboards)}`;

const list = (names) => {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

/**
 * The line that names what a Folder / Whole project left out, or null:
 * "_broadcast, _social and _video hold shared parts, not artboards — left out."
 */
export function sharedPartsLine(skipped) {
  const names = (skipped ?? []).filter((s) => s.reason === 'shared-part').map((s) => s.name);
  if (names.length === 0) return null;
  return `${list(names)} ${names.length === 1 ? 'holds' : 'hold'} shared parts, not artboards — left out.`;
}

/** The line for what a format could not take (a deck has no use for a video …), or null. */
export function formatSkipLine(skipped) {
  const names = (skipped ?? []).filter((s) => s.reason === 'format-unit').map((s) => s.name);
  if (names.length === 0) return null;
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  return `${list(more > 0 ? [...shown, `${more} more`] : shown)} can’t be made in the format picked — left out.`;
}

// ── a big export ─────────────────────────────────────────────────────────────────────────────────
/** Past this an export says it is big (09 ex-huge). Counted in files, size and time. */
export const BIG = { files: 200, bytes: 1_000_000_000, seconds: 180 };
export const isBig = (est) =>
  !!est && (est.files >= BIG.files || est.bytes >= BIG.bytes || est.seconds >= BIG.seconds);

/**
 * "A big export says it's big, then gets out of the way": how many files, and — when the videos go to
 * the cloud — that the window can close once this Mac's part is done. `summary` is the sheet's own
 * estimate sentence (counts, size, time), so the two never disagree.
 */
export function bigWords(est, { summary, hasVideo }) {
  if (!isBig(est)) return null;
  const head = `This is a big export — ${summary ?? `${countWord(est.files)} files`}.`;
  if (hasVideo && est.lane === 'cloud')
    return `${head} Once this Mac’s part is done you can close the window — the cloud finishes the videos.`;
  return `${head} Keep this window open until it is done.`;
}

export const PROJECT_ZIP_LINE =
  'Moving or backing up the project? A ZIP keeps the canvases, assets and the design system.';
export const PROJECT_ZIP_ACTION = 'Project ZIP instead';
export const OTHER_ROW = 'Other format';
/** 09 ex-huge: the row that lets a Whole project leave a folder, or the loose canvases, out. */
export const INCLUDE_ROW = 'Include';
export const allFoldersLabel = (n) => (n === 1 ? '1 folder' : `All ${n} folders`);
/** "test, Test2, ahoj, ahoj2" — the loose canvases' names, the first few. */
export const looseLabel = (names, total, max = 4) => {
  const head = names.slice(0, max).join(', ');
  return total > max ? `${head}…` : head;
};
/** The spec's `exclude` for the Include row's state (`{ folders, loose }`), or null when nothing is left out. */
export function excludeSpec(exclude) {
  const folders = (exclude?.folders ?? []).slice(0, 64);
  const loose = exclude?.loose === true;
  if (!folders.length && !loose) return null;
  return { ...(folders.length ? { folders } : {}), ...(loose ? { loose: true } : {}) };
}
export const WHERE_THIS_MAC = 'On this Mac';
export const WHERE_CLOUD = 'In the cloud';
