// history/links.ts — S1.18: the stable canvas link resolver (S1 Q6, 11 · pn-deeplink).
//
// A canvas link names the kernel `entry` (store-core `docs.entry`), never a path: the entry survives a
// move or a rename, so a link minted before either still opens the canvas. Three answers:
//   live     the entry's live document → its current designRoot-relative path
//   trashed  no live document carries it, its last effect was a delete still in the shared Trash
//            (S1 Q2: `retired=1 AND moved_to IS NULL`; a cleared item is not "trashed", it is gone)
//   unknown  never here, cleared out of the Trash, or not this session's to see
//
// A canvas-only session (V2-1.7 §5.3, `access/scope.ts`) resolves only the canvases it was granted. Every
// other entry — live elsewhere in the project, trashed, unknown — gets the SAME `unknown` answer, so the
// route is no existence oracle (V2-1.16 L14). The Trash is a project-level view; a canvas-only session never
// learns that an entry is in it.
//
// Pure over a `LinkSource`, which the home answers (`ctx.syncControl.current()`: the local op log or the
// hub's manifest — S5-kernel-foundation §5), so the route never learns which home it asked.

/** The kernel's entry grammar (kernel.mjs `TX_ID`). Anything else names no canvas. */
export const ENTRY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** One manifest row, as both homes give it. */
export interface LinkDoc {
  entry: string;
  /** designRoot-relative (`ui/Hero.tsx`); null while a create is in flight. */
  path: string | null;
  retired: boolean;
}

/** What a home answers for links. `docs()` null = this project has no op log yet (legacy). */
export interface LinkSource {
  docs(): Promise<LinkDoc[] | null>;
  /**
   * Is the entry in the shared Trash right now (cleared items excluded)? A home that cannot say
   * (the hub manifest names no cleared items) omits it, and a retired entry with no live document
   * counts as trashed.
   */
  trashed?(entry: string): Promise<boolean>;
}

/** The part of `Access` (access/scope.ts) the resolver asks. null = a project session. */
export interface LinkScope {
  canvasOnly: boolean;
  seesCanvas(canvas: string): boolean;
}

export type LinkAnswer =
  | { status: 'live'; entry: string; path: string }
  | { status: 'trashed'; entry: string }
  | { status: 'unknown' };

const UNKNOWN: LinkAnswer = Object.freeze({ status: 'unknown' }) as LinkAnswer;

const isCanvasPath = (p: unknown): p is string =>
  typeof p === 'string' && p.length > 0 && p.length <= 1024 && !p.includes('\0');

/** May this session see the canvas at `path`? */
const scoped = (scope: LinkScope | null | undefined, path: string): boolean =>
  !scope?.canvasOnly || scope.seesCanvas(path);

/**
 * Entry → where the canvas is now. null = no op log (the caller falls back to today's path link).
 */
export async function resolveEntry(
  source: LinkSource | null | undefined,
  entry: string,
  scope?: LinkScope | null
): Promise<LinkAnswer | null> {
  if (!ENTRY_RE.test(entry)) return UNKNOWN;
  const docs = source ? await source.docs() : null;
  if (!docs) return null;
  const rows = docs.filter((d) => d && d.entry === entry);
  const live = rows.find((d) => !d.retired && isCanvasPath(d.path));
  if (live)
    return scoped(scope, live.path as string)
      ? { status: 'live', entry, path: live.path as string }
      : UNKNOWN;
  // A canvas-only session never sees the Trash (and so never learns an entry is in it).
  if (scope?.canvasOnly || rows.length === 0) return UNKNOWN;
  const inTrash = source?.trashed ? await source.trashed(entry) : rows.every((d) => d.retired);
  return inTrash ? { status: 'trashed', entry } : UNKNOWN;
}

/** Path → the entry a new link names (Copy link). Only a live canvas the session sees. */
export async function entryForPath(
  source: LinkSource | null | undefined,
  path: string,
  scope?: LinkScope | null
): Promise<LinkAnswer | null> {
  if (!isCanvasPath(path)) return UNKNOWN;
  const docs = source ? await source.docs() : null;
  if (!docs) return null;
  const live = docs.find((d) => d && !d.retired && d.path === path && ENTRY_RE.test(d.entry));
  if (!live || !scoped(scope, path)) return UNKNOWN;
  return { status: 'live', entry: live.entry, path };
}

/** The runtime surface a home exposes for links (local-kernel.ts / sync/index.ts). */
export interface LinkRuntime {
  acceptedLinkDocs?(): Promise<LinkDoc[] | null>;
  acceptedTrashed?(entry: string): Promise<boolean>;
}

/** A home's runtime as a `LinkSource`; null when it has no op log. */
export function linkSourceOf(runtime: LinkRuntime | null | undefined): LinkSource | null {
  const docs = runtime?.acceptedLinkDocs;
  if (!runtime || typeof docs !== 'function') return null;
  const trashed = runtime.acceptedTrashed;
  return {
    docs: () => docs.call(runtime),
    ...(typeof trashed === 'function' ? { trashed: (e: string) => trashed.call(runtime, e) } : {}),
  };
}
