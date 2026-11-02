// POST /_api/assets/trash — Move assets to the trash (S8.13; 12 · ia-assets-keys, ia-assets-tidy).
//
//   body  { assets: string[] }                    1–500 design-root-relative `assets/<name>` paths
//   200   { ok: true, results: [{ rel, ok: true, trashed[], trashDir } | { rel, ok: false, reason }] }
//         reason: invalid | missing | used | kept-by-versions | checking   (asset-trash.ts says which and why)
//   403   { ok: false, reason: 'forbidden' }      a canvas-only session, or a role below Can edit
//   400 / 413                                      a body that is not that
//
// MAIN ORIGIN ONLY, never canvas-safe: it removes project files, which the untrusted canvas must not do (DDR-054/088).
// The role gate is the generic table gate (a POST that names no other class is `edit`) AND here, per request, because a
// canvas-only editor holds `edit` on its canvases but has no project-level say over `assets/` as a whole.
// One refusal never blocks the others: the answer is per item, so a bulk "Move 31 to the trash…" tells which stayed.

import type { Access } from '../access/scope.ts';
import { type AssetVerdictRow, trashAssets } from '../asset-trash.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 64 * 1024;
const MAX_ASSETS = 500;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface AssetTrashRouteDeps {
  designRoot: string;
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** The index's asset rows (`assetsAnswer().assets`), read once per request; a file it does not list reads as "checking". */
  rows: () => ReadonlyArray<AssetVerdictRow & { rel: string }>;
  /** A file left the project (the studio's change announcement; workspace mode only). */
  announce?: (rel: string) => void;
  now?: () => number;
}

export function createAssetTrashRoutes(deps: AssetTrashRouteDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/assets/trash',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const access = deps.access(req);
        // a project-level edit: the whole `assets/` folder is the project's, not one canvas's
        if (access.canvasOnly || !access.can('edit', null))
          return json(403, { ok: false, reason: 'forbidden' });
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, reason: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
        let body: { assets?: unknown };
        try {
          body = JSON.parse(text) ?? {};
        } catch {
          return json(400, { ok: false, reason: 'bad-json' });
        }
        const list = body.assets;
        if (
          !Array.isArray(list) ||
          list.length < 1 ||
          list.length > MAX_ASSETS ||
          !list.every((x) => typeof x === 'string')
        )
          return json(400, { ok: false, reason: 'bad-assets' });
        const byRel = new Map(deps.rows().map((r) => [r.rel, r]));
        const { results } = trashAssets({
          designRoot: deps.designRoot,
          rels: list as string[],
          rowOf: (rel) => byRel.get(rel),
          announce: deps.announce,
          now: deps.now,
        });
        return json(200, { ok: true, results });
      },
    },
  ];
}
