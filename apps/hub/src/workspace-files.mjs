// Doc → files: the DECISION half of the server-side workspace agent.
// Cloud Phase 16 Task 1. Pure — no fs, no git, no network, no clock.
//
// The split is DDR-196 §1, and here it earns itself twice over:
//
//   1. "which bytes belong in which file" is the part that can silently
//      corrupt a tenant's work, and it is exactly the part that is cheap to
//      test exhaustively when nothing around it touches a disk;
//   2. the effects half (workspace-agent.mjs) then has almost no branches
//      left, so reviewing it for "does this ever overwrite something it
//      shouldn't" is a short read rather than a careful one.
//
// WHAT IS AND IS NOT WRITTEN. Only DDR-115 VERSIONED paths:
//
//     <designRoot>/<name>.tsx              the canvas body
//     <designRoot>/<name>.meta.json        shared meta, local keys preserved
//     <designRoot>/<name>.css              the sibling stylesheet, when present
//     <designRoot>/<name>.annotations.json the draw layer (DDR-242 board)
//
// Comments are deliberately absent. They live in `_comments/`, which is
// runtime state and gitignored — writing them here would put a per-machine
// artifact into a tenant's permanent history.

import { replicaBoardText } from '../../studio/annotations/replica.ts';
import { mergeSharedMetaIntoLocal } from './meta-merge.mjs';

/**
 * Y.Doc shared-type names. Mirrors `Y_SYNC_TYPES` / `Y_TYPES` in
 * apps/studio/sync/codec.ts + apps/studio/collab/persistence.ts.
 *
 * Duplicated rather than imported because this module must load under the
 * hub's plain-Node runtime with no studio source tree present. The drift that
 * duplication invites is closed by a test that fails the moment the studio's
 * constants and these disagree — see test/workspace-files.test.mjs.
 */
export const DOC_TYPES = {
  html: 'html',
  css: 'css',
  meta: 'meta',
  annotations: 'annotations',
  /** Sync-internal bookkeeping (Y.Map). Never written to disk — the agent reads
   *  `path` out of it to learn where a canvas it has never seen belongs. */
  syncMeta: 'syncMeta',
};

// WHERE A CANVAS THE CHECKOUT HAS NEVER SEEN GOES is deliberately NOT decided
// here any more. `defaultBodyPath()` used to answer it — flat, at the design
// root — and its comment promised that "a desktop peer, which knows the real
// path, will move it on its next sync". Nothing ever did: the studio's twin
// comment deferred right back, and the two together described a hand-off that
// did not exist. Worse, a file at the design root is inside no `canvasGroups`
// entry, so the tree never listed it and it never synced onward.
//
// The answer now lives in `studio/sync/canvas-path.ts` (imported by
// workspace-agent.mjs, copied into the image by the Dockerfile), where both
// receivers share it — because two spellings of this decision is exactly how
// the hand-off came to be imaginary.

/**
 * Slug for a canvas path, relative to the design root.
 *
 * Mirrors `slugFor()` in apps/studio/sync/index.ts and `api.fileSlug()`. The
 * transform is LOSSY on purpose (`ui/Foo.tsx` and `ui-foo.tsx` collapse to the
 * same slug) — it predates this module and the doc namespace is built from it,
 * so reproducing it exactly is the requirement, not improving it.
 */
export function canvasSlug(relPath) {
  return String(relPath)
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/\//g, '-')
    .replace(/\s+/g, '_')
    .replace(/\.(tsx|html)$/i, '')
    .replace(/^\.+/, '')
    .toLowerCase();
}

/**
 * Build slug → body-path index from the paths already in the checkout.
 *
 * THIS IS WHY THE CELL KEEPS A CHECKOUT. A document name carries only the
 * lossy slug, so the doc alone cannot say whether `ui-foo` belongs at
 * `ui/Foo.tsx` or `ui-foo.tsx`. The working tree is the authority on that, and
 * consulting it is what stops the agent from silently relocating a tenant's
 * file to a flattened path on the first server-side commit.
 *
 * @param {string[]} relPaths paths relative to the design root
 * @returns {Map<string, string>} slug → body path relative to the design root
 */
export function indexCanvasPaths(relPaths) {
  const index = new Map();
  for (const raw of relPaths) {
    const rel = String(raw).replace(/\\/g, '/');
    if (!/\.(tsx|html)$/i.test(rel)) continue;
    // `_history/`, `_trash/`, `_canvas-state/` … are runtime state (DDR-115).
    if (rel.split('/').some((seg) => seg.startsWith('_'))) continue;
    const slug = canvasSlug(rel);
    const existing = index.get(slug);
    // Deterministic on collision: shortest path, then lexicographic. An
    // arbitrary winner would make the agent's output depend on readdir order,
    // and a history that differs between two identical cells is worse than a
    // history that picked the "wrong" one consistently.
    if (
      !existing ||
      rel.length < existing.length ||
      (rel.length === existing.length && rel < existing)
    ) {
      index.set(slug, rel);
    }
  }
  return index;
}

/**
 * Sibling paths derived from a body path.
 *
 * `.meta.json` and `.css` really are SIBLINGS — `ui/Card.tsx` → `ui/Card.css`.
 * The annotations sidecar is NOT, and that asymmetry is the studio's, not ours:
 * it keys annotations by the flat canvas SLUG at the design root
 * (`ui/Card.tsx` → `ui-card.annotations.json`).
 *
 * Deriving it as a sibling made the hub write a file NOBODY READS, and — worse
 * — commit that one while the real sidecar stayed untracked, so the junk path
 * is what would reach the tenant's GitHub mirror.
 *
 * THE TWIN TO MATCH IS `slugFor()` in `apps/studio/sync/index.ts` — the writer
 * that actually puts this file on disk — and `canvasSlug` reproduces it
 * character for character. It is NOT quite `api.ts`'s `canvasSlugFromRel()`,
 * which additionally `decodeURIComponent`s because its input is a URL
 * parameter rather than a disk path. For any real on-disk name the three agree;
 * they diverge only for a filename containing a literal `%`-hex sequence, where
 * the HTTP lane would decode and the disk lanes would not. That divergence
 * predates this function and lives between those two studio helpers — noted
 * here so the next reader does not "fix" this one into disagreeing with the
 * writer it exists to match.
 */
export function siblingPaths(bodyRel) {
  const stem = bodyRel.replace(/\.(tsx|html)$/i, '');
  // `canvasSlug` strips leading dots, so an all-dots name (`..`, `.tsx`) slugs
  // to the empty string and would put every such canvas on one shared, hidden
  // `.annotations.json`. Contained either way, but the stem keeps them distinct
  // and keeps a dotfile out of the tenant's design root.
  const slug = canvasSlug(bodyRel);
  return {
    meta: `${stem}.meta.json`,
    css: `${stem}.css`,
    annotations: `${slug || stem}.annotations.json`,
  };
}

/**
 * Read the four synced lanes out of a Y.Doc.
 *
 * Takes the doc rather than fetching it so this stays testable with a plain
 * object stand-in, and so the caller owns the yjs dependency.
 */
export function readDocContent(doc) {
  const text = (name) => {
    const t = doc.getText(name).toString();
    return t.length > 0 ? t : null;
  };
  // DDR-242 — the per-element replica, validated on read (the doc is
  // peer-written; this is the hub's own disk write, so it must never carry an
  // unvalidated value — the pre-v2 path wrote the raw doc string).
  const board = replicaBoardText(doc);
  // UNTRUSTED. `path` is whatever a peer put on the wire; the agent must put it
  // through `validateCanvasPath` before it can become a directory. Surfaced
  // here rather than read inline so the one place that reads a doc stays the
  // one place that reads a doc.
  const path = doc.getMap(DOC_TYPES.syncMeta).get('path');
  // The move protocol (studio codec stampMovedTo): a non-null `movedTo` means
  // this document is RETIRED — its canvas lives on at that path in a DIFFERENT
  // document. UNTRUSTED like `path`; consumers only need the null/non-null fact.
  const movedTo = doc.getMap(DOC_TYPES.syncMeta).get('movedTo');
  return {
    body: text(DOC_TYPES.html),
    css: text(DOC_TYPES.css),
    meta: text(DOC_TYPES.meta),
    annotations: board,
    path: typeof path === 'string' && path.length > 0 ? path : null,
    movedTo: typeof movedTo === 'string' && movedTo.length > 0 ? movedTo : null,
  };
}

/**
 * Decide the write set for one canvas.
 *
 * @param {object} args
 * @param {string} args.bodyRel      body path relative to the design root
 * @param {object} args.content      from readDocContent()
 * @param {object} args.onDisk       current bytes, keyed like siblingPaths() + `body`; null when absent
 * @returns {{ relPath: string, text: string }[]} paths relative to the design root
 *
 * Rules, each of which exists because its absence loses or corrupts work:
 *
 *   - A null lane is NOT a deletion. An unset Y.Text means "this doc never
 *     carried one", which is the normal state for a canvas with no `.css` and
 *     no annotations. Treating it as a delete would have the cell erase files
 *     the moment a peer connected with a partially-populated doc.
 *   - An unchanged lane is skipped, so a store event that changed only the
 *     body does not restamp the meta's mtime and drag it into the commit.
 *   - Meta is MERGED, never replaced: the doc carries the shared subset only,
 *     and the local keys (viewport, last_modified, syncable) are per-machine.
 *     Overwriting would reset the tenant's camera on every server commit and —
 *     far worse — drop `syncable: false`, which is a security opt-out.
 */
export function filesForCanvas({ bodyRel, content, onDisk = {} }) {
  const sib = siblingPaths(bodyRel);
  const out = [];

  const put = (relPath, text, current) => {
    if (text === null || text === undefined) return;
    if (current === text) return;
    out.push({ relPath, text });
  };

  put(bodyRel, content.body, onDisk.body ?? null);
  put(sib.css, content.css, onDisk.css ?? null);
  put(sib.annotations, content.annotations, onDisk.annotations ?? null);

  if (content.meta !== null && content.meta !== undefined) {
    const merged = mergeSharedMetaIntoLocal(onDisk.meta ?? null, content.meta);
    // null means the doc's shared meta did not parse. Skipping is the only
    // safe answer: writing a partial or empty `.meta.json` over a good one
    // would drop the canvas's layout.
    if (merged !== null) put(sib.meta, merged, onDisk.meta ?? null);
  }

  return out;
}

/**
 * Which of a canvas's lanes may be STAGED FOR COMMIT this pass.
 *
 * Not the same question as `filesForCanvas` ("what must I write?"), because
 * under cell live pairing (DDR-213) the studio child's projector writes the
 * same bytes from the same doc and usually wins the race — so the hub writes
 * nothing and, if committing followed writing, would commit nothing. The
 * tenant's work would sit on the cell's disk and never enter its history.
 *
 * It lives HERE, beside `filesForCanvas`, because the two must not drift: any
 * gate the write path applies, the commit path has to apply too. The meta lane
 * is the one with teeth — `filesForCanvas` refuses to write a `.meta.json`
 * whose shared half did not parse, and staging it anyway would commit
 * unvalidated bytes into the tenant's history and onward to their GitHub
 * mirror, defeating the exact refusal the writer exists to make.
 *
 * Whether a staged lane is really a CHANGE is git's call, not ours: the caller
 * stages these paths and `commitCycle` reports `nothing-to-commit` on an empty
 * index, so an unchanged lane costs one `git add` and produces no empty commit.
 *
 * @returns {string[]} paths relative to the design root
 */
export function committableLanes({ bodyRel, content, onDisk = {} }) {
  const sib = siblingPaths(bodyRel);
  const out = [];

  // Present in the doc AND already on disk — whoever put it there.
  const take = (relPath, inDoc, onDiskText) => {
    if (inDoc === null || inDoc === undefined) return;
    if (onDiskText === null || onDiskText === undefined) return;
    out.push(relPath);
  };

  take(bodyRel, content.body, onDisk.body ?? null);
  take(sib.css, content.css, onDisk.css ?? null);
  take(sib.annotations, content.annotations, onDisk.annotations ?? null);

  if (content.meta !== null && content.meta !== undefined && onDisk.meta) {
    // The SAME gate `filesForCanvas` applies before writing meta.
    if (mergeSharedMetaIntoLocal(onDisk.meta, content.meta) !== null) out.push(sib.meta);
  }

  return out;
}

/**
 * Author identity for a commit.
 *
 * The editing human, never the machine — `git blame` on a design should answer
 * "who designed this", which is the entire reason the cell keeps history at
 * all (autocommit.ts rule 2). An unidentified edit gets a stable placeholder
 * rather than being silently attributed to the bot.
 */
/**
 * A hub session label (`mintLabel()` in auth-routes.mjs: `u-<12 hex>`). It
 * identifies a SESSION, not a person, and it is regenerated on every login —
 * so a history attributed to it says "u-1e166564e89d designed this", which is
 * both unreadable and different tomorrow for the same human.
 */
const SESSION_LABEL = /^u-[0-9a-f]{8,}$/;

export function attributionFor(user) {
  let name = typeof user?.name === 'string' ? user.name.trim() : '';
  const email = typeof user?.email === 'string' ? user.email.trim() : '';
  if (email && SESSION_LABEL.test(name)) name = '';
  if (!name && !email) return null;
  const safeName = name || email.split('@')[0];
  // A synthesized address is marked as such. Inventing a plausible-looking
  // real address would make history claim more than it knows.
  const safeEmail = email || `${canvasSlug(safeName) || 'peer'}@workspace.invalid`;
  return { name: safeName, email: safeEmail };
}
