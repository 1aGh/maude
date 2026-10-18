// GET /_api/asset-state?rel=… — "Waiting for Jonas's Mac" vs Missing (S8.19, contract
// S8-S9-asset-presence §5.5). The shell asks for the rels of the open canvas and tells the canvas
// over dgn `asset-state`; the canvas never asks itself.
//
// MAIN ORIGIN ONLY: the answer names people (a display name), and the canvas origin gets presence
// only through the shell (§5.6 — the render token sees nothing). `guardTableRoute` adds
// `sameOriginRead` + `isTrustedRequestHost`. Batched ≤ 256 rels; the hub answer is cached 60 s per
// rel inside the service (`sync/asset-state.ts`).

import {
  type AssetStateService,
  isAssetStateRel,
  MAX_ASSET_STATE_RELS,
} from '../sync/asset-state.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface AssetStateRouteDeps {
  /** Built once per server; read per request so a link made later is honoured. */
  service: () => AssetStateService | null;
}

export function createAssetStateRoutes(deps: AssetStateRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/asset-state',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const rels = new URL(req.url).searchParams.getAll('rel');
        if (rels.length > MAX_ASSET_STATE_RELS) return json(413, { error: 'too-many' });
        if (rels.length === 0 || !rels.every(isAssetStateRel))
          return json(400, { error: 'bad-rel' });
        const service = deps.service();
        if (!service) return json(503, { error: 'unavailable' });
        const states = await service.states(rels);
        return json(200, {
          items: rels.map((rel) => ({ rel, ...(states[rel] ?? { state: 'waiting' }) })),
        });
      },
    },
  ];
}
