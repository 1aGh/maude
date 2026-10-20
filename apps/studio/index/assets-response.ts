// index/assets-response.ts — the body of `GET /_api/index?part=assets` (S8.12; the Assets tab's one read).
//
// The index service answers (`assetsAnswer`, S8.11); this decides WHICH view of it a session gets. A project role
// sees every asset. A canvas-only session (V2-1.16 L9) sees the assets its granted canvases name and nothing else —
// not who else uses them, not older versions of canvases it cannot see (those are the service's rules once it is
// handed a view). A session that sees no canvas is handed an empty view, never "no view" (that would be everything).

import type { AssetsAnswer, AssetView } from './types.ts';

/** What the response needs of a session's `Visibility` (access/filters.ts). */
export interface AssetsVisibility {
  readonly full: boolean;
  seesCanvas(rel: string): boolean;
}

/** What it needs of the index service. */
export interface AssetsIndex {
  snapshot(): { canvases: ReadonlyArray<{ rel: string }> };
  assetsAnswer(view?: AssetView): AssetsAnswer;
}

export function assetsResponse(index: AssetsIndex, vis: AssetsVisibility): Response {
  const view: AssetView | undefined = vis.full
    ? undefined
    : {
        canvases: new Set(
          index
            .snapshot()
            .canvases.map((c) => c.rel)
            .filter((rel) => vis.seesCanvas(rel))
        ),
      };
  return Response.json(index.assetsAnswer(view), { headers: { 'Cache-Control': 'no-store' } });
}
