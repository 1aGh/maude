// client/v2/ds/use-ds-model.js — S10.7: the Design system's model for the inspector's token editor.
//
// The Design system canvas draws from a model inlined into its own module (ds/board). The inspector lives on
// the main origin and cannot read inside the canvas (DDR-054), so it asks the studio for the SAME model —
// `GET /_api/ds/board?ds=` (ds/board/build-model.ts) — which is why the panel and the board never disagree
// about a value, a lock or a waiting edit.

import { useCallback, useEffect, useRef, useState } from 'react';
import { canvasDsSystem } from '../../canvas-url.js';
import { fetchBoard } from './token-write.js';

/** The system a Design system canvas IS (its folder's `design-system.tsx`), else the one a canvas follows. */
export function systemOfCanvas(file, cfg) {
  if (typeof file !== 'string' || !file) return null;
  const designRel = (cfg?.designRel || '.design').replace(/^\/+|\/+$/g, '');
  const rel = file.startsWith(`${designRel}/`) ? file.slice(designRel.length + 1) : file;
  const own = (Array.isArray(cfg?.designSystems) ? cfg.designSystems : []).find(
    (d) => typeof d?.path === 'string' && rel === `${d.path.replace(/\/+$/, '')}/design-system.tsx`
  );
  if (own) return own.name;
  return canvasDsSystem(file, cfg)?.name ?? null;
}

/**
 * The board model of `ds`, read again whenever `key` changes (a new selection) and when the window is looked at
 * again. `refresh()` reads now; `adopt(model)` takes a model a refused write brought back.
 * @returns {{ model: any, loading: boolean, refresh: () => Promise<any>, adopt: (m: any) => void }}
 */
export function useDsBoard(ds, key = '') {
  const [model, setModel] = useState(null);
  const [loading, setLoading] = useState(!!ds);
  const live = useRef(0);
  const refresh = useCallback(async () => {
    if (!ds) return null;
    const n = ++live.current;
    const m = await fetchBoard(ds);
    if (n === live.current) {
      setModel(m);
      setLoading(false);
    }
    return m;
  }, [ds]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is the trigger
  useEffect(() => {
    setLoading(!!ds);
    refresh();
  }, [ds, key, refresh]);
  useEffect(() => {
    const look = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', look);
    return () => document.removeEventListener('visibilitychange', look);
  }, [refresh]);
  const adopt = useCallback((m) => {
    live.current++;
    setModel(m);
    setLoading(false);
  }, []);
  return { model, loading, refresh, adopt };
}
