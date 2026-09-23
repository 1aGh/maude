// What the PROJECT holds, versus what this machine happens to carry.
//
// The sync runtime opens one provider per canvas found on LOCAL disk, and Yjs
// has no enumeration — so a document that exists only on the hub is invisible
// to a peer by construction. A desktop with 72 of a project's 75 canvases syncs
// 72, reports "72/72 synced", and is accurate about the wrong universe. The
// user-visible form of that was "I pressed Open in Maude and nothing happened":
// three real canvases (welcome, how-to-use, how-to-make-video) lived only in
// the cloud and could never arrive.
//
// This module asks the hub what it has (`GET /api/documents`, scope-bound to
// the same token the sync uses) and diffs it against the local set, so the
// runtime can say which side is missing what.
//
// SYNC IS BIDIRECTIONAL AND COMPLETE. A project you have been granted access to
// is a project you get — all of it, both directions. Local canvases go up (they
// always did); hub-only documents now come DOWN, materialised as real files.
//
// What that trades, stated plainly: a hub can create files in your design root,
// where before it could only update canvases you already had (DDR-054 treats
// hub-pushed content as untrusted). That is accepted deliberately — the hub is
// the project, the caller is authenticated, and a partial project is not a
// project. The one guard kept is containment: a document NAME can never place a
// file outside the design root. That is not policy filtering, it is the
// difference between writing your project and writing your filesystem.

import { type CanvasGroupLike, resolveCanvasBodyRel } from './canvas-path.ts';

/** One document as the hub reports it. */
export interface RemoteDoc {
  name: string;
  bytes: number;
}

/** One deletion the project has stated — see the hub's `tombstones.mjs`. */
export interface RemoteTombstone {
  name: string;
  deletedAt: number;
}

/**
 * The whole listing: what the project HAS, and what it has DELETED.
 *
 * Both halves are needed, and for symmetric reasons. Presence alone made a
 * hub-only document authority to create a local file — correct, and the reason
 * a project arrives in full. Absence alone was un-representable, so a delete was
 * indistinguishable from "this peer has not discovered it yet" and got refilled
 * on the next tick. One request carries both.
 */
export interface RemoteListing {
  documents: RemoteDoc[];
  /** Empty against a hub older than the tombstone route — never null, because
   *  "this hub cannot say" and "nothing was deleted" call for the same
   *  behaviour: change nothing on disk. */
  tombstones: RemoteTombstone[];
}

export interface RemoteDocDiff {
  /** Documents on both sides — the ones actually syncing. */
  shared: string[];
  /** On the hub, absent here. The project has them; this machine cannot get them. */
  hubOnly: RemoteDoc[];
  /** Here, not on the hub yet — normal for a canvas this peer just created. */
  localOnly: string[];
  /** Null when the hub could not be asked (old hub, offline, refused). */
  reachable: boolean;
}

/** How long to wait for the listing. Never blocks a sync — see `fetchRemoteDocs`. */
const LIST_TIMEOUT_MS = 6000;

/**
 * Ask the hub which documents this token may open.
 *
 * Returns null on ANY failure — an old hub without the route, a refused token,
 * a network blip. A peer that cannot get the listing must still sync: this is a
 * reporting improvement, and making it load-bearing would trade a real feature
 * for a nicer message.
 */
export async function fetchRemoteListing(
  hubUrl: string,
  token: string,
  fetchImpl: typeof fetch = fetch
): Promise<RemoteListing | null> {
  try {
    const base = hubUrl.replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/api/documents`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { documents?: unknown; tombstones?: unknown };
    if (!Array.isArray(body?.documents)) return null;
    const documents = body.documents
      .filter(
        (d): d is RemoteDoc =>
          !!d && typeof (d as RemoteDoc).name === 'string' && (d as RemoteDoc).name.length > 0
      )
      .map((d) => ({ name: d.name, bytes: Number(d.bytes) || 0 }));
    // A hub without the route omits the field entirely; a hostile one could send
    // anything. Both land on "no deletions", which changes nothing on disk — the
    // safe direction for a signal whose only effect is to REMOVE local files.
    const tombstones = Array.isArray(body?.tombstones)
      ? (body.tombstones as unknown[])
          .filter(
            (t): t is RemoteTombstone =>
              !!t &&
              typeof (t as RemoteTombstone).name === 'string' &&
              (t as RemoteTombstone).name.length > 0
          )
          .map((t) => ({ name: t.name, deletedAt: Number(t.deletedAt) || 0 }))
      : [];
    return { documents, tombstones };
  } catch {
    return null;
  }
}

/**
 * Tell the hub a document is gone (`DELETE`) or exists again (`POST`).
 *
 * BEST-EFFORT, LIKE EVERY OTHER HUB CALL HERE. A hub that is old, offline or
 * refusing means the local delete still happened — the canvas is in `_trash/`
 * and this peer has released it. What is lost is only the PROPAGATION, and the
 * peer retries the statement on its next poll for anything it still sees on the
 * hub but no longer has on disk. Returning false rather than throwing keeps a
 * failed network call from turning a successful local delete into an error the
 * user has to interpret.
 */
export async function stateDocumentGone(
  hubUrl: string,
  token: string,
  docName: string,
  opts: { revive?: boolean; fetchImpl?: typeof fetch } = {}
): Promise<boolean> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  try {
    const base = hubUrl.replace(/\/+$/, '');
    const res = await fetchImpl(`${base}/api/documents/${encodeURIComponent(docName)}`, {
      method: opts.revive ? 'POST' : 'DELETE',
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(LIST_TIMEOUT_MS),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Diff the hub's documents against the ones this peer syncs.
 *
 * `localDocNames` must already be in WIRE form (`docNameFor(slug)`), not raw
 * slugs — comparing a namespaced hub against flat local names would report
 * every document as missing on both sides, which is the exact failure the
 * namespace exists to prevent, arrived at from the reporting side.
 */
export function diffRemoteDocs(
  localDocNames: readonly string[],
  remote: RemoteDoc[] | null
): RemoteDocDiff {
  if (remote === null) {
    return { shared: [], hubOnly: [], localOnly: [...localDocNames], reachable: false };
  }
  const local = new Set(localDocNames);
  const remoteNames = new Set(remote.map((d) => d.name));
  return {
    shared: [...local].filter((n) => remoteNames.has(n)).sort(),
    hubOnly: remote.filter((d) => !local.has(d.name)).sort((a, b) => a.name.localeCompare(b.name)),
    localOnly: [...local].filter((n) => !remoteNames.has(n)).sort(),
    reachable: true,
  };
}

/**
 * One line a person can act on.
 *
 * Deliberately names the documents being PULLED rather than only what already
 * matched: "72 synced" was true and useless, because the number is drawn from
 * the local file set and can never express what the project holds beyond it.
 */
export function describeRemoteDiff(diff: RemoteDocDiff): string | null {
  if (!diff.reachable) return null;
  if (diff.hubOnly.length === 0) return null;
  const n = diff.hubOnly.length;
  const names = diff.hubOnly
    .slice(0, 3)
    .map((d) => d.name)
    .join(', ');
  return `pulling ${n} canvas${n === 1 ? '' : 'es'} down from the project (${names}${n > 3 ? ', …' : ''}).`;
}

/**
 * The local slug a hub document name maps to.
 *
 * Namespaced names (`ws/<workspace>/<branch>/<slug>` — DDR-192 §5) carry the
 * slug in the last segment; a legacy flat name IS the slug. Returns null for
 * anything that does not survive the charset the hub itself enforces on
 * `documentName`, so a crafted name cannot become a path component.
 */
export function slugFromDocName(docName: string): string | null {
  const raw = String(docName ?? '');
  // Validate the WHOLE name against the two shapes a hub may legitimately use,
  // never just its last segment. Taking the tail of an arbitrary string would
  // accept `../../etc/passwd` as `passwd`: contained by the check below, and
  // still a file this project never asked for, created from a name that should
  // have been refused outright. A component is `[A-Za-z0-9_-]` — no dots (so no
  // traversal and no extension smuggling), no spaces.
  const COMPONENT = '[A-Za-z0-9_-]{1,120}';
  const FLAT = new RegExp(`^${COMPONENT}$`);
  const NAMESPACED = new RegExp(`^ws/${COMPONENT}/${COMPONENT}/(${COMPONENT})$`);
  if (FLAT.test(raw)) return raw.toLowerCase();
  const ns = NAMESPACED.exec(raw);
  return ns ? ns[1].toLowerCase() : null;
}

/**
 * The local slugs a tombstone set names — validated, deduplicated, safe.
 *
 * A tombstone is the one hub-supplied signal whose effect is to REMOVE work from
 * a person's disk, so it runs through exactly the same name gate a pull does
 * (`slugFromDocName`: whole-name match, no dots, no traversal, no extension
 * smuggling) and anything that does not survive is dropped silently. A hub
 * cannot name a file this way that it could not already have created.
 *
 * `known` is the set of slugs this peer actually holds; a tombstone for anything
 * else is not an error, just nothing to do — that is the normal steady state
 * once both sides have converged.
 */
export function tombstonedSlugs(
  tombstones: readonly RemoteTombstone[],
  known: Iterable<string>
): string[] {
  const have = new Set(known);
  const out = new Set<string>();
  for (const t of tombstones) {
    const slug = slugFromDocName(t.name);
    if (slug && have.has(slug)) out.add(slug);
  }
  return [...out].sort();
}

export interface PullTarget {
  slug: string;
  docName: string;
  /** Absolute path the body will be written to. */
  bodyAbs: string;
  /** True when the path came from the document's own `syncMeta.path` and was
   *  accepted — false when it was absent or refused and the fallback applied. */
  fromPath: boolean;
}

export interface PullTargetOptions {
  /** Design root, relative to the repo root. Rule 7 of the path check. */
  designRel?: string;
  /** Declared canvas groups — the fallback places the body inside one. */
  canvasGroups?: readonly CanvasGroupLike[];
  /** Fresh-link relaxation — see `validateCanvasPath`. */
  allowUndeclaredGroup?: boolean;
  /**
   * The document's own `syncMeta.path`, if it is already known.
   *
   * USUALLY NULL AT THIS POINT, and that is not an oversight. The listing
   * (`GET /api/documents`) carries names and byte counts only — the path lives
   * INSIDE the document, so it cannot be resolved until that document has
   * synced. The runtime therefore calls this to get a provisional target, then
   * `resolvePulledTarget` again per document once its doc is populated (see
   * sync/index.ts). Tests pass it directly, which is the whole reason it is a
   * parameter rather than a fetch.
   */
  pathFor?: (docName: string, slug: string) => string | null | undefined;
  /** See `resolvePulledTarget`. */
  realpath?: (p: string) => string;
  /** Called with (slug, reason) when a PRESENT path is refused. */
  onRefused?: (slug: string, reason: string) => void;
}

/**
 * Where a hub-only document lands on disk.
 *
 * It used to be FLAT, directly under the design root, because a slug is lossy —
 * `ui-card` cannot be un-flattened into `ui/Card.tsx` without guessing, and
 * guessing wrong scatters files into directories the user never made. The
 * comment here said a flat file "is trivially moved"; the hub's twin said a
 * desktop peer "will move it on its next sync". Neither was a mechanism, and
 * nothing moved it — and a file at the design root is inside no canvas group,
 * so the tree never listed it and `scanCanvases` never synced it onward.
 *
 * So the path now travels with the document (`syncMeta.path`) and is checked
 * rather than trusted — see `sync/canvas-path.ts` for the eight rules and for
 * why rule 7 is the one that makes it safe. Absent or refused, the fallback
 * still applies, but inside a canvas group.
 *
 * Returns only targets that resolve INSIDE the design root. A document name and
 * a document's path are both hub-controlled input, and this is the last point
 * before a create — so the containment check stays even for a validated path.
 */
export function pullTargets(
  hubOnly: readonly RemoteDoc[],
  designRoot: string,
  join: (...parts: string[]) => string,
  resolve: (p: string) => string,
  sep: string,
  opts: PullTargetOptions = {}
): PullTarget[] {
  const out: PullTarget[] = [];
  // One slug, one target. `slugFromDocName` lowercases, so a hub advertising
  // `Foo`, `foo` and `ws/w/main/foo` yields three targets for ONE file — three
  // providers on the same path, and a `pulled` count that overstates what
  // arrived by a factor the hub chooses.
  const seen = new Set<string>();
  for (const doc of hubOnly) {
    const slug = slugFromDocName(doc.name);
    if (!slug || seen.has(slug)) continue;
    seen.add(slug);
    const target = resolvePulledTarget({
      slug,
      path: opts.pathFor?.(doc.name, slug) ?? null,
      designRoot,
      designRel: opts.designRel,
      canvasGroups: opts.canvasGroups,
      allowUndeclaredGroup: opts.allowUndeclaredGroup,
      join,
      resolve,
      sep,
      realpath: opts.realpath,
      onRefused: opts.onRefused ? (reason) => opts.onRefused?.(slug, reason) : undefined,
    });
    if (!target) continue;
    out.push({ slug, docName: doc.name, ...target });
  }
  return out;
}

/**
 * One document's body path — the whole receiver-side decision, in one call.
 *
 * Separate from `pullTargets` because the runtime needs it TWICE: once from the
 * listing (where no path is known yet, so every target is a fallback) and again
 * per document once that document has synced and its `syncMeta.path` is
 * readable. Both hops go through the same function, so "where does this canvas
 * go" cannot have two answers.
 *
 * Returns null when a present path is refused or containment fails. Only a
 * document with no path may use the legacy slug-derived fallback.
 */
export function resolvePulledTarget(args: {
  slug: string;
  path: unknown;
  designRoot: string;
  designRel?: string;
  canvasGroups?: readonly CanvasGroupLike[];
  allowUndeclaredGroup?: boolean;
  join: (...parts: string[]) => string;
  resolve: (p: string) => string;
  sep: string;
  /**
   * Resolve symlinks on the deepest EXISTING ancestor of a path.
   *
   * `resolve()` is purely lexical — it never follows a symlink — and the
   * receivers create parent directories with `mkdirSync(recursive: true)`, which
   * happily traverses one that already exists. While the only reachable target
   * was `<designRoot>/<slug>.tsx` that only mattered for a symlinked design root
   * (operator-controlled); now the sender picks the directory, so any symlink
   * committed anywhere under a canvas group is a write-outside primitive.
   * Injected rather than imported because this module is dependency-free.
   */
  realpath?: (p: string) => string;
  onRefused?: (reason: string) => void;
}): { bodyAbs: string; fromPath: boolean } | null {
  const { rel, fromPath } = resolveCanvasBodyRel({
    path: args.path,
    slug: args.slug,
    designRel: args.designRel,
    canvasGroups: args.canvasGroups,
    allowUndeclaredGroup: args.allowUndeclaredGroup,
    onRefused: args.onRefused,
  });
  if (args.path !== undefined && args.path !== null && !fromPath) return null;
  const bodyAbs = args.join(args.designRoot, rel);
  // Belt and braces at a create. The validator already refuses everything that
  // could escape lexically; this catches whatever a platform's own `resolve`
  // makes of a string neither of us anticipated.
  const rootResolved = args.resolve(args.designRoot);
  const target = args.resolve(bodyAbs);
  if (target !== rootResolved && !target.startsWith(rootResolved + args.sep)) return null;
  if (args.realpath) {
    const realRoot = args.realpath(rootResolved);
    const realTarget = args.realpath(target);
    if (realTarget !== realRoot && !realTarget.startsWith(realRoot + args.sep)) return null;
  }
  return { bodyAbs, fromPath };
}
