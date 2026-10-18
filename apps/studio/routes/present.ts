// Present — S3.5 (contract S3-present-session §7, decision maude/v2-S3-present-meta-own-route).
//
// `PATCH /_api/present-meta {file, present?, notes?, expected?}` writes a canvas's Present order, its
// skipped artboards and its speaker notes into the versioned `.meta.json`. It is its OWN route on
// purpose: `/_api/canvas-meta` is reachable from the untrusted canvas origin and by read-only
// sessions (it gates only `layout`), so a `present` lane there would let a planted canvas or a viewer
// reorder a deck. This one is:
//   - MAIN ORIGIN ONLY (`origin: 'main'` — in neither canvas allowlist; the canvas and capture origins
//     answer 404),
//   - refused to a read-only session (`readOnly: 'refused'` → the same 403 as every project write; a
//     Can comment or Can view session is read-only),
//   - schema-checked (present/meta-schema.ts): an unknown body key is a 400, an id that is not an
//     artboard of the canvas a 422, a duplicate in an order a 422,
//   - preserving: every key the patch does not name is kept, and nothing is stamped (`last_modified`
//     belongs to a layout change).
// The write goes through the layout lane's writer (`deps.write` → api `writeCanvasMetaText`: the
// file, the `onMetaChanged` hook → meta `lane.replace`, the cell's announce), so one sheet commit is one
// project action.
//
// S8.8 — `exports` (artboardId → [{format, scale}] | null) is the inspector's per-artboard export sizes
// (`artboardMeta[id].exports`), written the same way and answered back with the rest.
//
// A body with none of `present`, `notes`, `exports` writes nothing and answers the current state with its
// ETag — how the sheet reads what it later sends back as `expected` (the route has no GET: a cell
// classifies it `{ safe: null, unsafe: 'edit' }`).

import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

import { resolveUrlPathUnder } from '../path-containment.ts';
import {
  applyPresentPatch,
  type PresentState,
  parsePresentPatch,
  readExportPresets,
  readPresentState,
} from '../present/meta-schema.ts';
import type { RouteSpec } from './table.ts';

const MAX_BODY = 256 * 1024;
const json = (status: number, body: unknown) =>
  Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

export interface PresentRouteDeps {
  repoRoot: string;
  designRoot: string;
  /** The canvas's artboard ids as its source declares them; `complete: false` when it also renders
   *  artboards a parse cannot list (then only the id grammar is checked). null = unreadable. */
  artboards(srcAbs: string): { ids: string[]; complete: boolean } | null;
  /** Write the versioned meta through the layout lane's writer (file + onMetaChanged + announce). */
  write(file: string, nextText: string, baseText: string | null): Promise<void>;
}

/** The ETag of a sidecar's bytes (`none` = no sidecar yet). */
export function metaEtag(text: string | null): string {
  return text === null
    ? 'none'
    : `m-${createHash('sha256').update(text).digest('hex').slice(0, 20)}`;
}

/** `file` (repo-relative, as `/_api/canvas-meta` takes it) → the canvas source under the design root,
 *  or null. Runtime directories (`_*` segments) are never canvases. */
export function presentCanvasFile(
  deps: Pick<PresentRouteDeps, 'repoRoot' | 'designRoot'>,
  file: string
): string | null {
  if (!file.endsWith('.tsx') || file.includes('\\')) return null;
  const abs = resolveUrlPathUnder(`/${file.replace(/^\/+/, '')}`, deps.repoRoot);
  if (!abs) return null;
  const rel = path.relative(deps.designRoot, abs);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  if (rel.split(path.sep).some((s) => s.startsWith('_') || s.startsWith('.'))) return null;
  try {
    return statSync(abs).isFile() ? abs : null;
  } catch {
    return null;
  }
}

const presentOut = (s: PresentState) =>
  s.order || s.skip.length
    ? { ...(s.order ? { order: s.order } : {}), ...(s.skip.length ? { skip: s.skip } : {}) }
    : null;

export function createPresentRoutes(deps: PresentRouteDeps): RouteSpec[] {
  // One read-modify-write at a time per sidecar: two sheets saving at once must not lose one.
  const chains = new Map<string, Promise<unknown>>();
  const serial = <T>(key: string, run: () => Promise<T>): Promise<T> => {
    const prev = chains.get(key) ?? Promise.resolve();
    const next = prev.then(run, run);
    const tail = next.catch(() => null);
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return next;
  };

  return [
    {
      method: 'PATCH',
      path: '/_api/present-meta',
      origin: 'main',
      readOnly: 'refused',
      handle: async (req) => {
        if (Number(req.headers.get('content-length')) > MAX_BODY)
          return json(413, { error: 'too-large' });
        const text = await req.text();
        if (text.length > MAX_BODY) return json(413, { error: 'too-large' });
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          return json(400, { error: 'bad-json' });
        }
        const parsed = parsePresentPatch(body);
        if (!parsed.ok) return json(400, { error: parsed.error, field: parsed.field });
        const patch = parsed.patch;
        const src = presentCanvasFile(deps, patch.file);
        if (!src) return json(404, { error: 'no-such-canvas' });
        const metaAbs = src.replace(/\.tsx$/, '.meta.json');

        return serial(metaAbs, async () => {
          const currentText = existsSync(metaAbs) ? await Bun.file(metaAbs).text() : null;
          let current: Record<string, unknown> = {};
          if (currentText !== null) {
            let doc: unknown;
            try {
              doc = JSON.parse(currentText);
            } catch {
              doc = undefined;
            }
            // A sidecar we cannot read is never overwritten: that would erase a peer's data.
            if (!doc || typeof doc !== 'object' || Array.isArray(doc))
              return json(422, { error: 'meta-unreadable' });
            current = doc as Record<string, unknown>;
          }
          const etag = metaEtag(currentText);
          if (patch.expected !== undefined && patch.expected !== etag)
            return json(409, { error: 'stale', etag });

          const writes =
            patch.present !== undefined || patch.notes !== undefined || patch.exports !== undefined;
          let nextText = currentText;
          let next = current;
          if (writes) {
            const ab = deps.artboards(src);
            const known = ab?.complete ? new Set(ab.ids) : null;
            const applied = applyPresentPatch(current, patch, known);
            if (!applied.ok) return json(422, { error: applied.error, ids: applied.ids });
            if (applied.changed) {
              next = applied.next;
              nextText = `${JSON.stringify(next, null, 2)}\n`;
              await deps.write(patch.file, nextText, currentText);
            }
          }
          const state = readPresentState(next);
          return json(200, {
            ok: true,
            present: presentOut(state),
            notes: state.notes,
            exports: readExportPresets(next),
            etag: metaEtag(nextText),
          });
        });
      },
    },
  ];
}
