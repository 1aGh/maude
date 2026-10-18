// routes/edit.ts — `POST /_api/edit-op` (S2.1; contract client/v2/contracts/S2-edit-ops.md).
//
// The ONE dispatch route for S2's structural writes and S3's links: the op name is the registry
// action id, the writers are pure (`edit-ops/<op>.ts`), the order of refusals is the dispatcher's
// (`edit-ops/dispatch.ts`). MAIN ORIGIN ONLY — in neither canvas allowlist; the untrusted canvas
// iframe asks through the shell (`dgn:'edit-op'`, client/hooks/use-canvas-bridge.jsx) and the
// shell pins `file` to the active canvas. `readOnly: 'refused'`: a viewer, a Can comment session
// and a format-gated project get the read-only gate's 403 before this handler runs (minRole edit).
//
// One request = one file write = one kernel action (V2-1.5). Writes to one file are serialized.

import { readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';

import type { Access } from '../access/scope.ts';
import type { RunRegistry } from '../ai/runs.ts';
import { listPickerComponents, systemForPicker } from '../ds/component-list.ts';
import { dispatchEditOp, statusOf } from '../edit-ops/dispatch.ts';
import { createWriteLog, type WriteLog } from '../edit-ops/revert.ts';
import { type EditOp, MAX_BODY } from '../edit-ops/types.ts';
import { heldByAi } from './agent.ts';
import type { RouteSpec } from './table.ts';

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface EditRouteDeps {
  designRoot: string;
  /** `.design` — a `file` may carry it as a prefix */
  designRel: string;
  repoRoot: string;
  /** `activity:suppress` / `activity:unsuppress` on the studio bus (the base announcement) */
  emit(event: string, payload?: unknown): void;
  /** the pre-op snapshot for /design:rollback (best effort) */
  snapshot?(rel: string, before: string, reason: string): Promise<unknown>;
  /** THE run registry — AI holds (V2-1.15 §4 #13) */
  runs?: RunRegistry;
  /** accepted-revisions mode: the action a write became, by repo-relative path + bytes */
  actionFor?(repoRel: string, after: string): string | null;
  /**
   * The session's access (http.ts `accessOf`). `GET /_api/ds/components` is minRole edit: without it
   * the route refuses everyone (fail closed — a hidden row is never the only gate).
   */
  access?: (req: Request) => Access;
  /** tests only: an op table instead of `EDIT_OPS` */
  ops?: readonly EditOp[];
  log?: WriteLog;
}

/** designRoot-relative `.tsx` path of an existing canvas inside the design root, or null. */
export function resolveCanvasRel(
  designRoot: string,
  designRel: string,
  file: string
): string | null {
  let p = file.replace(/\\/g, '/').replace(/^\/+/, '');
  const dr = designRel.replace(/^\.\//, '').replace(/^\/+|\/+$/g, '');
  if (dr && p.startsWith(`${dr}/`)) p = p.slice(dr.length + 1);
  if (!p.endsWith('.tsx')) p = `${p}.tsx`;
  if (p.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  // Runtime state is never a canvas (DDR-115: `_history/`, `_draw/`, …).
  if (p.startsWith('_')) return null;
  try {
    const root = realpathSync(designRoot);
    const real = realpathSync(path.join(designRoot, ...p.split('/')));
    if (!real.startsWith(root + path.sep) || !statSync(real).isFile()) return null;
    return path.relative(root, real).split(path.sep).join('/');
  } catch {
    return null;
  }
}

export function createEditRoutes(deps: EditRouteDeps): RouteSpec[] {
  const log = deps.log ?? createWriteLog();
  const chains = new Map<string, Promise<unknown>>();
  const abs = (rel: string) => path.join(deps.designRoot, ...rel.split('/'));
  const serialized = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.catch(() => {}).then(run);
    chains.set(key, next);
    void next.finally(() => {
      if (chains.get(key) === next) chains.delete(key);
    });
    return next;
  };

  /** `meta.dsRev` of a canvas (V2-1.6): the server's word on "left out", never the request's */
  const dsRevOf = (rel: string): string | null => {
    try {
      const m = JSON.parse(readFileSync(abs(rel.replace(/\.tsx$/i, '.meta.json')), 'utf8'));
      return typeof m?.dsRev === 'string' && m.dsRev ? m.dsRev : null;
    } catch {
      return null;
    }
  };

  return [
    {
      method: 'POST',
      path: '/_api/edit-op',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, code: 'invalid', message: 'That edit is too large.' });
        const text = await req.text();
        if (text.length > MAX_BODY)
          return json(413, { ok: false, code: 'invalid', message: 'That edit is too large.' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { ok: false, code: 'invalid', message: 'The edit is not readable.' });
        }
        const file = (body as { file?: unknown } | null)?.file;
        const key =
          typeof file === 'string'
            ? (resolveCanvasRel(deps.designRoot, deps.designRel, file) ?? '')
            : '';
        const result = await serialized(key, () =>
          dispatchEditOp(body, {
            resolve: (f) => resolveCanvasRel(deps.designRoot, deps.designRel, f),
            read: (rel) => {
              try {
                return readFileSync(abs(rel), 'utf8');
              } catch {
                return null;
              }
            },
            write: async (rel, before, after, label) => {
              deps.emit('activity:suppress', rel);
              try {
                await Bun.write(abs(rel), after);
              } catch (e) {
                deps.emit('activity:unsuppress', rel);
                throw e;
              }
              try {
                await deps.snapshot?.(rel, before, label);
              } catch {
                /* snapshot best-effort */
              }
            },
            heldByAi: (rel, element) => (deps.runs ? heldByAi(deps.runs, rel, element) : null),
            actionFor: (rel, after) =>
              deps.actionFor?.(
                path.relative(deps.repoRoot, abs(rel)).split(path.sep).join('/'),
                after
              ) ?? null,
            log,
            ctx: (rel) => ({ dsRev: dsRevOf(rel) }),
            ...(deps.ops ? { ops: deps.ops } : {}),
          })
        );
        return json(statusOf(result), result);
      },
    },
    {
      // ⇧I — what the Component picker lists (S2.16; Q14: S2 keeps this route in this file). A read of
      // the design system, but it exists to ADD to a canvas, so it is minRole edit: a viewer and a
      // Can comment session are refused here, not merely shown no panel.
      method: 'GET',
      path: '/_api/ds/components',
      origin: 'main',
      readOnly: 'allowed',
      handle: (req) => {
        const file = new URL(req.url).searchParams.get('file');
        const rel = file ? resolveCanvasRel(deps.designRoot, deps.designRel, file) : null;
        const access = deps.access?.(req);
        if (!access?.can('edit', rel))
          return json(403, {
            ok: false,
            code: 'forbidden',
            message: 'Only people who can edit can place components.',
          });
        return json(
          200,
          listPickerComponents(
            deps.designRoot,
            systemForPicker(deps.designRoot, rel ? abs(rel) : null)
          )
        );
      },
    },
  ];
}
