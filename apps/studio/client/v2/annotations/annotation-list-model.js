// client/v2/annotations/annotation-list-model.js — S4.17: Layers in Preview = the annotation list
// (canvas 15 · an-layers, "24 · Only Tereza's, and a locked sticky").
//
// In Preview the Layers tab lists the annotation layer instead of the design tree: "Annotations 24",
// person chips, rows grouped by section, and a foot saying what the filter is hiding. Pure and
// DOM-free so a test pins the counts. The filter HIDES — nothing here ever writes the board; the
// rows are derived from the elements on every call.
//
// WORDS (CONTRACT §3–§4): the title, the chips, the row words and the foot are canvas 15's.

/** Votes and ballots are metadata the board never draws (`caps.metadata`) — never a row, never counted. */
const METADATA_TYPES = new Set(['vote', 'ballot']);

export const LIST_TITLE = 'Annotations';
export const FOOT_PREFIX = 'Hidden by the filter: ';

/** The locked pill beside a locked selection, and the tooltip on a drag attempt (an-layers). */
export const LOCKED_TOOLBAR = Object.freeze({ label: 'Locked', action: 'Unlock', kbd: '⇧⌘L' });
export const LOCKED_DRAG_TIP = 'Locked — unlock to move it';

const EVERYONE = 'everyone';
const YOU = 'you';
const AI = 'ai';
const UNKNOWN = 'unknown';

/**
 * Who an author is, as a chip: the signed-in person is "You", an AI author is "AI", anybody else
 * keeps their name. `me` is `{ name?, id? }`; a name match wins (an id is a connection, not a person).
 * @returns {{ key: string, label: string }}
 */
export function personOf(author, me) {
  if (!author || typeof author !== 'object') return { key: UNKNOWN, label: 'Unattributed' };
  if (author.kind === 'ai') return { key: AI, label: 'AI' };
  const name = typeof author.name === 'string' && author.name ? author.name : '';
  const id = typeof author.id === 'string' && author.id ? author.id : '';
  if ((name && me?.name && name === me.name) || (id && me?.id && id === me.id)) {
    return { key: YOU, label: 'You' };
  }
  const who = name || id;
  return who ? { key: `h:${who}`, label: name || who } : { key: UNKNOWN, label: 'Unattributed' };
}

const SHAPE_WORDS = {
  rect: 'Rectangle',
  ellipse: 'Ellipse',
  diamond: 'Diamond',
  triangle: 'Triangle',
  'triangle-down': 'Triangle',
};

const oneLine = (s) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();

/** The words of one row. `byId` resolves a bound arrow end; `artboardLabel(id)` names an artboard. */
export function elementLabel(el, { byId, artboardLabel } = {}) {
  switch (el.type) {
    case 'sticky':
      return oneLine(el.text) || 'Empty sticky';
    case 'text':
      return oneLine(el.text) || 'Text';
    case 'shape':
      return SHAPE_WORDS[el.kind] || 'Shape';
    case 'stamp':
      return 'Stamp';
    case 'image':
      return 'Image';
    case 'link':
      return oneLine(el.title) || 'Link';
    case 'mediaref':
      return el.media === 'audio' ? 'Audio' : 'Video';
    case 'pen': {
      const word = el.highlighter ? 'Highlighter' : 'Marker';
      const ab = el.parentArtboard && artboardLabel ? artboardLabel(el.parentArtboard) : null;
      return ab ? `${word} on ${ab}` : word;
    }
    case 'arrow': {
      const host = el.endHost?.label;
      if (host) return `Arrow to ${host}`;
      const to = el.end?.el && byId ? byId.get(el.end.el) : null;
      if (to) return `Arrow to ${elementLabel(to, { byId, artboardLabel })}`;
      const from = el.startHost?.label;
      return from ? `Arrow from ${from}` : 'Arrow';
    }
    default:
      return 'Annotation';
  }
}

/** Board order: the fractional `index`, the array position breaking a tie. */
function inBoardOrder(els) {
  return els
    .map((el, i) => [el, i])
    .sort(([a, i], [b, j]) => {
      const x = String(a.index ?? '');
      const y = String(b.index ?? '');
      return x < y ? -1 : x > y ? 1 : i - j;
    })
    .map(([el]) => el);
}

/** Add or remove a person from the filter; "Everyone" (or the last person leaving) clears it. */
export function toggleFilter(filter, key) {
  if (key === EVERYONE) return [];
  const cur = Array.isArray(filter) ? filter : [];
  return cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key];
}

/**
 * @param {object[]} elements  the board's elements (annotations/types.ts `AnnotationElement`)
 * @param {object}   o
 * @param {string[]} [o.filter]        person keys; empty = Everyone
 * @param {{name?:string,id?:string}} [o.me]
 * @param {(id:string)=>string|null} [o.artboardLabel]
 * @param {Set<string>} [o.closed]     section ids whose twisty is closed (per user, never in the file)
 */
export function buildList(elements, { filter = [], me, artboardLabel, closed = new Set() } = {}) {
  const all = inBoardOrder(Array.isArray(elements) ? elements : []);
  const byId = new Map(all.map((el) => [el.id, el]));
  const sectionIds = new Set(all.filter((el) => el.type === 'section').map((el) => el.id));
  const on = new Set(filter);
  const passes = (key) => on.size === 0 || on.has(key);
  const ctx = { byId, artboardLabel };

  const people = new Map(); // key → label
  let total = 0;
  const hiddenBy = new Map(); // key → count
  const toRow = (el) => {
    const person = personOf(el.author, me);
    return {
      id: el.id,
      kind: el.type,
      label: elementLabel(el, ctx),
      color: el.type === 'sticky' && typeof el.fill === 'string' ? el.fill : null,
      locked: el.locked === true,
      resolved: el.type === 'sticky' && !!el.resolved,
      person,
    };
  };

  const items = all.filter((el) => !METADATA_TYPES.has(el.type));
  const rows = new Map(); // id → { row, visible }
  for (const el of items) {
    if (el.type === 'section') continue;
    const row = toRow(el);
    total += 1;
    people.set(row.person.key, row.person.label);
    const visible = passes(row.person.key);
    if (!visible) hiddenBy.set(row.person.key, (hiddenBy.get(row.person.key) ?? 0) + 1);
    rows.set(el.id, { row, visible });
  }

  const groups = [];
  const loose = [];
  const kids = new Map(); // section id → rows
  for (const el of items) {
    if (el.type === 'section') continue;
    const { row, visible } = rows.get(el.id);
    if (!visible) continue;
    if (el.parent && sectionIds.has(el.parent)) {
      if (!kids.has(el.parent)) kids.set(el.parent, []);
      kids.get(el.parent).push(row);
    } else loose.push(row);
  }
  const childTotal = new Map();
  for (const el of items) {
    if (el.type !== 'section' && el.parent && sectionIds.has(el.parent)) {
      childTotal.set(el.parent, (childTotal.get(el.parent) ?? 0) + 1);
    }
  }
  for (const el of items) {
    if (el.type !== 'section') continue;
    const own = kids.get(el.id) ?? [];
    // A section is its children's frame: it stays while one of them shows, or — when it holds none at
    // all — while its own author passes the filter.
    const empty = !childTotal.get(el.id);
    if (own.length === 0 && !(empty && passes(personOf(el.author, me).key))) continue;
    const open = !closed.has(el.id);
    groups.push({
      id: el.id,
      label: oneLine(el.label) || 'Section',
      color: typeof el.color === 'string' ? el.color : null,
      count: own.length,
      open,
      rows: open ? own : [],
    });
  }

  // Chips: Everyone · the others by name · You · AI (the last two always — they are who you ask for).
  const others = [...people.entries()]
    .filter(([k]) => k !== YOU && k !== AI && k !== UNKNOWN)
    .sort((a, b) => a[1].localeCompare(b[1]));
  const order = [
    ...others.map(([key, label]) => ({ key, label })),
    { key: YOU, label: 'You' },
    { key: AI, label: 'AI' },
    ...(people.has(UNKNOWN) ? [{ key: UNKNOWN, label: 'Unattributed' }] : []),
  ];
  const chips = [
    { key: EVERYONE, label: 'Everyone', on: on.size === 0 },
    ...order.map((c) => ({ ...c, on: on.has(c.key) })),
  ];

  const hiddenParts = order
    .filter((c) => (hiddenBy.get(c.key) ?? 0) > 0)
    .map((c) => `${c.label} ${hiddenBy.get(c.key)}`);
  const shown = [...rows.values()].filter((r) => r.visible).length;

  return {
    title: LIST_TITLE,
    total,
    shown,
    chips,
    groups,
    loose,
    foot: hiddenParts.length ? FOOT_PREFIX + hiddenParts.join(' · ') : null,
  };
}

/** The locked pill shows when everything selected is locked — a mixed selection offers Lock elsewhere. */
export function lockedToolbarFor(elements, selectedIds) {
  const ids = Array.isArray(selectedIds) ? selectedIds : [];
  if (ids.length === 0) return null;
  const byId = new Map((elements || []).map((el) => [el.id, el]));
  const sel = ids.map((id) => byId.get(id));
  return sel.every((el) => el && el.locked === true) ? LOCKED_TOOLBAR : null;
}

// The S4.9 shell → canvas messages (dgn `annotation-select {ids}`, `annotation-filter {authors}`). Both
// are built here so S4.9 changes one place if it renames a field. `authors` are person keys as
// `personOf` makes them ('you' | 'ai' | 'h:<name>'); an empty list is Everyone.
export const annotationSelectMessage = (ids) => ({ dgn: 'annotation-select', v: 1, ids: [...ids] });
export const annotationFilterMessage = (authors) => ({
  dgn: 'annotation-filter',
  v: 1,
  authors: [...authors],
});
