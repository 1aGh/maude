// POST /_api/assets/rename — Rename… an asset (P8 round 7; 12 · ia-assets-keys tile menu).
//
//   body  { asset: 'assets/<name>.<ext>', name: string }   `name` is the new base name; the extension is kept
//   200   { ok: true, rel, to, moved: [[from, to], …] }
//   409   { ok: false, reason }   invalid | bad-name | missing | same | exists | used | kept-by-versions | checking
//   403   { ok: false, reason: 'forbidden' }      a canvas-only session, or a role below Can edit
//   400 / 413                                      a body that is not that
//
// MAIN ORIGIN ONLY, never canvas-safe: it moves project files, which the untrusted canvas must not do (DDR-054/088).
// The role gate is the generic table gate (a POST that names no other class is `edit`, CSRF-checked like every main-origin
// write) AND here, per request, because a canvas-only editor holds `edit` on its canvases but has no project-level say
// over `assets/` as a whole. A picture a canvas uses is refused (asset-rename.ts says why).

import { renameAsset } from '../asset-rename.ts';
import type { AssetTrashRouteDeps } from './asset-trash.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 4 * 1024;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** The same deps as Move to trash: the design root, the access judge, the index's verdict rows, the change announcement. */
export function createAssetRenameRoutes(deps: AssetTrashRouteDeps): RouteSpec[] {
  return [
    {
      method: 'POST',
      path: '/_api/assets/rename',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        const access = deps.access(req);
        if (access.canvasOnly || !access.can('edit', null))
          return json(403, { ok: false, reason: 'forbidden' });
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, reason: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
        let body: { asset?: unknown; name?: unknown };
        try {
          body = JSON.parse(text) ?? {};
        } catch {
          return json(400, { ok: false, reason: 'bad-json' });
        }
        if (typeof body.asset !== 'string' || typeof body.name !== 'string')
          return json(400, { ok: false, reason: 'bad-body' });
        const rel = body.asset;
        const row = deps.rows().find((r) => r.rel === rel);
        const r = renameAsset({
          designRoot: deps.designRoot,
          rel,
          name: body.name,
          rowOf: () => row,
          announce: deps.announce,
        });
        return r.ok ? json(200, r) : json(409, r);
      },
    },
  ];
}
