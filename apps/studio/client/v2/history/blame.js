// client/v2/history/blame.js — S1.15: Compare's words (11 · pn-compare, V2-1.9 §5.7).
//
//   groupByArtboard(changes, labels)   the server's lines → [{ id, label, lines: [{ index, change }] }]
//   summaryLine(groups, total)         "4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku"
//   makerOf(index, blame, rows)        who made line `index`: the row the server named, else null ("no face")
//   makerWords(maker)                  "Made by AI, 14:32" · "You, 14:05" · "Tereza, 11:20"
//   whyLine(groups, blame, rows)       what "Restore this version" takes back from others
//   restoreOnlyTarget(group)           the artboard "Restore only …" can put back, or null
//
// The server derives the lines AND the blame (`GET /_api/project/changes`, history/changes.ts: the newest row
// in (A, B] whose own description has a change with the same key — artboard + element + kind + property).
// `blame` maps a line's index to that row's id; a line with no entry was changed in between by something that
// has no row of its own — it shows no face. This file only names the row from the list the panel already holds.
// Pure: no DOM, no clock.

/** Every sentence Compare says (CONTRACT §3–§4: no "we", what happened · what is safe · one verb). */
export const COMPARE_WORDS = Object.freeze({
  stop: 'Stop comparing',
  restore: 'Restore this version',
  restoring: 'Restoring…',
  sideBySide: 'Side by side',
  overlay: 'Overlay',
  wipe: 'Slide to compare',
  now: 'Now',
  none: 'No changes between A and B.',
  loading: 'Reading the changes…',
  failed: "Couldn't read the changes",
  failedNote: 'Your work is safe.',
  retry: 'Retry changes',
  legacy: 'Changes between versions need the team server to be updated.',
  inBetween: 'changed in between',
  canvas: 'this canvas',
  aiMade: 'Made by AI',
  restoreOnly: (label) => `Restore only ${label}`,
  frameA: 'Version A',
  frameB: 'Version B',
  expand: (n) => `Show ${n} changes`,
  collapse: 'Hide changes',
});

const pad = (n) => String(n).padStart(2, '0');
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** An artboard key in words when the server sent no label: `front-view` → "Front view". */
export function keyInWords(key) {
  const s = String(key ?? '')
    .replace(/\*/g, ' ')
    .replace(/[-_]+/g, ' ')
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : COMPARE_WORDS.canvas;
}

/**
 * The server's lines grouped by the artboard they are about, in the order first met. A line about no artboard
 * (canvas-level) is the group `id: ''`; a line that spans artboards belongs to its first. `index` is the
 * line's place in the server's list — the key `blame` uses.
 * @param changes  `Change[]` ({ artboards, kind, words, … })
 * @param labels   artboard key → name in words (the answer's `labels`)
 */
export function groupByArtboard(changes, labels = {}) {
  const out = [];
  const at = new Map();
  (changes ?? []).forEach((change, index) => {
    const id = change.artboards?.[0] ?? '';
    let g = at.get(id);
    if (!g) {
      g = { id, label: id ? (labels[id] ?? keyInWords(id)) : COMPARE_WORDS.canvas, lines: [] };
      at.set(id, g);
      out.push(g);
    }
    g.lines.push({ index, change });
  });
  return out;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** "4 changes between A and B — 3 on Venkovní dres · přední, 1 on Helma z boku". */
export function summaryLine(groups, total) {
  const n = total ?? groups.reduce((s, g) => s + g.lines.length, 0);
  if (!n) return COMPARE_WORDS.none;
  const parts = groups.map((g) => `${g.lines.length} on ${g.label}`);
  return `${plural(n, 'change', 'changes')} between A and B — ${parts.join(', ')}`;
}

/**
 * Who made line `index`: the row `blame[index]` names, from the rows the panel holds.
 * @returns { kind: 'ai'|'person'|'outside', name, you, madeAt, row } | null  (null = changed in between)
 */
export function makerOf(index, blame, rows) {
  const id = blame?.[index];
  if (!id) return null;
  const row = (rows ?? []).find((r) => r.id === id);
  if (!row) return null;
  const w = row.who ?? {};
  if (w.kind === 'outside') return null; // changed outside Maude: no face to put on it
  return {
    kind: w.kind === 'ai' ? 'ai' : 'person',
    name: w.kind === 'ai' ? 'AI' : (w.name ?? ''),
    you: !!w.you,
    madeAt: row.madeAt,
    row,
  };
}

/** "Made by AI, 14:32" · "You, 14:05" · "Tereza, 11:20"; "changed in between" when nobody is named. */
export function makerWords(maker) {
  if (!maker) return COMPARE_WORDS.inBetween;
  const who = maker.kind === 'ai' ? COMPARE_WORDS.aiMade : maker.you ? 'You' : maker.name;
  return maker.madeAt != null ? `${who}, ${hhmm(maker.madeAt)}` : who;
}

const possessive = (name) => `${name}’s`;
const list = (xs) =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`;

/**
 * "Restores the whole canvas as it was at A, as a new version — Tereza’s change to Helma z boku goes too.
 * Now stays in the list." Names the other people whose lines the restore takes back (never you, never AI you
 * asked, never a line nobody made).
 */
export function whyLine(groups, blame, rows) {
  const by = new Map(); // name → Set of artboard labels
  const count = new Map();
  for (const g of groups)
    for (const { index } of g.lines) {
      const m = makerOf(index, blame, rows);
      if (!m || m.kind !== 'person' || m.you) continue;
      if (!by.has(m.name)) by.set(m.name, new Set());
      by.get(m.name).add(g.label);
      count.set(m.name, (count.get(m.name) ?? 0) + 1);
    }
  const base = 'Restores the whole canvas as it was at A, as a new version';
  const tail = 'Now stays in the list.';
  if (!by.size) return `${base}. ${tail}`;
  const parts = [...by].map(
    ([name, labels]) =>
      `${possessive(name)} ${count.get(name) === 1 ? 'change' : 'changes'} to ${list([...labels])}`
  );
  const single = parts.length === 1 && count.get([...by.keys()][0]) === 1;
  return `${base} — ${list(parts)} ${single ? 'goes' : 'go'} too. ${tail}`;
}

/**
 * The artboard "Restore only <label>" can put back: a real artboard (not canvas-level, not a family of
 * generated ones) that A holds — an `artboard-added` line means A has none to put back.
 * @returns { id, label } | null
 */
export function restoreOnlyTarget(group) {
  if (!group?.id || group.id.includes('*') || group.id.startsWith('#')) return null;
  if (group.lines.some((l) => l.change.kind === 'artboard-added')) return null;
  return { id: group.id, label: group.label };
}

/** The group a focus id names, else the first group that has an artboard (what Compare frames first). */
export function focusGroup(groups, focus) {
  return groups.find((g) => g.id && g.id === focus) ?? groups.find((g) => g.id) ?? null;
}
