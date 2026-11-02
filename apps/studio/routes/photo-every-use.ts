// /_api/photo-every-use — Apply to every use (S8.15; 12 · ia-photo-steps; contract S8-asset-sidecars §5.1).
//
//   GET  ?asset=assets/<img8>.<ext>
//        200 { ok: true, asset, uses: [{ canvas, name, artboards: string[], own: number }], canApply, reason? }
//            `uses` — the canvases that show the picture (the sheet names each); `own` — how many of its uses
//            there have their own edit (`data-photo-edit`), which Apply takes back to the every-use look.
//            `canApply: false` + `reason` when the session may not change every canvas that uses it (G2).
//   POST { asset, edit }   edit = a v1 PhotoEdit
//        200 { ok: true, path, canvases: [{ canvas, ok, code?, message? }] }
//            writes `assets/<img8>.photo.json` (every use), then runs `photo.every-use` once per canvas whose
//            uses carry their own edit — one undo step per canvas, through the edit route's own writer.
//        403 { ok: false, reason: 'forbidden', message }   the session may not change every canvas (G2)
//        400 / 413                                         a body that is not that
//
// MAIN ORIGIN ONLY, never canvas-safe: it rewrites other canvases, which the untrusted canvas must not do
// (DDR-054/088). The table gate judges the request on its own target (the every-use file for the write, the
// picture for the read), so a canvas-only session reaches the handler only for a picture its canvases show;
// the handler asks the same G2 question again (`writes()` on the every-use file: every referrer editable)
// and per canvas before it edits it. A canvas-only session is named only the canvases it can see, and its
// refusal is the generic G2 line — it never learns which canvas it could not change.

import type { Closure } from '../access/closure.ts';
import { type Access, writes } from '../access/scope.ts';
import { pictureBase } from '../edit-ops/photo-every-use.ts';
import { walkIdElements } from '../element-ids.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 72 * 1024;
/** The G2 refusal copy (V2-1.7): generic, never says why. */
export const EVERY_USE_REFUSAL = 'Ask the owner to change this.';
const ASSET_REL = /^assets\/([0-9a-f]{8,64})\.[A-Za-z0-9]{1,16}$/;

const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface EveryUseRow {
  canvas: string;
  name: string;
  artboards: string[];
  own: number;
}

export interface PhotoEveryUseDeps {
  /** The access this request is judged with (http.ts `accessOf`). */
  access: (req: Request) => Access;
  /** The closure of a session's grants (null for a project session). */
  closure: (access: Access) => Closure | null;
  /** designRoot-relative canvases that use `assets/<name>` (the index's `usedIn`, whole project). */
  usedIn: (assetRel: string) => readonly string[];
  /** A canvas's source (designRoot-relative), or null. */
  read: (canvasRel: string) => string | null;
  /** Does designRoot-relative `rel` exist? */
  exists: (rel: string) => boolean;
  /** Write the every-use edit (`photoStore.savePhotoEdit`). */
  saveEveryUse: (
    asset: string,
    edit: unknown
  ) => Promise<{ ok: true; path: string } | { ok: false; status: number; error: string }>;
  /** One edit-op, through the edit route's own serialized writer (routes/edit.ts `run`). */
  runEditOp: (body: unknown) => Promise<unknown>;
}

/** `assets/<img8>.<ext>` from a param (leading `./` or `/` dropped), or null. */
export function assetRelOf(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const rel = v.trim().replace(/^\.?\/+/, '');
  return ASSET_REL.test(rel) ? rel : null;
}

const everyUseRel = (assetRel: string) =>
  `assets/${(ASSET_REL.exec(assetRel) as RegExpExecArray)[1]}.photo.json`;

/** The uses of the picture in one canvas: the artboards they sit on, and how many have their own edit. */
export function usesIn(source: string, file: string, assetRel: string) {
  const base = pictureBase(assetRel);
  const w = walkIdElements(source, file);
  if (!w.ok || !base) return { artboards: [] as string[], own: 0, count: 0 };
  const labels = new Map<string, string>();
  for (const e of w.elements)
    if (e.tag === 'DCArtboard' && e.artboard)
      labels.set(e.artboard, e.attrs.find(([k]) => k === 'label')?.[1] || e.artboard);
  const boards = new Set<string>();
  let own = 0;
  let count = 0;
  for (const e of w.elements) {
    const file = e.attrs.find(
      ([k]) => k === 'src' || k === 'href' || k === 'xlinkHref' || k === 'data-image-tile'
    )?.[1];
    if (!file || pictureBase(file) !== base) continue;
    count++;
    if (e.artboard) boards.add(labels.get(e.artboard) ?? e.artboard);
    if (e.attrs.some(([k]) => k === 'data-photo-edit')) own++;
  }
  return { artboards: [...boards], own, count };
}

/**
 * The two specs. They are always in the table (the route scrapers read it); `get` answers the wiring, and a
 * studio built without it answers 404 like any route it does not serve.
 */
export function createPhotoEveryUseRoutes(
  get: () => Omit<PhotoEveryUseDeps, 'runEditOp'> | undefined,
  runEditOp: PhotoEveryUseDeps['runEditOp']
): RouteSpec[] {
  const wired = (): PhotoEveryUseDeps | null => {
    const d = get();
    return d ? { ...d, runEditOp } : null;
  };
  const NOT_SERVED = () => json(404, { ok: false, reason: 'not-found' });
  /** The session's view of the picture: the canvases it may be told about, and whether Apply is its to make. */
  const viewOf = (deps: PhotoEveryUseDeps, access: Access, assetRel: string) => {
    const closure = access.can('edit', null) ? null : deps.closure(access);
    const all = deps.usedIn(assetRel);
    const project = access.role !== null;
    const seen = project ? all : all.filter((c) => access.seesCanvas(c));
    const side = everyUseRel(assetRel);
    const exists = deps.exists(side);
    let canApply: boolean;
    if (access.can('edit', null)) canApply = true;
    else if (!closure) canApply = false;
    else
      canApply =
        // the gate judges a canvas-only write on a file the session can see (G2: the closure holds the
        // every-use edit only once it exists), and `writes()` asks for every referrer
        closure.read.has(side) &&
        writes(access, closure, side, { exists }) &&
        all.every((c) => access.can('edit', c));
    return { seen, canApply, closure };
  };

  const rowsOf = (
    deps: PhotoEveryUseDeps,
    assetRel: string,
    canvases: readonly string[]
  ): EveryUseRow[] => {
    const out: EveryUseRow[] = [];
    for (const canvas of canvases) {
      const src = deps.read(canvas);
      if (src === null) continue;
      const u = usesIn(src, canvas, assetRel);
      if (!u.count) continue;
      const name =
        canvas
          .replace(/\.tsx$/i, '')
          .split('/')
          .pop() || canvas;
      out.push({ canvas, name, artboards: u.artboards, own: u.own });
    }
    return out;
  };

  return [
    {
      method: 'GET',
      path: '/_api/photo-every-use',
      origin: 'main',
      readOnly: 'allowed',
      target: async (req) => assetRelOf(new URL(req.url).searchParams.get('asset')),
      handle: async (req) => {
        const deps = wired();
        if (!deps) return NOT_SERVED();
        const assetRel = assetRelOf(new URL(req.url).searchParams.get('asset'));
        if (!assetRel) return json(400, { ok: false, reason: 'bad-asset' });
        const access = deps.access(req);
        const { seen, canApply, closure } = viewOf(deps, access, assetRel);
        // a canvas-only session asks only about a picture its canvases show (the gate already said so)
        if (access.role === null && !closure?.read.has(assetRel))
          return json(404, { ok: false, reason: 'not-found' });
        return json(200, {
          ok: true,
          asset: assetRel,
          uses: rowsOf(deps, assetRel, seen),
          canApply,
          ...(canApply ? {} : { reason: EVERY_USE_REFUSAL }),
        });
      },
    },
    {
      method: 'POST',
      path: '/_api/photo-every-use',
      origin: 'main',
      readOnly: 'refused',
      // the every-use edit is the file this write lands: the gate's G2 rule (every referrer) judges it
      target: async (req) => {
        try {
          const rel = assetRelOf(((await req.clone().json()) as { asset?: unknown })?.asset);
          return rel ? everyUseRel(rel) : null;
        } catch {
          return null;
        }
      },
      handle: async (req) => {
        const deps = wired();
        if (!deps) return NOT_SERVED();
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { ok: false, reason: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { ok: false, reason: 'too-large' });
        let body: { asset?: unknown; edit?: unknown };
        try {
          body = JSON.parse(text) ?? {};
        } catch {
          return json(400, { ok: false, reason: 'bad-json' });
        }
        const assetRel = assetRelOf(body.asset);
        if (!assetRel) return json(400, { ok: false, reason: 'bad-asset' });
        if (!body.edit || typeof body.edit !== 'object' || Array.isArray(body.edit))
          return json(400, { ok: false, reason: 'bad-edit' });
        const access = deps.access(req);
        const { canApply } = viewOf(deps, access, assetRel);
        if (!canApply)
          return json(403, { ok: false, reason: 'forbidden', message: EVERY_USE_REFUSAL });
        const saved = await deps.saveEveryUse(assetRel, body.edit);
        if (!saved.ok)
          return json(saved.status, { ok: false, reason: 'bad-edit', message: saved.error });
        const canvases: Array<{ canvas: string; ok: boolean; code?: string; message?: string }> =
          [];
        for (const row of rowsOf(deps, assetRel, deps.usedIn(assetRel))) {
          if (!row.own) continue;
          const r = (await deps.runEditOp({
            file: row.canvas,
            op: 'photo.every-use',
            targets: [],
            params: { asset: assetRel },
          })) as { ok?: boolean; code?: string; message?: string } | null;
          canvases.push(
            r?.ok
              ? { canvas: row.canvas, ok: true }
              : {
                  canvas: row.canvas,
                  ok: false,
                  ...(r?.code ? { code: r.code } : {}),
                  ...(r?.message ? { message: r.message } : {}),
                }
          );
        }
        return json(200, { ok: true, path: saved.path, canvases });
      },
    },
  ];
}
