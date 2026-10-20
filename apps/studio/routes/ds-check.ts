// routes/ds-check.ts — S10.19: Design system › Advanced and "Check the system" (13 · ds-advanced).
//
//   GET  /_api/ds/system-files?ds=   the tokens file (CSS | JSON, shortened), the folder, the version history
//   GET  /_api/ds/check-system?ds=   the answer the last check kept (null when it never ran)
//   POST /_api/ds/check-system {ds}  run the check now; keeps `_state/ds-check/<ds>.json`
//
// Reads are for anyone who can open the system's canvas (a system a session cannot see answers like one that
// does not exist, as the rest of routes/ds.ts does). The run is Can edit on the whole project: it writes a file
// under `_state/` and costs a pass over the system, so a viewer reads the last answer and cannot start one.
// The verb `maude design ds check-system` runs the SAME functions (ds/check-system-verb.ts).

import type { Access } from '../access/scope.ts';
import { lastSystemCheck, runSystemCheck } from '../ds/check-system.ts';
import type { DsEngine } from '../ds/engine.ts';
import { readSystemFiles } from '../ds/system-files.ts';
import { type DsRouteDeps, dsCanvasOf } from './ds.ts';
import type { RouteSpec } from './table.ts';

export const CHECK_FORMATS = {
  files: 'maude.ds-system-files',
  last: 'maude.ds-system-check-last',
} as const;

export interface CheckAnswer {
  status: number;
  body: unknown;
}

const refuse = (status: number, code: string, error: string): CheckAnswer => ({
  status,
  body: { error, code },
});
const unknown = (ds: string) =>
  refuse(404, 'ds-unknown-system', `no design system named ${String(ds).slice(0, 64)}`);

function seen(engine: DsEngine, access: Access, ds: unknown): string | null {
  if (typeof ds !== 'string' || !ds || ds.length > 64) return null;
  if (!engine.systems().some((s) => s.name === ds)) return null;
  if (access.role !== null) return ds;
  const canvas = dsCanvasOf(engine, ds);
  return canvas && access.seesCanvas(canvas) ? ds : null;
}

/** One operation — the route's handler and the in-process verb both run exactly this. */
export function runCheckOp(
  op: 'files' | 'last' | 'run',
  input: { ds?: unknown },
  c: { engine: DsEngine; access: Access }
): CheckAnswer {
  const ds = seen(c.engine, c.access, input.ds);
  if (!ds) return unknown(String(input.ds ?? ''));
  const sys = c.engine.systems().find((s) => s.name === ds);
  if (!sys) return unknown(ds);
  if (op === 'files') return { status: 200, body: readSystemFiles(c.engine.designRoot, sys) };
  if (op === 'last')
    return {
      status: 200,
      body: {
        format: CHECK_FORMATS.last,
        v: 1,
        ds,
        check: lastSystemCheck(c.engine.designRoot, ds),
      },
    };
  if (!c.access.can('edit', null))
    return refuse(403, 'forbidden', 'You can’t check this design system.');
  return { status: 200, body: runSystemCheck(c.engine.designRoot, sys) };
}

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export function createDsCheckRoutes(deps: DsRouteDeps): RouteSpec[] {
  const ctx = (req: Request) => {
    const engine = deps.engine();
    return engine ? { engine, access: deps.access(req) } : null;
  };
  const unavailable = () =>
    json(503, { error: 'Design systems are not available here.', code: 'ds-unavailable' });
  const read = (op: 'files' | 'last') => (req: Request) => {
    const c = ctx(req);
    if (!c) return unavailable();
    const a = runCheckOp(op, { ds: new URL(req.url).searchParams.get('ds') }, c);
    return json(a.status, a.body);
  };
  // Literal `method`/`path` pairs: the writer-registry, hub-manifest and CSRF scrapers read them.
  return [
    {
      method: 'GET',
      path: '/_api/ds/system-files',
      origin: 'main',
      readOnly: 'allowed',
      handle: read('files'),
    },
    {
      method: 'GET',
      path: '/_api/ds/check-system',
      origin: 'main',
      readOnly: 'allowed',
      handle: read('last'),
    },
    {
      method: 'POST',
      path: '/_api/ds/check-system',
      origin: 'main',
      readOnly: 'refused',
      async handle(req) {
        const c = ctx(req);
        if (!c) return unavailable();
        let body: Record<string, unknown> = {};
        try {
          const text = await req.text();
          const v = text ? JSON.parse(text) : {};
          if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('not an object');
          body = v as Record<string, unknown>;
        } catch {
          return json(400, { error: 'The body is a JSON object.', code: 'usage' });
        }
        const a = runCheckOp('run', { ds: body.ds }, c);
        return json(a.status, a.body);
      },
    },
  ];
}
