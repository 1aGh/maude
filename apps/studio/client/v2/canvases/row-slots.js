// client/v2/canvases/row-slots.js — T-S1a: the Canvases panel's row and foot slots (contract
// S1-canvas-row-slots.md).
//
// A tiny external store. Providers elsewhere (S9.21 access states and the trashed-while-open ghost row,
// S9.24 offline words, S5.13 "Needs you") publish WORDS into it; the panel subscribes with
// `useSyncExternalStore` and merges them with a FIXED precedence, so a provider never imports a panel
// component, never re-renders the panel per row, and never coordinates with another provider.
//
// Provider API (everything a provider needs):
//
//   registerRowSlot(source, path, slot) → dispose()   one canvas's words; dispose removes only that word
//   setRowSlots(source, Map<path, slot> | null)        a source's whole set at once (null clears it)
//   setFootSlot('sync' | 'access', { text, tone? } | null)
//   setGhostRows('trash', GhostRow[])                  canvases open in a tab but gone from the index
//   setGhostRows('sync', GhostRow[])                   S11.4: canvases listed by the hub, not on this Mac yet
//                                                      (slot `{ dim, arriving }` pulses, `{ dim, notLocal }`)
//
// `source` is 'ai' | 'sync' | 'access' | 'trash'; `path` is the canvas's designRoot-relative path
// ("ui/club-web/A.tsx" — the panel's `row.rel`). A RowSlot is
//   { meta?: { word, tone?: 'quiet' | 'warn' | 'azure', title? },   one short word at the row's right
//     sub?:  { text, icon?: 'trash' | 'eye' | 'comment' },            the words after the name
//     dim?:  boolean }                                                the row fades
//
// Precedence (the panel's merge, `resolveSlot` / `resolveFoot` below — pure, pinned by tests):
//   meta  ai > sync > access > trash       ("Needs you" > "not sent" / "sending"; one word per row)
//   sub   trash > access > sync > ai       (a search's own sub beats all of them — the panel decides)
//   dim   any source
//   foot  sync > arriving > jump > access > default   (the jump foot lives in tree-model.js `panelFootLine`)
//   ghost trash > sync                    (one row per path: a trashed canvas is not "arriving")
//
// The store holds no React and no DOM; `useRowSlots` is the one hook.

import { useSyncExternalStore } from 'react';

export const SLOT_SOURCES = Object.freeze(['ai', 'sync', 'access', 'trash']);
// S11.4 — `arriving` ("Getting <project> · 41 of 93 canvases") is its own foot: S9.24's offline foot is `sync`.
export const FOOT_SOURCES = Object.freeze(['sync', 'arriving', 'access']);
export const GHOST_SOURCES = Object.freeze(['trash', 'sync']);
const META_ORDER = Object.freeze(['ai', 'sync', 'access', 'trash']);
const SUB_ORDER = Object.freeze(['trash', 'access', 'sync', 'ai']);
const FOOT_ORDER = FOOT_SOURCES; // sync first

const need = (list, source, what) => {
  if (!list.includes(source)) throw new TypeError(`row-slots: unknown ${what} source "${source}"`);
};

/** A provider's slot, cleaned: a word without text is no word; a slot with nothing in it is no slot. */
function cleanSlot(slot) {
  if (!slot || typeof slot !== 'object') return null;
  const out = {};
  if (slot.meta && typeof slot.meta.word === 'string' && slot.meta.word)
    out.meta = { ...slot.meta };
  if (slot.sub && typeof slot.sub.text === 'string' && slot.sub.text) out.sub = { ...slot.sub };
  if (slot.dim === true) out.dim = true;
  return out.meta || out.sub || out.dim ? Object.freeze(out) : null;
}

const cleanFoot = (foot) =>
  foot && typeof foot.text === 'string' && foot.text ? Object.freeze({ ...foot }) : null;

// ── pure merges ─────────────────────────────────────────────────────────────────────────────────────

/**
 * One canvas's merged slot from `bySource` (`{ ai: Map, sync: Map, … }`), or null when no source has words
 * for it. `metaSource` / `subSource` name the winner (the panel prints them as `data-source`).
 */
export function resolveSlot(bySource, path) {
  let meta = null;
  let metaSource = null;
  for (const s of META_ORDER) {
    const m = bySource[s]?.get(path)?.meta;
    if (m) {
      meta = m;
      metaSource = s;
      break;
    }
  }
  let sub = null;
  let subSource = null;
  for (const s of SUB_ORDER) {
    const m = bySource[s]?.get(path)?.sub;
    if (m) {
      sub = m;
      subSource = s;
      break;
    }
  }
  let dim = false;
  for (const s of SLOT_SOURCES) if (bySource[s]?.get(path)?.dim) dim = true;
  if (!meta && !sub && !dim) return null;
  const out = {};
  if (meta) {
    out.meta = meta;
    out.metaSource = metaSource;
  }
  if (sub) {
    out.sub = sub;
    out.subSource = subSource;
  }
  if (dim) out.dim = true;
  return out;
}

/** The foot slot that wins between the two sources that can have one: `{ text, tone?, source }` or null. */
export function resolveFoot(foots) {
  for (const s of FOOT_ORDER) if (foots?.[s]) return { ...foots[s], source: s };
  return null;
}

// ── the store ───────────────────────────────────────────────────────────────────────────────────────

const empty = () => ({ ai: new Map(), sync: new Map(), access: new Map(), trash: new Map() });
let rows = empty();
let foots = { sync: null, arriving: null, access: null };
let ghosts = { trash: [], sync: [] };
const listeners = new Set();

function build() {
  const frozenRows = rows; // maps are replaced (never mutated) on every change: this snapshot stays valid
  const frozenFoots = foots;
  const trashed = new Set(ghosts.trash.map((g) => g.path));
  const ghostList = Object.freeze([
    ...ghosts.trash,
    ...ghosts.sync.filter((g) => !trashed.has(g.path)),
  ]);
  return Object.freeze({
    slotFor: (path) => resolveSlot(frozenRows, path),
    foot: resolveFoot(frozenFoots),
    foots: frozenFoots,
    ghosts: ghostList,
  });
}
let snapshot = build();

function publish() {
  snapshot = build();
  for (const fn of [...listeners]) fn();
}

/** The current merged view (a new object after every change, the same object between changes). */
export const getRowSlots = () => snapshot;

export function subscribeRowSlots(fn) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Replace a source's whole set of per-canvas words. `null` (or an empty map) clears the source. */
export function setRowSlots(source, slots) {
  need(SLOT_SOURCES, source, 'slot');
  const next = new Map();
  if (slots) {
    for (const [path, slot] of slots) {
      const c = cleanSlot(slot);
      if (c && typeof path === 'string' && path) next.set(path, c);
    }
  }
  if (!next.size && !rows[source].size) return; // nothing to clear: nobody needs waking
  rows = { ...rows, [source]: next };
  publish();
}

/**
 * Add one canvas's words from a source. Returns a disposer that removes them again — but only if they are
 * still the ones this call added (a newer word from the same source is never removed by an older disposer).
 */
export function registerRowSlot(source, path, slot) {
  need(SLOT_SOURCES, source, 'slot');
  const c = cleanSlot(slot);
  if (!c || typeof path !== 'string' || !path) return () => {};
  const next = new Map(rows[source]);
  next.set(path, c);
  rows = { ...rows, [source]: next };
  publish();
  return () => {
    if (rows[source].get(path) !== c) return;
    const after = new Map(rows[source]);
    after.delete(path);
    rows = { ...rows, [source]: after };
    publish();
  };
}

/** The panel's last line, from the source that owns it (`sync` offline foot, `access` canvas-only foot). */
export function setFootSlot(source, foot) {
  need(FOOT_SOURCES, source, 'foot');
  const next = cleanFoot(foot);
  if (!next && !foots[source]) return;
  foots = { ...foots, [source]: next };
  publish();
}

/**
 * Canvases that are open in a tab but not in the index any more (`trash`). The panel draws each at
 * `path` (repo path or designRoot-relative), not counted by its folder; `onOpen()` focuses the tab.
 */
export function setGhostRows(source, list) {
  need(GHOST_SOURCES, source, 'ghost');
  const next = (list || []).filter((g) => g && typeof g.path === 'string' && g.path);
  if (!next.length && !ghosts[source].length) return;
  ghosts = { ...ghosts, [source]: next };
  publish();
}

/** Forget everything (tests, and a project switch). */
export function resetRowSlots() {
  rows = empty();
  foots = { sync: null, arriving: null, access: null };
  ghosts = { trash: [], sync: [] };
  publish();
}

/** The panel's one hook: `{ slotFor(path), foot, foots, ghosts }`, re-read when any provider publishes. */
export function useRowSlots() {
  return useSyncExternalStore(subscribeRowSlots, getRowSlots, getRowSlots);
}
