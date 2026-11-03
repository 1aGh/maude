// client/v2/assets/ds-library.js — the Assets tab's "Design system" source (2.0.2): a design system's own library,
// folder by folder, a page at a time.
//
// v1 let a person browse the design system's picked photo gallery from the left panel; v2's tab listed only the
// project's uploads. The tab's source switch (`sourcesOf`) now offers each design system too, and this file reads
// `GET /_api/ds/assets` (routes/ds-assets.ts) for one: the folders of the current one, its pictures by name, the next
// page when the person scrolls to the end, and a search below the folder.
//
// A row's `path` is the LITERAL reference a placement writes (`/<designRel>/system/<ds>/assets/…`,
// editing/ds-asset-ref.ts): the same string is the tile's picture URL, what a drag carries and what ↵ asks `image.place`
// for — one string, so what the tile shows is what the canvas gets. Pure parts first; the hook at the end.

import { useCallback, useEffect, useRef, useState } from 'react';
import { dsAssetSrc } from '../../../editing/ds-asset-ref.ts';

export const PROJECT_SOURCE = 'project';
const DS_PREFIX = 'ds:';
export const DS_PAGE = 200;

/** The tab's sources: this project's assets, then each design system the session sees. */
export function sourcesOf(designSystems) {
  const list = Array.isArray(designSystems) ? designSystems : [];
  const seen = new Set();
  const out = [{ id: PROJECT_SOURCE, label: 'This project' }];
  for (const d of list) {
    const name = typeof d?.name === 'string' ? d.name : '';
    if (!name || seen.has(name)) continue;
    seen.add(name);
    out.push({ id: `${DS_PREFIX}${name}`, label: name, ds: name });
  }
  return out;
}

/** The design system a source id names, or null (this project). */
export const dsOfSource = (id) =>
  typeof id === 'string' && id.startsWith(DS_PREFIX) ? id.slice(DS_PREFIX.length) || null : null;

/** The request for one page. */
export function dsLibraryUrl({ ds, dir = '', q = '', cursor = null, limit = DS_PAGE }) {
  const p = new URLSearchParams({ ds });
  if (dir) p.set('dir', dir);
  if (q.trim()) p.set('q', q.trim());
  if (cursor) p.set('cursor', cursor);
  p.set('limit', String(limit));
  return `/_api/ds/assets?${p.toString()}`;
}

/** A page's files → tile rows (the AssetTile shape), each with its literal reference as `path`. */
export function rowsFromDsPage(page, designRel) {
  const files = Array.isArray(page?.files) ? page.files : [];
  const out = [];
  for (const f of files) {
    if (!f || typeof f.path !== 'string') continue;
    const literal = dsAssetSrc(f.path, designRel);
    out.push({
      // a picture that cannot be a reference (a name with a quote, a sound) still shows — by its plain URL
      path: literal ?? `/${String(designRel).replace(/^\/+|\/+$/g, '')}/${f.path}`,
      rel: f.path,
      name: f.name || f.path.split('/').pop(),
      kind: f.kind || 'image',
      size: Number(f.size) || 0,
      mtimeMs: Number(f.mtimeMs) || 0,
      placeable: !!f.placeable && literal !== null,
      usedIn: null,
    });
  }
  return out;
}

/** The folders of a page, by name, relative to the library (what the breadcrumb and `dir=` take). */
export function dirsFromDsPage(page) {
  const root = typeof page?.root === 'string' ? page.root : '';
  return (Array.isArray(page?.dirs) ? page.dirs : [])
    .filter((d) => d && typeof d.path === 'string' && d.path.startsWith(`${root}/`))
    .map((d) => ({
      dir: d.path.slice(root.length + 1),
      name: d.name || d.path.split('/').pop(),
      count: Number(d.count) || 0,
    }));
}

/** "Alligators › photos-cut › 2024": each step and the dir it opens. */
export function crumbsOf(ds, dir) {
  const out = [{ label: ds, dir: '' }];
  const parts = String(dir || '')
    .split('/')
    .filter(Boolean);
  parts.forEach((p, i) => out.push({ label: p, dir: parts.slice(0, i + 1).join('/') }));
  return out;
}

/** "1 file" · "3007 files". */
export const filesWords = (n) => `${n} ${n === 1 ? 'file' : 'files'}`;

/** The state after one answer: a first page replaces, a next page appends (never twice the same row). */
export function mergeDsPage(state, page, designRel, { append = false } = {}) {
  const rows = rowsFromDsPage(page, designRel);
  if (!append)
    return {
      dirs: dirsFromDsPage(page),
      rows,
      total: Number(page?.total) || rows.length,
      next: page?.next ?? null,
    };
  const have = new Set(state.rows.map((r) => r.path));
  return {
    ...state,
    rows: [...state.rows, ...rows.filter((r) => !have.has(r.path))],
    total: Number(page?.total) || state.total,
    next: page?.next ?? null,
  };
}

const EMPTY = Object.freeze({ dirs: [], rows: [], total: 0, next: null });

/**
 * One design system's library at `dir`, searched by `q`.
 * @returns {{ state: {dirs, rows, total, next} | null, error: string, loading: boolean, loadMore: () => Promise<void> }}
 *   `state` is null until the first answer.
 */
export function useDsLibrary({ ds, dir, q, designRel, fetchImpl }) {
  const [state, setState] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const gen = useRef(0);
  const stateRef = useRef(state);
  stateRef.current = state;

  const read = useCallback(
    async (cursor) => {
      const my = gen.current;
      setLoading(true);
      try {
        const r = await fetchRef.current(dsLibraryUrl({ ds, dir, q, cursor }), {
          cache: 'no-store',
        });
        const j = await r.json().catch(() => null);
        if (my !== gen.current) return;
        if (!r.ok || !j?.ok) {
          setError(
            r.status === 404
              ? 'Nothing here. It may have moved; go back to the top.'
              : 'The library could not be read. Try again.'
          );
          if (!cursor) setState(EMPTY);
          return;
        }
        setError('');
        setState((s) => mergeDsPage(s ?? EMPTY, j, designRel, { append: !!cursor }));
      } catch {
        if (my === gen.current) setError('The studio could not be reached. Try again.');
      } finally {
        if (my === gen.current) setLoading(false);
      }
    },
    [ds, dir, q, designRel]
  );

  useEffect(() => {
    gen.current += 1;
    setState(null);
    setError('');
    if (ds) void read(null);
  }, [ds, read]);

  const loadMore = useCallback(async () => {
    const s = stateRef.current;
    if (!s?.next || loading) return;
    await read(s.next);
  }, [read, loading]);

  return { state, error, loading, loadMore };
}
