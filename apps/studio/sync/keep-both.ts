// S11.12 — "Keep both" for a FILE-level held source conflict (06 ad-syncd, contract S11 Q7).
//
// The project's version (theirs) becomes the canvas. This Mac's version (mine) is written as a
// sibling canvas "<name> this Mac" — a fresh slug, its `.meta.json` re-keyed (title
// "<name> (this Mac)", new created/last_modified) — and is also kept in the original canvas's
// history as a version nobody kept (`history.aside`). No merge engine. Distinct from S9.24's Keep
// both, which is per ELEMENT on the whiteboard (routes/sync-conflicts.ts).
//
// Order is the safety property:
//   1. the copy is written FIRST, from the exact bytes `conflictVersions` read off the disk;
//   2. theirs is taken only while the disk still holds exactly those bytes — checked and taken in
//      one synchronous step inside the runtime (`resolveConflict(…, 'theirs', { ifMine })`);
//   3. an edit that landed in between (desktop wins the race) refreshes the copy and tries again,
//      so the copy always holds what the take replaced; a version that arrived from the project
//      meanwhile (cloud wins the race) is simply what is taken.
// Nothing of either side is ever written over without a copy of it. A crash between 1 and 2 leaves
// a copy and the conflict still held — both versions still here, the person chooses again.
//
// One undo step: the copy joins the project as ONE `doc.create` (the discovery of a new file);
// taking theirs and the aside move no head. Concurrent presses share one attempt per canvas.

export interface KeepBothSides {
  mine: string | null;
  theirs: string;
}

export interface KeepBothCopy {
  /** repo-relative path of the copy (what the shell opens). */
  file: string;
  /** designRoot-relative. */
  rel: string;
  slug: string;
}

export interface KeepBothDeps {
  /** The held conflict's two sides now (runtime `conflictVersions`); null = nothing held. */
  sides(): KeepBothSides | null;
  /** Write the copy beside the canvas from `source` (api.duplicateCanvas with Keep both's name). */
  makeCopy(
    source: string
  ): Promise<{ ok: true; copy: KeepBothCopy } | { ok: false; error: string }>;
  /** Overwrite the copy's source (an edit landed after the copy was made). */
  rewriteCopy(copy: KeepBothCopy, source: string): Promise<void>;
  /** Take theirs only while the disk is still `ifMine` (runtime `resolveConflict`). */
  takeTheirs(
    ifMine: string
  ): Promise<{ status: 'accepted' | 'rejected' | 'taken'; code?: string } | null>;
  /** Keep mine in the original canvas's history (`history.aside`); best effort. */
  aside(content: string): Promise<{ status: string; code?: string } | null>;
}

export type KeepBothResult =
  | { status: 'kept-both'; copy: KeepBothCopy; aside: 'kept' | 'not-kept' }
  | { status: 'none' }
  | {
      status: 'rejected';
      code: 'no-local-version' | 'copy-failed' | 'still-editing' | 'not-taken';
      error?: string;
      copy?: KeepBothCopy;
    };

/** How many times an edit landing mid-resolution refreshes the copy before the press gives up. */
export const KEEP_BOTH_ATTEMPTS = 3;

export async function keepBoth(deps: KeepBothDeps): Promise<KeepBothResult> {
  let sides = deps.sides();
  if (!sides) return { status: 'none' };
  if (sides.mine === null) return { status: 'rejected', code: 'no-local-version' };
  let copied = sides.mine;
  const made = await deps.makeCopy(copied);
  if (!made.ok) return { status: 'rejected', code: 'copy-failed', error: made.error };
  const { copy } = made;

  for (let attempt = 0; attempt < KEEP_BOTH_ATTEMPTS; attempt++) {
    const took = await deps.takeTheirs(copied);
    if (took?.status === 'taken') {
      const kept = await deps.aside(copied).catch(() => null);
      return {
        status: 'kept-both',
        copy,
        aside: kept?.status === 'accepted' ? 'kept' : 'not-kept',
      };
    }
    if (took?.code !== 'changed') {
      // Resolved meanwhile (another press, or the project took this Mac's version): the copy
      // stays — it holds this Mac's version — and the canvas is whatever won.
      return { status: 'rejected', code: 'not-taken', copy };
    }
    // Desktop won the race: an edit landed after the copy was made. The copy follows it.
    sides = deps.sides();
    if (!sides || sides.mine === null) return { status: 'rejected', code: 'not-taken', copy };
    copied = sides.mine;
    await deps.rewriteCopy(copy, copied);
  }
  return { status: 'rejected', code: 'still-editing', copy };
}

/** One attempt per canvas at a time: a second press while the first runs gets the same answer. */
export function createKeepBothGate() {
  const inFlight = new Map<string, Promise<KeepBothResult>>();
  return (key: string, run: () => Promise<KeepBothResult>): Promise<KeepBothResult> => {
    const was = inFlight.get(key);
    if (was) return was;
    const p = run().finally(() => inFlight.delete(key));
    inFlight.set(key, p);
    return p;
  };
}

// ── wiring (http.ts `/_api/project/conflict` { choice: 'keep-both' }) ───────────────────────────

/** The slice of the sync runtime Keep both uses (sync/index.ts SyncRuntime). */
export interface KeepBothRuntime {
  conflictVersions?(repoRel: string): { slug: string; mine: string | null; theirs: string } | null;
  resolveConflict?(
    repoRel: string,
    choice: 'mine' | 'theirs',
    o?: { ifMine?: string }
  ): Promise<{ status: 'accepted' | 'rejected' | 'taken'; code?: string } | null>;
  acceptedAside?(
    repoRel: string,
    lane: 'html',
    content: string,
    label?: string
  ): Promise<{ status: 'accepted' | 'rejected'; code?: string } | null>;
}

export interface KeepBothResolverDeps {
  runtime(): KeepBothRuntime | null | undefined;
  designRoot: string;
  /** slug → repo-relative canvas path (api.fileForSlug). */
  fileForSlug(slug: string): Promise<string | null>;
  /** api.duplicateCanvas — the copy's free name, re-keyed meta and board. */
  duplicate(input: {
    file: string;
    suffix: 'this Mac';
    title: string;
    source: string;
  }): Promise<{ ok: boolean; file?: string; rel?: string; slug?: string; error?: string }>;
  writeFile?(abs: string, text: string): Promise<unknown>;
}

/** CONTRACT §3–§4 — the copy's title, and the aside's label in the original's history. */
export const keepBothTitle = (name: string) => `${name} (this Mac)`;
export const KEEP_BOTH_ASIDE_LABEL = 'This Mac’s version — kept as a copy';

/** `file` is what the card names: a canvas slug (the notice id) or a repo-relative path. */
export function createKeepBothResolver(d: KeepBothResolverDeps) {
  const gate = createKeepBothGate();
  return async (file: string): Promise<KeepBothResult> => {
    const rt = d.runtime();
    const first = rt?.conflictVersions?.(file);
    if (!rt || !first) return { status: 'none' };
    const repoRel = /\.tsx$/i.test(file) ? file : await d.fileForSlug(first.slug);
    if (!repoRel) return { status: 'none' };
    return gate(first.slug, () =>
      keepBoth({
        sides: () => rt.conflictVersions?.(repoRel) ?? null,
        makeCopy: async (source) => {
          const name =
            repoRel
              .split('/')
              .pop()
              ?.replace(/\.tsx$/i, '') ?? 'Untitled canvas';
          const r = await d.duplicate({
            file: repoRel,
            suffix: 'this Mac',
            title: keepBothTitle(name),
            source,
          });
          if (!r.ok || !r.file || !r.rel || !r.slug)
            return { ok: false, error: r.error ?? 'could not make the copy' };
          return { ok: true, copy: { file: r.file, rel: r.rel, slug: r.slug } };
        },
        rewriteCopy: async (copy, source) => {
          const abs = `${d.designRoot.replace(/\/+$/, '')}/${copy.rel}`;
          await (d.writeFile ?? ((p: string, t: string) => Bun.write(p, t)))(abs, source);
        },
        takeTheirs: (ifMine) =>
          rt.resolveConflict?.(repoRel, 'theirs', { ifMine }) ?? Promise.resolve(null),
        aside: (content) =>
          rt.acceptedAside?.(repoRel, 'html', content, KEEP_BOTH_ASIDE_LABEL) ??
          Promise.resolve(null),
      })
    );
  };
}
