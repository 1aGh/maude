// GET /_api/asset-state?rel=… | ?canvas=… — "Waiting for Jonas's Mac" vs Missing (S8.19, contract
// S8-S9-asset-presence §5.5). The shell asks for the media of the open canvas and tells the canvas
// over dgn `asset-state`; the canvas never asks itself.
//
// MAIN ORIGIN ONLY: the answer names people (a display name), and the canvas origin gets presence
// only through the shell (§5.6 — the render token sees nothing). `guardTableRoute` adds
// `sameOriginRead` + `isTrustedRequestHost`. Batched ≤ 256 rels; the hub answer is cached 60 s per
// rel inside the service (`sync/asset-state.ts`).
//
// `?canvas=<file>` (S8.19b) asks for every media reference IN that canvas's source, read here: the
// shell never parses TSX, and what the shell relays to a canvas is bounded by what the canvas file
// itself names — never by a list the (untrusted) canvas supplied.
//
// A cell refuses (503): a cell IS the hub, its studio has no peer hub to ask — the hub's studio
// proxy refuses the path too (studio-manifest `REFUSED`). The client reads any refusal as the quiet
// "Not here yet", never as Missing.

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  type AssetPresenceAsker,
  type AssetStateService,
  assetRefsInSource,
  createAssetStateService,
  isAssetStateRel,
  MAX_ASSET_STATE_RELS,
} from '../sync/asset-state.ts';
import { resolveCanvasRel } from './edit.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface AssetStateRouteDeps {
  /** Built once per server; read per request so a link made later is honoured. */
  service: () => AssetStateService | null;
  /** For `?canvas=` — absent: only `?rel=` is answered. */
  designRoot?: string;
  designRel?: string;
}

/** The slice of the sync runtime the service reads (sync/index.ts `SyncRuntime`). */
export interface AssetStateRuntime {
  assetPresenceAsker?(): AssetPresenceAsker | null;
  assetUploading?(): ReadonlyMap<string, { progress?: number }> | null;
}

/**
 * http.ts's one line: the service built ONCE, over the live runtime (a project can link, unlink or
 * restart its runtime while the server runs). `inCell` (MAUDE_WORKSPACE_MODE=1) refuses.
 */
export function assetStateDepsFor(opts: {
  designRoot: string;
  designRel: string;
  runtime: () => AssetStateRuntime | null;
  env?: Record<string, string | undefined>;
}): AssetStateRouteDeps {
  const inCell = (opts.env ?? process.env).MAUDE_WORKSPACE_MODE === '1';
  const service = createAssetStateService({
    designRoot: opts.designRoot,
    hub: () => opts.runtime()?.assetPresenceAsker?.() ?? null,
    uploading: () => opts.runtime()?.assetUploading?.() ?? null,
  });
  return {
    service: () => (inCell ? null : service),
    designRoot: opts.designRoot,
    designRel: opts.designRel,
  };
}

function canvasRels(deps: AssetStateRouteDeps, file: string): string[] | null {
  if (!deps.designRoot || deps.designRel === undefined) return null;
  const rel = resolveCanvasRel(deps.designRoot, deps.designRel, file);
  if (!rel) return null;
  try {
    const source = readFileSync(path.join(deps.designRoot, ...rel.split('/')), 'utf8');
    return assetRefsInSource(source).slice(0, MAX_ASSET_STATE_RELS);
  } catch {
    return null;
  }
}

export function createAssetStateRoutes(deps: AssetStateRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/asset-state',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const params = new URL(req.url).searchParams;
        const canvas = params.get('canvas');
        let rels = params.getAll('rel');
        if (canvas !== null) {
          if (rels.length) return json(400, { error: 'bad-rel' });
          const found = canvasRels(deps, canvas);
          if (!found) return json(404, { error: 'no-canvas' });
          rels = found;
        } else {
          if (rels.length > MAX_ASSET_STATE_RELS) return json(413, { error: 'too-many' });
          if (rels.length === 0 || !rels.every(isAssetStateRel))
            return json(400, { error: 'bad-rel' });
        }
        const service = deps.service();
        if (!service) return json(503, { error: 'unavailable' });
        if (rels.length === 0) return json(200, { items: [] });
        const states = await service.states(rels);
        return json(200, {
          items: rels.map((rel) => ({ rel, ...(states[rel] ?? { state: 'waiting' }) })),
        });
      },
    },
  ];
}
