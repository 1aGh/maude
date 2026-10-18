// GET /_api/sync/availability — S11.4: which canvases are on this Mac and which are still coming
// (05 · es-arriving, es-offline-uncached). A handler TABLE (V2-2.5); `routes/index.ts` mounts it.
//
// MAIN ORIGIN ONLY. The answer names canvases of the project, so it is never canvas-safe: a canvas
// iframe has no business enumerating its siblings.
//
// A READ. It answers from the runtime's in-memory state (`sync/availability.ts`) and the index's
// disk listing — it never asks the hub, never wakes the pull lane. A client polling it cannot turn
// into a fetch storm against the hub, whatever its interval.
//
// `?canvas=<designRoot-relative path>` adds `canvas: { path, state }` — what the viewport asks before
// it loads a module that may not be on disk. A canvas-only session naming a canvas outside its
// grants is refused `not-in-scope` here as well as by http.ts's `canvasScopeRefusal` (the same 403,
// twice: the route must not depend on being mounted behind the gate to keep a name private).

import { notInScopeResponse } from '../access/request.ts';
import type { Access } from '../access/scope.ts';
import {
  type AvailabilitySource,
  availabilityOf,
  computeAvailability,
} from '../sync/availability.ts';
import type { RouteSpec } from './table.ts';

export interface AvailabilityRouteDeps {
  /** The live runtime's view, or null when unlinked / not running. */
  source(): AvailabilitySource | null;
  /** The canvases the project index lists on disk (repo- or designRoot-relative). */
  local(): Promise<readonly string[]> | readonly string[];
  designRel: string;
  /** The request's session; null = the local owner. */
  access(req: Request): Access | null;
  /** The project's name for the foot ("Getting <project> · 41 of 93 canvases"). */
  project(): string | null;
}

const noStore = { 'Cache-Control': 'no-store' };

/** `ui/a.tsx` / `.design/ui/a.tsx` → `ui/a.tsx`; null for anything that is not a plain path. */
function relParam(raw: string, designRel: string): string | null {
  const s = raw.replace(/^\/+/, '');
  if (!s || s.includes('\\') || s.split('/').some((p) => p === '' || p === '.' || p === '..'))
    return null;
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

/** The canvas paths of a `/_index-data` payload (its `kind: 'canvas'` groups) — what the panel draws. */
export function canvasPathsOfIndex(data: unknown): string[] {
  const groups = (data as { groups?: unknown } | null)?.groups;
  if (!Array.isArray(groups)) return [];
  const out: string[] = [];
  for (const g of groups as Array<{ kind?: unknown; paths?: unknown }>) {
    if (g?.kind !== 'canvas' || !Array.isArray(g.paths)) continue;
    for (const p of g.paths) if (typeof p === 'string' && /\.(tsx|html)$/i.test(p)) out.push(p);
  }
  return out;
}

export function createAvailabilityRoutes(deps: AvailabilityRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/sync/availability',
      origin: 'main',
      readOnly: 'allowed',
      handle: async (req) => {
        const access = deps.access(req);
        if (access && access.role === null && !access.canvasOnly) return notInScopeResponse();
        if (access && access.role !== null && !access.can('read', null))
          return notInScopeResponse();
        const raw = new URL(req.url).searchParams.get('canvas');
        let want: string | null = null;
        if (raw !== null) {
          want = relParam(raw, deps.designRel);
          if (want === null) return notInScopeResponse();
          if (access?.canvasOnly && !(access.seesCanvas(want) && access.can('read', want)))
            return notInScopeResponse();
        }
        const local = await deps.local();
        const model = computeAvailability({
          source: deps.source(),
          local,
          designRel: deps.designRel,
          access,
        });
        const body: Record<string, unknown> = { ...model, project: deps.project() };
        if (want !== null)
          body.canvas = { path: want, state: availabilityOf(model, want, local, deps.designRel) };
        return Response.json(body, { headers: noStore });
      },
    },
  ];
}
