// hooks/use-project-data.jsx — moved verbatim out of client/app.jsx (Maude v2 plan V2-0.2, move-only split).

import { useCallback, useEffect, useRef } from 'react';
import { createIndexLoader } from '../index-loader.ts';
import { buildTree } from '../shell/util.js';
import { writeThemeAuto } from '../v2/settings/theme-auto.js';

export function useProjectData({
  setGroups,
  setTreeLoaded,
  setTreeLoadFailures,
  setProject,
  setSystemData,
  setCfg,
  setTheme,
}) {
  const toggleTheme = useCallback(() => {
    writeThemeAuto(false); // a picked theme ends Auto (Settings › General › Look)
    setTheme((t) => (t === 'dark' ? 'light' : 'dark'));
  }, []);

  // ----- Tree -----
  const treeLoaderRef = useRef(null);
  const loadTree = useCallback(() => treeLoaderRef.current?.reload() ?? Promise.resolve(), []);
  useEffect(() => {
    const loader = createIndexLoader({
      read: async (signal) => {
        const r = await fetch('/_index-data', { signal, cache: 'no-store' });
        if (!r.ok)
          throw Object.assign(new Error(`Project index request failed: ${r.status}`), {
            status: r.status,
          });
        const data = await r.json();
        const built = data.groups.map((g) => ({
          ...g,
          tree: buildTree(g.paths, g.stripPrefix, g.dirs),
        }));
        return { data, built };
      },
      apply: ({ data, built }) => {
        setProject(data.project || 'Design');
        setGroups(built);
        setTreeLoaded(true);
        setTreeLoadFailures(0);
        // DDR-093 — fold the server-resolved per-canvas DS map into cfg so
        // canvasUrl() injects each UI canvas's OWN design-system tokens instead of
        // always designSystems[0]. Functional merge to coexist with the /_config
        // fetch (either may land first). `?? {}` keeps older servers (no map) on
        // the ds0 fallback. Re-runs on every tree reload, so adding/retargeting a
        // canvas refreshes the map.
        setCfg((prev) => ({
          ...prev,
          canvasDesignSystems: data.canvasDesignSystems ?? {},
          // DDR-174 (T15) — per-canvas notable `.meta.json` `kind` values (today:
          // only `reconstructed-experimental`), folded in the same way + for the
          // same reason as canvasDesignSystems above.
          canvasKinds: data.canvasKinds ?? {},
          // S10.4 (V2-1.6 §5.8) — which revision each canvas renders; absent until a system is
          // converted, which canvasUrl() reads as "today's working files".
          canvasDsRevs: data.canvasDsRevs ?? {},
          systemHeads: data.systemHeads ?? {},
          dsConverted: data.dsConverted ?? {},
          dsRevGaps: data.dsRevGaps ?? {},
          // gate-b-c4j — canvases that import another canvas do not render; the stage says why (viewport.jsx).
          canvasImportsCanvases: data.canvasImportsCanvases ?? {},
        }));
      },
      onError: (error) => {
        console.error('failed to load tree', error);
        setTreeLoadFailures((n) => n + 1);
      },
    });
    treeLoaderRef.current = loader;
    loadTree();
    return () => {
      treeLoaderRef.current = null;
      loader.dispose();
    };
  }, [loadTree]);

  // ----- System data (lazy) -----
  // `dsName` scopes to a single design-system entry (DDR-048). The initial
  // call is unscoped — server returns `availableDesignSystems[]` + a default
  // — so the picker can render without a probe round-trip. Subsequent calls
  // (e.g. picker change) pass the chosen DS name and we replace systemData
  // wholesale (tokens + previews + ds metadata all shift together).
  const loadSystemData = useCallback(async (dsName) => {
    try {
      const url = dsName ? `/_system-data?ds=${encodeURIComponent(dsName)}` : '/_system-data';
      const r = await fetch(url);
      if (!r.ok) {
        console.error('failed to load system-data', r.status);
        return;
      }
      const data = await r.json();
      // If the initial unscoped fetch has a defaultDesignSystem but no `ds`
      // attached (multi-DS project), kick off a scoped fetch so the visible
      // tokens + previews match the default DS, not the union root scan.
      if (!dsName && data?.defaultDesignSystem && !data.ds) {
        setSystemData(data);
        const r2 = await fetch(`/_system-data?ds=${encodeURIComponent(data.defaultDesignSystem)}`);
        if (r2.ok) setSystemData(await r2.json());
        return;
      }
      setSystemData(data);
    } catch (e) {
      console.error('failed to load system-data', e);
    }
  }, []);
  return { loadSystemData, loadTree, toggleTheme };
}
