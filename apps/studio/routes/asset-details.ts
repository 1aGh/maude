// /_api/asset-details and /_api/asset-generated — what the Assets tab says about one asset, and its "Generated" group
// (S8.21; 12 · ia-asset-details, ia-advanced; contract S8-asset-sidecars §5.2 and §5.4).
//
//   GET /_api/asset-details?path=assets/<name>
//       200 { ok: true, details }   asset-details.ts `AssetDetails`: kind, size, Made by AI, what AI saw, where it is used
//                                   (canvas + artboards) and the Advanced facts (stored as, original, edits, cut-out, command)
//       404 { ok: false, reason: 'not-found' }   not an asset, not there, or one a canvas-only session cannot see
//   GET /_api/asset-generated
//       200 { ok: true, groups }    asset-generated.ts: one block per generation run, newest first ([] for a canvas-only session)
//
// MAIN ORIGIN ONLY, never canvas-safe. The Original path is a home folder on THIS Mac: it is told only to a project session
// of a studio that runs on a Mac (not a cell, not a canvas-only guest), and it is never served to the canvas origin — the
// canvas origin does not carry this route at all. Reads only; works for every role that can read the asset (a viewer too).
//
// A canvas-only session reaches the handler only for an asset its canvases show (the table gate judges the picture as the
// route's `target`), is named only the canvases it can see, and learns nothing about any other asset.

import type { Access } from '../access/scope.ts';
import { type AssetDetails, assetDetails, DETAIL_ASSET_REL } from '../asset-details.ts';
import { listGeneratedGroups } from '../asset-generated.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface AssetDetailsRouteDeps {
  designRoot: string;
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** designRoot-relative canvases that use `assets/<name>` (the index's `usedIn`, whole project). */
  usedIn: (assetRel: string) => readonly string[];
  /** A canvas's source (designRoot-relative), or null. */
  read: (canvasRel: string) => string | null;
  /** This studio runs in a workspace cell: it has no Mac, so it keeps no Original. */
  inCell?: boolean;
  /** The home folder to abbreviate to `~` (defaults to the process's). */
  home?: string;
}

/** `assets/<name>` from the query, or null. */
export function detailsRelOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const rel = v.trim().replace(/^\.?\/+/, '');
  return DETAIL_ASSET_REL.test(rel) ? rel : null;
}

export function createAssetDetailsRoutes(deps: AssetDetailsRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/asset-details',
      origin: 'main',
      readOnly: 'allowed',
      target: async (req) => detailsRelOf(new URL(req.url).searchParams.get('path')),
      handle: async (req) => {
        const rel = detailsRelOf(new URL(req.url).searchParams.get('path'));
        if (!rel) return json(400, { ok: false, reason: 'bad-path' });
        const access = deps.access(req);
        const project = access.role !== null && !access.canvasOnly;
        const all = deps.usedIn(rel);
        const usedIn = project ? all : all.filter((c) => access.seesCanvas(c));
        const details: AssetDetails | null = assetDetails(rel, {
          designRoot: deps.designRoot,
          usedIn,
          readCanvas: deps.read,
          includeOriginal: project && !deps.inCell,
          home: deps.home ?? process.env.HOME,
        });
        if (!details) return json(404, { ok: false, reason: 'not-found' });
        return json(200, { ok: true, details });
      },
    },
    {
      method: 'GET',
      path: '/_api/asset-generated',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const access = deps.access(req);
        // the groups name assets across the whole project: a canvas-only guest is told none
        if (access.canvasOnly || !access.can('read', null))
          return json(200, { ok: true, groups: [] });
        return json(200, { ok: true, groups: listGeneratedGroups(deps.designRoot) });
      },
    },
  ];
}
