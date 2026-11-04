// routes/ds-assets.ts — `GET /_api/ds/assets` (2.0.2): a design system's own asset library, for the Assets tab's
// "Design system" source.
//
//   GET /_api/ds/assets?ds=<name>&dir=<folder>&q=<search>&cursor=<c>&limit=<n>
//       200 { ok: true, ds, root, dir, dirs:[{path,name,count}], files:[{path,name,ext,kind,size,mtimeMs,placeable}],
//             total, next }      ds-assets.ts `listDsAssets`: one folder (or a search below it), one page, by name
//       400 { ok: false, reason: 'bad-dir' }      a folder with `..`, a `_`/`.` name or a `\`
//       404 { ok: false, reason: 'not-found' }    no such system, a folder that is not there (or is a symlink), or —
//                                                 for a canvas-only session — one with nothing its canvases show
//
// `ds` is a name from the project's config `designSystems` (path per system, which must be `system/<one segment>`);
// `path` in every row is designRoot-relative (`system/<ds>/assets/photos-cut/x.jpg`) — the shell shows it at
// `/<designRel>/<path>` and places it as that literal reference (editing/ds-asset-ref.ts).
//
// MAIN ORIGIN ONLY, never canvas-safe (a shell panel's read; absent from both canvas allowlists). Reads only, for
// every role that can read the project. A canvas-only session is answered from its closure alone (`filterAssetListing`'s
// rule for `/_api/assets`): the files its canvases' closure reads, and no folder without one.
//
// ON A MATERIALIZING CELL (2.0.3) the system's media is in the hub's journal, not on the checkout (DDR-243): the hub's
// inert-media listing (`listMaterializable` — the file tree's and the closure's source) joins the disk, so the folders
// carry their counts and files again. Off a cell it answers `null` at once and the disk alone is listed, as before.

import type { Visibility } from '../access/filters.ts';
import { listDsAssets } from '../ds-assets.ts';
import { listMaterializable } from '../materialize-client.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface DsAssetsRouteDeps {
  designRoot: string;
  /** The project's design systems (config `designSystems`), read per request. */
  systems: () => ReadonlyArray<{ name: string; path: string }>;
  /** The session's visibility (http.ts `visOf`). */
  visibility: (req: Request) => Visibility;
  /** A materializing cell's journal media (designRoot-relative); `null` off a cell. Default `listMaterializable`. */
  journalMedia?: () => Promise<readonly string[] | null>;
}

export function createDsAssetsRoutes(deps: DsAssetsRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/ds/assets',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const q = new URL(req.url).searchParams;
        const name = q.get('ds') ?? '';
        const sys =
          name && name.length <= 64 ? deps.systems().find((s) => s.name === name) : undefined;
        if (!sys) return json(404, { ok: false, reason: 'not-found' });
        const vis = deps.visibility(req);
        let candidates: string[] | undefined;
        if (!vis.full) {
          const closure = vis.closure();
          candidates = closure ? [...closure.read].filter((rel) => vis.sees(rel)) : [];
        }
        const page = await listDsAssets({
          designRoot: deps.designRoot,
          systemPath: sys.path,
          dir: q.get('dir'),
          q: q.get('q'),
          cursor: q.get('cursor'),
          limit: q.get('limit'),
          ...(candidates ? { candidates } : {}),
          journal: await (deps.journalMedia ?? listMaterializable)(),
        });
        if (!page.ok) return json(page.status, { ok: false, reason: page.reason });
        // a canvas-only session that sees nothing of this library is told it is not there
        if (candidates && !candidates.some((rel) => rel.startsWith(`${page.root}/`)))
          return json(404, { ok: false, reason: 'not-found' });
        return json(200, { ...page, ds: sys.name });
      },
    },
  ];
}
