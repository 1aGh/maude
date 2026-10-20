// routes/ds-library.ts — `POST /_api/ds/library {action, ...}` (S10.18b; V2-1.6 §5.12, §5.14).
//
//   {action: 'link', url, grant?, label?}             link a team library (a new local system, view only here)
//   {action: 'check', ds?, force?}                    ask the hub where its head is (30-min throttle unless forced)
//   {action: 'update', ds?, dryRun: true}             the review: changes from upstream + this project's canvases
//   {action: 'update', ds?, expectHead, upstream, canvases?}   take the update as ONE action
//   {action: 'unlink', ds?}                           the copy becomes an ordinary local system
//
// Every action needs Can edit on the WHOLE project (Q15 — "library"), the review included: it reaches another
// project's hub with this Mac's grant. A canvas-only session or Can view gets 403, and a system it cannot see
// is answered like one that does not exist. `ds` may be left out when exactly one linked system exists (the
// verb's `library update` / `unlink`). The answer format is `maude.ds-library/1` `{library, changes[]}`.

import type { DsEngine } from '../ds/engine.ts';
import { createDsLibrary, type DsLibrary, fileGrantStore } from '../ds/library.ts';
import { getHubToken } from '../sync/hubs-config.ts';
import type { DsOpAnswer, DsOpContext } from './ds.ts';

const isObj = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

class Usage extends Error {}
const usage = (m: string): never => {
  throw new Usage(m);
};

const libraries = new WeakMap<DsEngine, DsLibrary>();
/** The engine's library (this Mac's grant store, hubs.json member tokens) unless the context brings one. */
export function libraryFor(c: DsOpContext): DsLibrary {
  if (c.library) return c.library;
  let lib = libraries.get(c.engine);
  if (!lib) {
    lib = createDsLibrary(c.engine, {
      grants: fileGrantStore(),
      memberToken: (hub) => getHubToken(hub),
    });
    libraries.set(c.engine, lib);
  }
  return lib;
}

const forbidden = (): DsOpAnswer => ({
  status: 403,
  body: { error: 'You can’t change this design system.', code: 'forbidden' },
});

const answer = (body: Record<string, unknown>): DsOpAnswer => ({
  status: 200,
  body: { format: 'maude.ds-library', v: 1, ...body },
});

/** The linked system the request names, or the only one; visibility as every other ds route. */
function pickSystem(lib: DsLibrary, raw: unknown): string {
  const all = lib.linkedSystems().map((x) => x.system);
  if (raw === undefined || raw === null || raw === '') {
    if (all.length === 1) return all[0];
    return usage(
      all.length ? 'name the system: more than one library is linked' : 'no team library is linked'
    );
  }
  if (typeof raw !== 'string' || raw.length > 64) return usage('ds is a system name');
  return raw;
}

export async function runLibraryOp(
  input: Record<string, unknown>,
  c: DsOpContext
): Promise<DsOpAnswer> {
  // whole-project edit for every action (Q15); hidden ≠ refused, so the server says it
  if (!c.access.can('edit', null)) return forbidden();
  const lib = libraryFor(c);
  try {
    switch (input.action) {
      case 'link': {
        if (typeof input.url !== 'string') usage('url is the library link');
        if (input.grant !== undefined && typeof input.grant !== 'string')
          usage('grant is a string');
        if (input.label !== undefined && typeof input.label !== 'string')
          usage('label is a string');
        const r = await lib.link({
          url: input.url as string,
          ...(typeof input.grant === 'string' ? { grant: input.grant } : {}),
          ...(typeof input.label === 'string' ? { label: input.label } : {}),
          by: c.by,
        });
        c.emit?.('ds:changed', { system: r.system });
        return answer({
          action: 'link',
          system: r.system,
          rev: r.rev,
          actionId: null,
          library: r.library,
          changes: [],
        });
      }
      case 'check': {
        const ds = pickSystem(lib, input.ds);
        const r = await lib.check(ds, { force: input.force === true });
        if (r.checked) c.emit?.('ds:changed', { system: ds });
        return answer({
          action: 'check',
          system: ds,
          library: r.library,
          waiting: r.waiting,
          usedBy: r.usedBy,
          changes: [],
        });
      }
      case 'update': {
        const ds = pickSystem(lib, input.ds);
        if (input.dryRun === true)
          return answer({ action: 'update', ...(await lib.review(ds)), result: null });
        if (!('expectHead' in input)) usage('expectHead is the head the review was read at');
        const expectHead =
          input.expectHead === null
            ? null
            : typeof input.expectHead === 'string'
              ? input.expectHead
              : usage('expectHead');
        if (typeof input.upstream !== 'string' || !/^[0-9a-f]{64}$/.test(input.upstream))
          usage('upstream is the library revision the review showed');
        const canvases: { path: string; ticked: boolean }[] = [];
        if (input.canvases !== undefined) {
          if (!Array.isArray(input.canvases)) usage('canvases is a list of {path, ticked}');
          for (const x of input.canvases as unknown[]) {
            if (!isObj(x) || typeof x.path !== 'string' || typeof x.ticked !== 'boolean')
              usage('canvases is a list of {path, ticked}');
            canvases.push({
              path: String((x as { path: string }).path),
              ticked: (x as { ticked: boolean }).ticked,
            });
          }
        }
        const r = await lib.update(ds, {
          expectHead: expectHead as string | null,
          upstream: input.upstream as string,
          canvases,
          by: c.by,
        });
        c.emit?.('ds:changed', { system: ds });
        const library = lib.linkedSystems().find((x) => x.system === ds)?.library ?? null;
        return answer({ action: 'update', system: ds, library, changes: [], result: r });
      }
      case 'unlink': {
        const ds = pickSystem(lib, input.ds);
        const r = await lib.unlink(ds, { by: c.by });
        c.emit?.('ds:changed', { system: ds });
        return answer({
          action: 'unlink',
          system: ds,
          rev: r.rev,
          actionId: null,
          library: null,
          changes: [],
        });
      }
      default:
        return usage('action is link | check | update | unlink');
    }
  } catch (err) {
    if (err instanceof Usage) return { status: 400, body: { error: err.message, code: 'usage' } };
    throw err;
  }
}
