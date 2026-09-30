// tree-expansion.js — which folders + sections of the Files panel are open
// (issue #124).
//
// Before this, every folder row owned its own `useState(defaultOpen=true)`:
// the tree started fully expanded and forgot every collapse the moment the row
// unmounted — a dock-tab switch, a section toggle, a reload. The state now
// lives ONCE at App level (so it outlives the rows) and is persisted per
// project through `/_api/tree-state` (so it outlives the app).
//
// Rule: anything not recorded is CLOSED — folders and sections alike. Nothing
// expands itself on boot; only the user does (a click, or explicitly opening a
// canvas, which reveals its row). Search force-opens without recording.
//
// The helpers below are pure (state in → state out) so they are unit-testable
// without a DOM; `useTreeExpansion` is the thin React wrapper App uses.

import { useCallback, useEffect, useRef, useState } from 'react';

export const EMPTY_TREE_STATE = Object.freeze({ dirs: [], sections: {} });

// Pre-#124 section overrides lived only in origin-scoped localStorage. Read
// once as a seed so an existing user's choices survive the move to disk.
export const LEGACY_SECTIONS_STORE = 'mdcc-sections-expanded';

const PERSIST_DEBOUNCE_MS = 250;
const HYDRATE_TIMEOUT_MS = 3000;

export function isDirOpen(state, dirPath) {
  return !!dirPath && state.dirs.includes(dirPath);
}

export function isSectionOpen(state, label) {
  return state.sections[label] === true;
}

export function setDirOpen(state, dirPath, open) {
  if (!dirPath) return state;
  const has = state.dirs.includes(dirPath);
  if (has === !!open) return state;
  const dirs = open ? [...state.dirs, dirPath].sort() : state.dirs.filter((d) => d !== dirPath);
  return { ...state, dirs };
}

export function toggleDir(state, dirPath) {
  return setDirOpen(state, dirPath, !isDirOpen(state, dirPath));
}

export function setSectionOpen(state, label, open) {
  if (!label || state.sections[label] === !!open) return state;
  return { ...state, sections: { ...state.sections, [label]: !!open } };
}

export function toggleSection(state, label) {
  return setSectionOpen(state, label, !isSectionOpen(state, label));
}

/** The group (section) a repo-relative path lives in — longest `fullPath` wins. */
export function groupForPath(groups, path) {
  let best = null;
  for (const g of groups || []) {
    const root = g.fullPath;
    if (!root || !(path === root || path.startsWith(root + '/'))) continue;
    if (!best || root.length > best.fullPath.length) best = g;
  }
  return best;
}

/**
 * Open everything needed to SEE `path`: its section, and every folder between
 * the section root and the path. `includeSelf` also opens `path` itself (for a
 * folder target — a new folder's parent, a move destination).
 */
export function revealPath(state, groups, path, { includeSelf = false } = {}) {
  if (!path) return state;
  const g = groupForPath(groups, path);
  if (!g) return state;
  let next = setSectionOpen(state, g.label, true);
  const rest = path.slice(g.fullPath.length + 1);
  if (!rest) return next;
  const parts = rest.split('/');
  const upto = includeSelf ? parts.length : parts.length - 1;
  let cur = g.fullPath;
  for (let i = 0; i < upto; i++) {
    cur = `${cur}/${parts[i]}`;
    next = setDirOpen(next, cur, true);
  }
  return next;
}

/** A folder moved/renamed `from` → `to`: carry its (and its subfolders') keys. */
export function remapDirPrefix(state, from, to) {
  if (!from || !to || from === to) return state;
  let changed = false;
  const dirs = state.dirs.map((d) => {
    if (d === from) {
      changed = true;
      return to;
    }
    if (d.startsWith(from + '/')) {
      changed = true;
      return to + d.slice(from.length);
    }
    return d;
  });
  return changed ? { ...state, dirs: [...new Set(dirs)].sort() } : state;
}

/** Every folder path present in the loaded groups' trees. */
export function collectDirPaths(groups) {
  const out = new Set();
  const walk = (node, base) => {
    for (const k of Object.keys(node || {})) {
      if (k === '_files') continue;
      const p = `${base}/${k}`;
      out.add(p);
      walk(node[k], p);
    }
  };
  for (const g of groups || []) if (g.fullPath) walk(g.tree, g.fullPath);
  return out;
}

/** Drop keys for folders that no longer exist (deleted, moved outside Maude). */
export function pruneDirs(state, known) {
  const dirs = state.dirs.filter((d) => known.has(d));
  return dirs.length === state.dirs.length ? state : { ...state, dirs };
}

export function normalizeClientState(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const dirs = Array.isArray(o.dirs) ? [...new Set(o.dirs.filter((d) => typeof d === 'string' && d))].sort() : [];
  const sections = {};
  if (o.sections && typeof o.sections === 'object' && !Array.isArray(o.sections)) {
    for (const [k, v] of Object.entries(o.sections)) if (typeof v === 'boolean') sections[k] = v;
  }
  return { dirs, sections };
}

function readLegacySections() {
  try {
    const v = JSON.parse(localStorage.getItem(LEGACY_SECTIONS_STORE) || 'null');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * App-level owner of the tree state. `ready` flips once the stored state has
 * been read (or the read failed) — App holds the tree back until then so the
 * first paint is the remembered tree, not an all-closed flash. Writes are
 * debounced and only start after hydration, so the initial empty state can
 * never overwrite what is on disk.
 */
export function useTreeExpansion({ fetchImpl } = {}) {
  const [state, setState] = useState(EMPTY_TREE_STATE);
  const [ready, setReady] = useState(false);
  const doFetch = fetchImpl || ((...a) => fetch(...a));
  const fetchRef = useRef(doFetch);
  fetchRef.current = doFetch;

  useEffect(() => {
    let cancelled = false;
    // A stalled read (cell cold start, a hung proxy) must not keep the Files
    // panel empty: after HYDRATE_TIMEOUT_MS the tree renders all-closed.
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl?.abort(), HYDRATE_TIMEOUT_MS);
    fetchRef
      .current('/_api/tree-state', ctrl ? { signal: ctrl.signal } : undefined)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((raw) => {
        if (cancelled) return;
        let next = normalizeClientState(raw);
        const stored = raw && typeof raw === 'object' && raw.sections && Object.keys(raw.sections).length;
        if (!stored) {
          const legacy = readLegacySections();
          if (legacy) next = normalizeClientState({ ...next, sections: legacy });
        }
        setState(next);
      })
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        if (!cancelled) setReady(true);
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  const skipFirst = useRef(true);
  useEffect(() => {
    if (!ready) return;
    // The hydrating setState lands in the same commit as `ready`; that value
    // came FROM disk, so writing it back is pointless.
    if (skipFirst.current) {
      skipFirst.current = false;
      return;
    }
    const t = setTimeout(() => {
      try {
        fetchRef
          .current('/_api/tree-state', {
            method: 'POST',
            headers: { 'content-type': 'text/plain' },
            body: JSON.stringify(state),
          })
          .catch(() => {});
      } catch {}
    }, PERSIST_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [ready, state]);

  const update = useCallback((fn) => setState((s) => fn(s)), []);
  return { state, ready, update };
}
