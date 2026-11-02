// client/v2/ds/use-covers.js — p8 c7 (13 · ds-edit-review / -master / ds-multi-switch): the sheets' rows wear the
// canvas's own picture, not a grey box. The Canvases panel already knows each canvas's cover (the index row's
// `cover.key`, served at `/_api/thumb/<key>`); this reads the same index and asks the thumbnail service for the
// pictures once per page load (covers.js), so a sheet opened first still gets them as they finish.

import { useCallback, useEffect } from 'react';
import { askForCovers } from '../canvases/covers.js';
import { useCanvasIndex } from '../canvases/use-canvas-index.js';

/** The cover URL of the canvas at `path` (design-root relative, or ending in an index `rel`), or null. */
export function coverUrlOf(index, path) {
  if (typeof path !== 'string' || !path) return null;
  const hit = (index?.canvases ?? []).find(
    (c) => c && typeof c.rel === 'string' && (path === c.rel || path.endsWith(`/${c.rel}`))
  );
  const key = hit?.cover?.key;
  return typeof key === 'string' && key ? `/_api/thumb/${key}` : null;
}

/** `(path) => url | null` for a sheet's rows; starts the cover pass the first time a sheet is up. */
export function useCoverOf({ active = true, fetchImpl } = {}) {
  const index = useCanvasIndex({ stamp: active ? 'sheet' : 'none', fetchImpl });
  useEffect(() => {
    if (active) askForCovers(fetchImpl);
  }, [active, fetchImpl]);
  return useCallback((path) => coverUrlOf(index, path), [index]);
}
