// What is on this Mac, and what is still coming — S11.4 (05 · es-arriving, es-offline-uncached).
//
// A READ MODEL, and only that. It folds three things the runtime already holds — the hub's last
// listing (`remote-docs.ts`, kept by `sync/index.ts` exactly as the pull lane sees it), the slugs
// that will never come (tombstoned, retired, refused) and the connection state — against the
// canvases the project index lists on disk. It never writes, never fetches, never schedules a pull:
// asking it a thousand times costs a thousand set lookups and zero requests.
//
// "LOCAL" IS THE INDEX'S ANSWER, NOT THE RUNTIME'S. A pulled document has a provider (and a
// descriptor) before its body is on disk; a file-plane copy lands by tmp + rename. The one fact the
// person can act on is "the panel lists it", so a canvas is present exactly when the index lists
// its path — the same scan the Canvases panel draws. That is what keeps this from racing the file
// plane: the model can never call a canvas present that the panel cannot open, and once the panel
// can open it nothing here can call it missing.
//
// THREE RULES, each pinned by `test/sync-availability.test.ts`:
//   1. Before the first listing of this boot, nothing is "not on this Mac". The hub has not been
//      asked yet; an unasked question is not an answer (phase `waiting`, no rows).
//   2. A failed refresh never erases what a previous listing said (the runtime keeps the last good
//      one, like `noteHubListing`), so a canvas arriving mid-listing goes arriving → present and
//      never passes through missing.
//   3. A canvas-only session sees only canvases it was granted — names, paths AND the counts
//      (decision `v2-S9.10-derived-index-seq`: counts come only from visible rows). A pending
//      canvas's path for such a session is its own grant's path, never the hub's.

import type { Access } from '../access/scope.ts';
import { canvasSlugFromRel } from '../canvas-slug.ts';
import type { SyncState } from './connection-state.ts';
import { type RemoteDoc, slugFromDocName } from './remote-docs.ts';

/** What the sync runtime hands the model. Structural: no runtime import in this file. */
export interface AvailabilitySource {
  /** The last listing of this boot (THIS peer's key space is decided by `docNameFor`). `null` = the
   *  hub has not answered yet this boot. A failed refresh leaves the previous listing standing. */
  listing: readonly Pick<RemoteDoc, 'name'>[] | null;
  /** Slugs that are not coming: deleted by the project, retired by a move, or refused a pull. */
  gone: ReadonlySet<string>;
  /** The wire name this peer would open for a slug — the pull lane's own key space. */
  docNameFor(slug: string): string;
  /** Where a listed document lands, designRoot-relative. `fromPath` = the path is the document's
   *  own (manifest / syncMeta), not the slug fallback. */
  relFor(docName: string, slug: string): { rel: string; fromPath: boolean } | null;
  /** The connection monitor's state, or null before it has spoken. */
  state: SyncState | null;
}

export type CanvasAvailability = 'present' | 'arriving' | 'not-local';

export type AvailabilityPhase =
  /** Not linked to a hub: everything there is, is here. */
  | 'solo'
  /** Linked, the hub has not answered yet this boot — no remote rows at all (rule 1). */
  | 'waiting'
  /** Listed canvases are still coming down. */
  | 'arriving'
  /** Offline, with listed canvases that never came down. */
  | 'offline'
  /** Every listed canvas is on this Mac. */
  | 'complete';

export interface PendingCanvas {
  /** designRoot-relative path, or null when the runtime cannot place it (counted, never drawn). */
  path: string | null;
  /** The file name without `.tsx`, or null with the path. */
  name: string | null;
  state: Exclude<CanvasAvailability, 'present'>;
}

export interface Availability {
  v: 1;
  phase: AvailabilityPhase;
  /** Canvases of the project on this Mac (that this session may see). */
  done: number;
  /** done + pending (that this session may see). */
  total: number;
  /** Listed ∖ local ∖ gone, sorted by path (pathless last). Capped at `MAX_PENDING_ROWS`. */
  pending: PendingCanvas[];
}

/** Rows drawn per answer. Names are hub-supplied; the count stays exact, the list is bounded. */
export const MAX_PENDING_ROWS = 1000;

export interface AvailabilityInput {
  /** Null when the project is not linked (or the runtime is not running). */
  source: AvailabilitySource | null;
  /** The canvases the project index lists on disk, repo- or designRoot-relative. */
  local: readonly string[];
  designRel: string;
  /** The session. Null = the local owner (no proxy in front: the desktop itself). */
  access?: Access | null;
}

interface View {
  sees(rel: string): boolean;
  /** For a canvas-only session: the granted path whose slug is `slug`, or null. */
  grantFor(slug: string): string | null;
  full: boolean;
}

function viewOf(access: Access | null | undefined, designRel: string): View {
  if (!access) return { full: true, sees: () => true, grantFor: () => null };
  if (access.role !== null) {
    const ok = access.can('read', null);
    return { full: ok, sees: () => ok, grantFor: () => null };
  }
  if (!access.canvasOnly) return { full: false, sees: () => false, grantFor: () => null };
  const granted = access.grants.filter((g) => access.can('read', g.c)).map((g) => g.c);
  const bySlug = new Map(granted.map((c) => [canvasSlugFromRel(c, designRel), c] as const));
  return {
    full: false,
    sees: (rel) => access.seesCanvas(rel) && access.can('read', rel),
    grantFor: (slug) => bySlug.get(slug) ?? null,
  };
}

/** `.design/ui/a.tsx` / `ui/a.tsx` → `ui/a.tsx`. */
function designRelative(p: string, designRel: string): string {
  const prefix = `${designRel.replace(/^\/+|\/+$/g, '')}/`;
  const s = String(p).replace(/^\/+/, '');
  return s.startsWith(prefix) ? s.slice(prefix.length) : s;
}

const nameOf = (rel: string): string => (rel.split('/').pop() ?? rel).replace(/\.(tsx|html)$/i, '');

const isOffline = (s: SyncState | null): boolean => s === 'offline' || s === 'offline-long';

/** Fold the runtime's state against the index. Total and pure. */
export function computeAvailability(input: AvailabilityInput): Availability {
  const { source, designRel } = input;
  const view = viewOf(input.access, designRel);
  const localRels = input.local.map((p) => designRelative(p, designRel)).filter(view.sees);
  const localPaths = new Set(localRels);
  const localSlugs = new Set(localRels.map((r) => canvasSlugFromRel(r, designRel)));
  const done = localRels.length;

  if (!source) return { v: 1, phase: 'solo', done, total: done, pending: [] };
  if (source.listing === null) return { v: 1, phase: 'waiting', done, total: done, pending: [] };

  const offline = isOffline(source.state);
  const state: PendingCanvas['state'] = offline ? 'not-local' : 'arriving';
  const seen = new Set<string>();
  const pending: PendingCanvas[] = [];
  for (const doc of source.listing) {
    const slug = slugFromDocName(doc.name);
    if (!slug || seen.has(slug)) continue;
    // The pull lane's key space: a listing token is often `scope: '*'`, so another branch's
    // `hero` is listed too and is NOT this project's canvas (hub-listing.ts).
    if (source.docNameFor(slug) !== doc.name) continue;
    seen.add(slug);
    if (localSlugs.has(slug) || source.gone.has(slug)) continue;
    let path: string | null;
    if (view.full) {
      // The pull lane's own target — the document's path when it carries one, else the fallback
      // inside a canvas group (`pullTargets`): where the file will land, so where the row belongs.
      const r = source.relFor(doc.name, slug);
      path = r ? designRelative(r.rel, designRel) : null;
    } else {
      // Fail closed: a canvas-only session learns of a pending canvas only through its own grant.
      path = view.grantFor(slug);
      if (path === null) continue;
    }
    if (path !== null && localPaths.has(path)) continue;
    pending.push({ path, name: path === null ? null : nameOf(path), state });
  }
  pending.sort((a, b) =>
    a.path === b.path ? 0 : a.path === null ? 1 : b.path === null ? -1 : a.path < b.path ? -1 : 1
  );
  const total = done + pending.length;
  const phase: AvailabilityPhase =
    pending.length === 0 ? 'complete' : offline ? 'offline' : 'arriving';
  return { v: 1, phase, done, total, pending: pending.slice(0, MAX_PENDING_ROWS) };
}

/** One canvas's answer — what the viewport asks before it tries to load a module that is not there. */
export function availabilityOf(
  model: Availability,
  rel: string,
  local: readonly string[],
  designRel: string
): CanvasAvailability | 'unknown' {
  const want = designRelative(rel, designRel);
  if (local.some((p) => designRelative(p, designRel) === want)) return 'present';
  const row = model.pending.find((p) => p.path === want);
  return row ? row.state : 'unknown';
}
