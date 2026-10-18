// Stable canvas links — S1.18 (S1 Q6, 11 · pn-deeplink).
//
//   GET /_api/link/resolve?c=<entry>     → { ok, status: 'live', entry, path } | { ok, status: 'trashed', entry }
//                                           | { ok, status: 'unknown' }
//   GET /_api/link/resolve?path=<rel>    → the entry a new link names (Copy link): live, or unknown
//   either, with no op log                → { ok: false, reason: 'legacy' } (the caller keeps today's path link)
//
// MAIN ORIGIN ONLY (never `origin: 'canvas'`): it maps ids to paths across the whole project, which the
// untrusted canvas iframe has no business asking (DDR-054). A canvas-only session (`scope`) resolves only its
// granted canvases; everything else is the same `unknown` (history/links.ts — no existence oracle). A read:
// a viewer may follow a link.

import {
  entryForPath,
  type LinkRuntime,
  type LinkScope,
  linkSourceOf,
  resolveEntry,
} from '../history/links.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface LinksRouteDeps {
  /** `ctx.syncControl.current()` — null while no home answers. */
  control: () => LinkRuntime | null | undefined;
  /** `.design` — a `path=` may name the canvas repo-relative too. */
  designRel: string;
  /**
   * The calling session's access (V2-1.7, `access/scope.ts` `Access`); null = a project session. Wired
   * once the studio reads the proxy's claim per request (S9.9 `currentAccess`).
   */
  scope?: (req: Request) => LinkScope | null;
}

const designRelOf = (raw: string, designRel: string): string => {
  const p = raw.replace(/\\/g, '/').replace(/^\/+/, '');
  const prefix = `${designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '')}/`;
  return prefix !== '/' && p.startsWith(prefix) ? p.slice(prefix.length) : p;
};

export function createLinksRoutes(deps: LinksRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/link/resolve',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const url = new URL(req.url);
        const entries = url.searchParams.getAll('c');
        const paths = url.searchParams.getAll('path');
        if (entries.length + paths.length !== 1)
          return json(400, { ok: false, reason: 'one of c=<entry> or path=<canvas> is required' });
        const source = linkSourceOf(deps.control());
        const scope = deps.scope?.(req) ?? null;
        let answer: Awaited<ReturnType<typeof resolveEntry>>;
        try {
          answer =
            entries.length === 1
              ? await resolveEntry(source, entries[0] as string, scope)
              : await entryForPath(source, designRelOf(paths[0] as string, deps.designRel), scope);
        } catch {
          return json(200, { ok: false, reason: 'unreachable' });
        }
        if (!answer) return json(200, { ok: false, reason: 'legacy' });
        return json(200, { ok: true, ...answer });
      },
    },
  ];
}
