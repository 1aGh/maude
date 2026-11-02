// client/v2/canvases/use-canvases-sort.js — S1.1: the Canvases panel's sort, remembered per project.
//
// Reads `canvasesSort[<project id>]` from `GET /_api/ui-prefs` once the project id is known (the index
// snapshot carries it) and writes the one project's entry back on every change. Before the id is known,
// or if the store cannot be reached, the panel still sorts — it just does not remember.

import { useCallback, useEffect, useRef, useState } from 'react';
import { DEFAULT_SORT, normaliseSort, readSortPref, sortPrefPatch } from './sort.js';

export function useCanvasesSort(projectId, { fetchImpl } = {}) {
  const [sort, setSortState] = useState({ ...DEFAULT_SORT });
  const fetchRef = useRef(fetchImpl || ((...a) => fetch(...a)));
  fetchRef.current = fetchImpl || fetchRef.current;
  const touched = useRef(null); // the project id the person changed the sort for in this page

  useEffect(() => {
    if (!projectId) return undefined;
    let cancelled = false;
    fetchRef
      .current('/_api/ui-prefs')
      .then((r) => (r.ok ? r.json() : null))
      .then((prefs) => {
        // a choice made while the read was in flight wins over the stored one
        if (!cancelled && touched.current !== projectId)
          setSortState(readSortPref(prefs, projectId));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const setSort = useCallback(
    (patch) => {
      setSortState((cur) => {
        const next = normaliseSort({ ...cur, ...patch });
        touched.current = projectId;
        const body = sortPrefPatch(projectId, next);
        if (body) {
          try {
            fetchRef
              .current('/_api/ui-prefs', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(body),
              })
              .catch(() => {});
          } catch {
            /* the sort still applies for this page */
          }
        }
        return next;
      });
    },
    [projectId]
  );

  return [sort, setSort];
}
