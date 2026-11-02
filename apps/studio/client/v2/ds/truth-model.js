// client/v2/ds/truth-model.js — S10.11: the words and the arithmetic of the two "source of truth" cards
// (13 · ds-truth-outside, ds-truth-conflict; V2-1.6 §5.10, §5.11 a/b/§5.7). Pure: no React, no fetch.
//
//   outside   "2 tokens changed outside the app" — colors_and_type.css was edited by Claude Code, 4 min ago.
//             Each token shows its new value, marked, until the person Keeps it or Undoes it.
//   conflict  "Accent changed in two places" — the canvas and the file changed the same token; both are
//             kept side by side until one is picked. Canvases keep head meanwhile.
//   twice     "Published in two places" — two Macs published from one head; a pick between two heads.
//
// The server decides everything (routes/ds.ts, GET /_api/ds/state): which files, which tokens, who. This file
// turns that into words (CONTRACT §3 and §4) and into the marks the Design system canvas draws on a swatch.
// Names that arrive (a git author, a peer, a person) are data: shown, never obeyed (DDR-172 D8).

import { agoWords } from './update-model.js';

export const TRUTH_WORDS = Object.freeze({
  keep: 'Keep',
  undo: 'Undo',
  useThis: 'Use this',
  keepFine: 'Keep makes them part of the system. Canvases then follow after the usual review.',
  keepHeld: (names) => `Pick ${names} first, then Keep the rest.`,
  conflictFine:
    'Both stay on the swatch, marked “2 versions”. The one you don’t pick stays in Version history.',
  twiceTitle: 'Published in two places',
  twiceLead:
    'Two Macs updated the system at once. Pick one — nothing is lost, the other stays in Version history.',
  viewOnly: 'Linked library — view only. Undo puts the library’s values back.',
  kept: (n) =>
    `Kept ${n === 1 ? '1 token' : `${n} tokens`}. Canvases follow after the next update.`,
  keptOther: 'Kept. Canvases follow after the next update.',
  undone: (file) => `Old values are back${file ? ` in ${file}` : ''}.`,
  picked: (name, use) =>
    use === 'canvas'
      ? `${name}: the canvas value is in the file now.`
      : `${name}: the file value stays; the canvas value is dropped.`,
  pickedTwice: 'Picked. Both versions stay in Version history.',
  failed: 'Nothing changed; try again.',
  forbidden: 'Not changed. You can look here; ask to edit.',
  offline: "No project home answers right now — try again when you're back online.",
  gone: 'That already changed — the card shows what is there now.',
});

const MAX_FILES = 3;
const MAX_ROWS = 6;
const REV_ID = /^[0-9a-f]{64}$/;

const fileOf = (p) => String(p ?? '').replace(/^.*\//, '');

/** A person's name, or a fallback — a name from a git author or a peer is plain text. */
const nameOf = (source) =>
  typeof source?.name === 'string' && source.name.trim() ? source.name.trim().slice(0, 64) : null;

/** How a file came to differ — "edited by Claude Code", "changed by Jonas · git pull", "came from Tereza’s Mac". */
export function sourceWords(source) {
  const name = nameOf(source);
  switch (source?.kind) {
    case 'agent':
      return `edited by ${name ?? 'Claude Code'}`;
    case 'git':
      return name ? `changed by ${name} · git pull` : 'changed by a git pull';
    case 'peer':
      return name ? `came from ${name}’s Mac` : 'came from another Mac';
    default:
      return 'changed outside the app';
  }
}

/** Who, without the verb — the right-hand side of the conflict card: "Jonas · git pull", "Claude Code". */
export function whoWords(source) {
  const name = nameOf(source);
  switch (source?.kind) {
    case 'agent':
      return name ?? 'Claude Code';
    case 'git':
      return name ? `${name} · git pull` : 'git pull';
    case 'peer':
      return name ? `${name}’s Mac` : 'another Mac';
    case 'person':
      return name ?? 'You';
    default:
      return name ?? 'Outside the app';
  }
}

/** "colors_and_type.css was edited by Claude Code, 4 min ago" as parts the card can bold. */
export function fileLines(files = [], now = Date.now()) {
  const list = Array.isArray(files) ? files : [];
  const lines = list.slice(0, MAX_FILES).map((f) => {
    const ago = agoWords(f?.at, now);
    return { file: fileOf(f?.path), how: sourceWords(f?.source), ago };
  });
  const more = Math.max(0, list.length - MAX_FILES);
  return { lines, more };
}

const themeKeys = (...maps) => [
  ...new Set(maps.flatMap((m) => (m && typeof m === 'object' ? Object.keys(m) : []))),
];

/** First value of a theme map: the light one, else whichever there is. */
export const firstValue = (m) =>
  !m || typeof m !== 'object' ? null : (m.light ?? Object.values(m)[0] ?? null);

/**
 * The themes whose value moved, in the person's words: "Light value", "Dark value", "Light and Dark values".
 * @param {{ before: Record<string,string>|null, after: Record<string,string>|null }} change
 */
export function movedWords(change, themes = { light: 'light', dark: 'dark' }) {
  const keys = themeKeys(change?.before, change?.after).filter(
    (t) => (change?.before?.[t] ?? null) !== (change?.after?.[t] ?? null)
  );
  if (!keys.length) return null;
  const word = (t) => (t === themes.dark ? 'Dark' : t === themes.light ? 'Light' : t);
  const names = keys.map(word);
  return names.length === 1 ? `${names[0]} value` : `${names.join(' and ')} values`;
}

/** A value that is safe to paint as a chip: a plain colour, never a `url()` or anything that can load. */
const COLOUR =
  /^(?:#[0-9a-f]{3,8}|(?:oklch|oklab|rgb|rgba|hsl|hsla|lab|lch|color|color-mix)\([^;{}]*\)|[a-z]{3,20})$/i;
export const safeColour = (v) =>
  typeof v === 'string' && !/url\s*\(/i.test(v) && COLOUR.test(v.trim()) ? v.trim() : null;

/** "10px" → 10 when both sides are px lengths; the card draws the corner as it was and as it is. */
export function pxOf(v) {
  const m = /^\s*(-?\d+(?:\.\d+)?)px\s*$/i.exec(typeof v === 'string' ? v : '');
  return m ? Number(m[1]) : null;
}

/**
 * The rows of the outside card: one per changed token that is not in a conflict (those have their own card).
 * `detail` is the quiet line under a row; the host adds the contrast line for a colour when it has one.
 */
export function outsideRows(outside, conflictCss = new Set(), themes) {
  const changes = Array.isArray(outside?.changes) ? outside.changes : [];
  const rows = changes
    .filter((c) => typeof c?.css === 'string' && !conflictCss.has(c.css))
    .map((c) => {
      const before = firstValue(c.before);
      const after = firstValue(c.after);
      const bc = safeColour(before);
      const ac = safeColour(after);
      const bpx = pxOf(before);
      const apx = pxOf(after);
      const moved = movedWords(c, themes);
      const trashed = c.trashed && typeof c.trashed === 'object' ? c.trashed : null;
      const detail = trashed
        ? 'Moved out of the system'
        : bpx !== null && apx !== null
          ? `${bpx} → ${apx} px`
          : bc || ac
            ? moved
            : before == null
              ? 'New'
              : after == null
                ? 'Removed'
                : `${before} → ${after}`;
      return {
        css: c.css,
        label: typeof c.label === 'string' && c.label ? c.label : c.css.replace(/^--/, ''),
        before,
        after,
        kind: bc || ac ? 'colour' : bpx !== null && apx !== null ? 'length' : 'text',
        bpx,
        apx,
        detail,
      };
    });
  return { shown: rows.slice(0, MAX_ROWS), more: Math.max(0, rows.length - MAX_ROWS), all: rows };
}

/** "2 tokens changed outside the app" — and, when only comments or new rules moved, "Files changed outside the app". */
export function outsideTitle(nTokens, nOther) {
  if (nTokens > 0)
    return `${nTokens === 1 ? '1 token' : `${nTokens} tokens`} changed outside the app`;
  return nOther > 0 ? 'Files changed outside the app' : 'Changed outside the app';
}

/** Changes that moved no token (a comment, a new rule) are never silent. */
export function otherWords(otherChanges = []) {
  const list = Array.isArray(otherChanges) ? otherChanges : [];
  if (!list.length) return null;
  const n = list.reduce((s, o) => s + (Number.isFinite(o?.count) ? o.count : 1), 0);
  const where = [...new Set(list.map((o) => fileOf(o?.path)).filter(Boolean))]
    .slice(0, 2)
    .join(', ');
  return `${n === 1 ? '1 other change' : `${n} other changes`}${where ? ` in ${where}` : ''} — comments or new rules`;
}

/** The value name a revision's tokens.json gives a token in one theme ("Azure"), or null. */
export function headValueName(body, css, theme) {
  const f = body?.files?.['tokens.json'];
  if (!f || typeof f.text !== 'string') return null;
  let doc;
  try {
    doc = JSON.parse(f.text);
  } catch {
    return null;
  }
  let found = null;
  const walk = (n, depth) => {
    if (found !== null || !n || typeof n !== 'object' || depth > 12) return;
    const ext = n.$extensions?.['sh.maude'];
    if (ext && ext.css === css) {
      const v = ext.valueNames?.[theme];
      found = typeof v === 'string' && v ? v.slice(0, 64) : '';
      return;
    }
    for (const k of Object.keys(n)) if (!k.startsWith('$')) walk(n[k], depth + 1);
  };
  walk(doc, 0);
  return found || null;
}

/**
 * The conflict cards. Left: the value on this canvas (the waiting edit, with the person's name for the colour and
 * who/when). Right: the value in the file (with who changed it, from the outside review's files).
 * @returns {Array<{ css, label, canvas: {value, name, who, ago}, file: {value, name, who, ago}, keeps: string|null }>}
 */
export function conflictCards({
  conflicts,
  pending,
  outside,
  board,
  headNames = {},
  themes,
  now = Date.now(),
}) {
  const light = themes?.light ?? 'light';
  const files = Array.isArray(outside?.files) ? outside.files : [];
  // the token files carry the change; any file that moved can name the person
  const src = files.find((f) => /\.css$/.test(String(f?.path))) ?? files[0] ?? null;
  return (Array.isArray(conflicts) ? conflicts : [])
    .filter((c) => typeof c?.css === 'string')
    .map((c) => {
      const entry = pending?.tokens?.[c.css] ?? {};
      const tok = (board?.tokens ?? []).find((t) => t.css === c.css) ?? null;
      const mine = firstValue(c.canvas);
      const theirs = firstValue(c.file);
      return {
        css: c.css,
        label: typeof c.label === 'string' && c.label ? c.label : c.css.replace(/^--/, ''),
        canvas: {
          value: mine,
          name: entry.valueNames?.[light] ?? null,
          who: whoWords(entry.by ?? { kind: 'person' }),
          ago: agoWords(entry.at, now),
        },
        file: {
          value: theirs,
          name: tok?.valueNames?.[light] ?? null,
          who: whoWords(src?.source),
          ago: agoWords(src?.at, now),
        },
        keeps: headNames[c.css] ?? null,
      };
    });
}

/**
 * What the card pair needs from one system's `GET /_api/ds/state` row, or null when there is nothing to say.
 * `marks` are the design-token names the Design system canvas flags on its swatches.
 */
export function truthOf(row) {
  if (row?.converted !== true) return null;
  const outside = row.outside && typeof row.outside === 'object' ? row.outside : null;
  const conflicts = Array.isArray(row.conflicts) ? row.conflicts : [];
  const twice = Array.isArray(row.publishedInTwoPlaces) ? row.publishedInTwoPlaces : null;
  if (!outside && !conflicts.length && !twice) return null;
  const conflictCss = new Set(conflicts.map((c) => c?.css).filter((x) => typeof x === 'string'));
  const changes = Array.isArray(outside?.changes) ? outside.changes : [];
  return {
    outside,
    conflicts,
    twice,
    linked: !!row.library,
    head: typeof row.head === 'string' && REV_ID.test(row.head) ? row.head : null,
    pending: row.pending ?? {},
    marks: {
      outside: changes
        .map((c) => c?.css)
        .filter((css) => typeof css === 'string' && !conflictCss.has(css)),
      conflicts: [...conflictCss],
    },
  };
}

/** Refusal code → the person's words. */
export function refusalWords(code) {
  switch (code) {
    case 'forbidden':
      return TRUTH_WORDS.forbidden;
    case 'unreachable':
    case 'ds-kernel-unavailable':
      return TRUTH_WORDS.offline;
    case 'ds-no-outside':
    case 'ds-no-conflict':
      return TRUTH_WORDS.gone;
    case 'ds-conflict':
      return 'Pick one of the two values first.';
    default:
      return TRUTH_WORDS.failed;
  }
}

/** Is `rel` the system's OWN Design system canvas (`<ds.path>/design-system.tsx`)? → the system name, else null. */
export function ownSystemOf(file, cfg) {
  if (typeof file !== 'string' || !file) return null;
  const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  const rel = file.startsWith(`${designRel}/`) ? file.slice(designRel.length + 1) : file;
  const own = (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).find(
    (d) => typeof d?.path === 'string' && rel === `${d.path.replace(/\/+$/, '')}/design-system.tsx`
  );
  return own && cfg?.dsConverted?.[own.name] === true ? own.name : null;
}
