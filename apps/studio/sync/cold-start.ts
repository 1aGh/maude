// Cold-start body resolution — the pure decision core of the conflict
// protocol (DDR-102; supersedes the v1.1 "hub-wins always" scoping).
//
// Both sync paths (agent.ts reconcile, migrate-seed.ts for the shared-doc
// cutover) feed their observed state into `decideColdStart` and execute the
// returned action. Keeping the table pure makes the full matrix unit-testable
// without Y.Docs or disk (mirrors codec.ts's pure-function style).
//
// The journal (journal.ts) is what separates a CLEAN catch-up from divergence:
// journalHash == hash(local) means every local byte was already reconciled
// through this machine — the hub being different just means it moved ahead, so
// overwriting disk is a fast-forward, not data loss. Any other combination of
// "both sides non-empty and different" is a conflict: the caller snapshots
// BOTH versions to `_history/<slug>/` and applies the newest-wins winner.
//
// Newest-wins compares the doc-side `syncMeta.bodyEditAt` stamp (codec.ts —
// written by every peer that applies a local body into the doc) against the
// local file mtime. Either side unknown (older peer never stamped; mtime
// unavailable) or equal → hub wins, exactly the v1.1 default — but now both
// sides are snapshotted first, so even a wrong pick costs one /design:rollback.

import { commentKey } from './comment-identity.ts';
import { hashBytes } from './echo-guard.ts';

export type ColdStartAction =
  | 'noop'
  | 'materialize-hub'
  | 'seed-local-up'
  | 'fast-forward-hub'
  | 'recover-seed-dup'
  | 'conflict';

export interface ColdStartInput {
  /** Local body file content, or null when the file doesn't exist. */
  localBody: string | null;
  /** Body currently held by the doc (hub state after first sync). */
  docBody: string;
  /** Journal entry's bodyHash for this slug, or null when never checkpointed. */
  journalHash: string | null;
  /** Local body file mtime (ms epoch), or null when unavailable. */
  localMtimeMs: number | null;
  /** Doc-side syncMeta.bodyEditAt stamp (ms epoch), or null when no peer ever
   *  stamped (older peer interop) — falls back to hub-wins. */
  docBodyEditAtMs: number | null;
  /**
   * V2-1.12 §5.9 — the FIRST cold start after this Mac learns the project's
   * format was raised (its `_state/hub-format.json` was absent or older than
   * the hub's value). Evaluated before newest-wins: the hub wins, a divergent
   * local copy is kept aside, and nothing is pushed.
   */
  formatFirstSight?: boolean;
}

export interface ColdStartDecision {
  action: ColdStartAction;
  /** Set only for `conflict`. */
  winner?: 'local' | 'hub';
  /** V2-1.12 §5.9 — the conflict is the format-flip first-sight row. */
  firstSight?: true;
  /** Human-readable, logged + recorded in the conflict entry. */
  reason: string;
}

/** Trim-only-whitespace bodies count as empty (mirrors the agent's
 *  `localHtml.trim() !== ''` guard). */
function isEmptyBody(body: string | null): boolean {
  return body === null || body.trim() === '';
}

/**
 * True when `docBody` is exactly `localBody` repeated N≥2 times — the signature
 * of a concurrent cold-seed collision (F1): two peers each `seed-local-up`-ed
 * the SAME body into an empty hub before either's write propagated, so the CRDT
 * preserved both insertions and the Y.Text became `BODY` × N. We detect the
 * exact-repeat shape (not a fuzzy "contains") so a legitimate later edit — which
 * is never a clean integer-multiple repeat of the prior body — can't be
 * mis-read as a duplication and clobbered back. Exact equality (N==1) is the
 * caller's `noop`, handled before this is consulted.
 */
export function isExactRepeat(docBody: string, localBody: string): boolean {
  if (localBody.length === 0) return false;
  if (docBody.length <= localBody.length) return false;
  if (docBody.length % localBody.length !== 0) return false;
  const n = docBody.length / localBody.length;
  return docBody === localBody.repeat(n);
}

/**
 * Union-merge two comment snapshots by stable `id` (DDR-102): doc order first,
 * local-only entries appended. Comments carry stable ids, so union loses
 * nothing and needs no winner — same-id entries keep the doc's version.
 * Id-less entries dedupe by JSON identity (conservative). Shared by both
 * cold-start paths (agent reconcile + migrate-seed).
 */
export function unionCommentsById(docList: unknown[], localList: unknown[]): unknown[] {
  const out: unknown[] = [];
  const seen = new Set<string>();
  // THE DOC IS DEDUPED AGAINST ITSELF, not just against local (issue #114/#112).
  // `out` used to be seeded as `[...docList]`, which made this union a filter on
  // the LOCAL side only — so a doc whose comments array had already been
  // concurrency-doubled (`applyCommentsToDoc` is delete-all + push: two peers
  // replacing at once keep both pushes) carried every copy forward, and the
  // merged result was re-published as the new truth. That is the amplifier
  // behind "the comment self duplicated like 8 times": 2 → 4 → 8, one doubling
  // per concurrent round, with nothing in the loop able to shrink it again.
  // Deduping the doc half turns the same pass into the repair.
  // `commentKey` is the SHARED identity rule (comment-identity.ts) — the same
  // one `applyCommentsToDoc`'s diff and the room seed use. It has to be shared:
  // if the union's notion of "same comment" ever drifted from the codec's, one
  // layer's repair would be the other's duplicate.
  const admit = (c: unknown): void => {
    const k = commentKey(c);
    if (seen.has(k)) return;
    seen.add(k);
    out.push(c);
  };
  // Doc order first (same-id entries keep the doc's version), local-only appended.
  for (const c of docList) admit(c);
  for (const c of localList) admit(c);
  return out;
}

export function decideColdStart(input: ColdStartInput): ColdStartDecision {
  const base = decideColdStartNewestWins(input);
  return input.formatFirstSight ? firstSightRow(base) : base;
}

/**
 * The §5.9 row over the DDR-102 table: on first sight of a format flip every
 * canvas-owned lane is hub-wins and NOTHING is pushed. Rows that only read the
 * hub (materialize, fast-forward, noop) stand; every row that would push local
 * becomes a hub-wins conflict (the local copy snapshotted and reported), except
 * an EMPTY hub body — there "hub wins" would be a blank canvas, so local stays
 * on disk untouched and unpushed (emptiness never beats content, DDR-223).
 */
function firstSightRow(d: ColdStartDecision): ColdStartDecision {
  if (d.action === 'seed-local-up') {
    return {
      action: 'noop',
      reason:
        'format flip, first sight — the hub holds no body; local kept on disk, nothing pushed',
    };
  }
  // `recover-seed-dup` stands: it collapses a doubled body to the one copy the
  // hub already holds (no new bytes), and turning it into a hub-wins would
  // write the doubled, unbuildable body to disk (agent.ts keeps it a collapse).
  if (d.action === 'conflict') {
    return {
      action: 'conflict',
      winner: 'hub',
      firstSight: true,
      reason: `format flip, first sight — hub wins, the local copy is kept aside (${d.reason})`,
    };
  }
  return d;
}

function decideColdStartNewestWins(input: ColdStartInput): ColdStartDecision {
  const localEmpty = isEmptyBody(input.localBody);
  const docEmpty = isEmptyBody(input.docBody);

  if (localEmpty && docEmpty) {
    return { action: 'noop', reason: 'both sides empty — nothing to reconcile' };
  }

  if (localEmpty) {
    // Clean first sync: nothing local to lose.
    return { action: 'materialize-hub', reason: 'no local body — materializing hub state' };
  }

  if (docEmpty) {
    // DDR-064 empty-hub guard, now a named case: an empty hub doc means the hub
    // holds no body for this slug yet — NOT an authoritative "blank canvas".
    return {
      action: 'seed-local-up',
      reason: 'hub doc empty — seeding local body up (DDR-064 guard)',
    };
  }

  if (input.localBody === input.docBody) {
    // Caller records the journal so the NEXT boot sees a clean checkpoint.
    return { action: 'noop', reason: 'local and hub identical' };
  }

  // Concurrent cold-seed collision (F1): the hub body is our local body repeated
  // N≥2 times — two peers seeded the same canvas into an empty hub at the same
  // moment and the CRDT concatenated both insertions (un-buildable: two `export
  // default`). This is NOT divergence (it carries no new bytes — just a doubled
  // copy of ours), so it must NOT take the conflict/fast-forward path. Collapse
  // it back to one copy by re-applying local (the caller's `applyHtmlToDoc` diff
  // deletes the trailing duplicate). Idempotent across peers — the delete targets
  // the same CRDT items, so concurrent recoveries converge instead of fighting.
  if (
    input.localBody !== null &&
    !localEmpty &&
    !docEmpty &&
    isExactRepeat(input.docBody, input.localBody)
  ) {
    return {
      action: 'recover-seed-dup',
      reason:
        'hub body is local repeated — concurrent cold-seed duplication; collapsing to one copy',
    };
  }

  // Hash via hashBytes ONLY — the journal recorded its hashes through the same
  // fn (single source, echo-guard.ts), so this comparison is apples-to-apples.
  if (
    input.journalHash !== null &&
    input.localBody !== null &&
    input.journalHash === hashBytes(input.localBody)
  ) {
    // Everything local was already reconciled through this machine; the hub is
    // simply ahead. Overwrite WITHOUT snapshot/conflict — a clean fast-forward.
    return {
      action: 'fast-forward-hub',
      reason: 'local matches last-synced journal hash — hub is ahead, fast-forwarding',
    };
  }

  // Divergence: both sides non-empty, different, and local carries bytes this
  // machine never reconciled (journal stale or absent). Newest wins; unknown
  // or tied timestamps fall back to hub (v1.1 default, now recoverable).
  const local = input.localMtimeMs;
  const doc = input.docBodyEditAtMs;
  if (local !== null && doc !== null && local !== doc) {
    const winner = local > doc ? 'local' : 'hub';
    return {
      action: 'conflict',
      winner,
      reason: `diverged — newest wins: local mtime ${new Date(local).toISOString()} ${
        winner === 'local' ? '>' : '<'
      } doc bodyEditAt ${new Date(doc).toISOString()}`,
    };
  }
  return {
    action: 'conflict',
    winner: 'hub',
    reason:
      local === null || doc === null
        ? 'diverged — timestamp unknown on one side, falling back to hub-wins (recoverable: both sides snapshotted)'
        : 'diverged — timestamps tied, falling back to hub-wins (recoverable: both sides snapshotted)',
  };
}

/* ------------------------------------------------- annotations (per-lane) */

export interface AnnotationsColdStartInput {
  /** Local `.annotations.svg` content, or null when the file doesn't exist. */
  local: string | null;
  /** Annotations currently held by the doc (`''` when the lane is unset). */
  doc: string;
  /** True when the value carries zero strokes — callers pass
   *  `isEmptyAnnotationsSvg` (codec.ts) so this table stays Y-free. */
  isEmpty: (svg: string | null) => boolean;
  /** Local annotations file mtime (ms epoch), or null when unavailable. */
  localMtimeMs: number | null;
  /** Doc-side syncMeta.annotationsEditAt stamp, or null when no peer ever
   *  stamped (pre-stamp interop). */
  docEditAtMs: number | null;
  /** The body lane's resolved winner — the legacy coupling, used only as the
   *  fallback when both sides are non-empty and neither is stamped. */
  bodyWinner: 'local' | 'hub';
  /** V2-1.12 §5.9 — first sight of a format flip: never push local. */
  formatFirstSight?: boolean;
}

export interface AnnotationsColdStartDecision {
  winner: 'local' | 'hub' | 'none';
  reason: string;
}

/**
 * Per-lane cold-start resolution for annotations (extends DDR-102 to the
 * annotations lane; the 2026-08-14 annotations eraser).
 *
 * Annotations used to blindly follow the body winner — but annotation edits
 * don't move the body's edit time, so a hub with a newer body and a STALE
 * (empty-wrapper) annotations lane erased newer local strokes on every cold
 * start, and with the strokes went the `assets/<sha8>` references the asset
 * pull scans. The one load-bearing rule here: **unstamped emptiness never
 * beats content.** A STAMPED emptiness that is provably newer is a deliberate
 * delete-all and is honored; everything else prefers the side with strokes.
 */
export function decideAnnotationsColdStart(
  input: AnnotationsColdStartInput
): AnnotationsColdStartDecision {
  const d = decideAnnotationsNewestWins(input);
  return input.formatFirstSight ? neverPushLocal(d, 'annotations') : d;
}

/**
 * §5.9 for the per-lane tables: on first sight nothing is pushed, so a lane
 * that would seed local up keeps it on disk instead ('none'). It never becomes
 * a hub overwrite here — these lanes take no snapshot, and the body row is the
 * one that keeps a divergent copy aside.
 */
function neverPushLocal<T extends { winner: 'local' | 'hub' | 'none'; reason: string }>(
  d: T,
  lane: string
): T {
  if (d.winner !== 'local') return d;
  return {
    ...d,
    winner: 'none',
    reason: `format flip, first sight — local ${lane} kept on disk, nothing pushed (${d.reason})`,
  };
}

function decideAnnotationsNewestWins(
  input: AnnotationsColdStartInput
): AnnotationsColdStartDecision {
  const { local, doc, isEmpty, localMtimeMs, docEditAtMs, bodyWinner } = input;
  const localEmpty = isEmpty(local);
  const docEmpty = isEmpty(doc === '' ? null : doc);

  if (localEmpty && docEmpty) return { winner: 'none', reason: 'both sides empty' };

  if (docEmpty && !localEmpty) {
    // A stamped hub emptiness NEWER than the local file is a deliberate
    // delete-all made while this peer was offline — honor it.
    if (docEditAtMs !== null && localMtimeMs !== null && docEditAtMs > localMtimeMs) {
      return {
        winner: 'hub',
        reason: `hub delete-all is newer than local strokes (annotationsEditAt ${new Date(docEditAtMs).toISOString()} > local mtime ${new Date(localMtimeMs).toISOString()})`,
      };
    }
    return {
      winner: 'local',
      reason:
        'hub annotations are empty but local has strokes — keeping local + seeding it up (unstamped emptiness never beats content)',
    };
  }

  if (!docEmpty && localEmpty) {
    // Symmetric: a local delete-all (empty wrapper on disk) newer than the
    // doc's stamp is honored; an absent/stale local file materializes the hub.
    if (
      local !== null &&
      localMtimeMs !== null &&
      docEditAtMs !== null &&
      localMtimeMs > docEditAtMs
    ) {
      return {
        winner: 'local',
        reason: `local delete-all is newer than hub strokes (local mtime ${new Date(localMtimeMs).toISOString()} > annotationsEditAt ${new Date(docEditAtMs).toISOString()})`,
      };
    }
    return { winner: 'hub', reason: 'local annotations empty/absent — materializing hub strokes' };
  }

  // Both non-empty.
  if (doc === local) return { winner: 'none', reason: 'both sides equal' };
  if (docEditAtMs !== null && localMtimeMs !== null && docEditAtMs !== localMtimeMs) {
    const winner = localMtimeMs > docEditAtMs ? 'local' : 'hub';
    return {
      winner,
      reason: `diverged — newest wins: local mtime ${new Date(localMtimeMs).toISOString()} ${
        winner === 'local' ? '>' : '<'
      } doc annotationsEditAt ${new Date(docEditAtMs).toISOString()}`,
    };
  }
  return {
    winner: bodyWinner,
    reason: `diverged — no per-lane stamp on one side, following the body winner (${bodyWinner})`,
  };
}

/* ------------------------------------------------------- css (per-lane) */

export interface CssColdStartInput {
  /** Local sibling `.css` content, or null when the file doesn't exist. */
  local: string | null;
  /** The css currently held by the doc (`null` when the lane is unset/empty). */
  doc: string | null;
  /** Journal entry's `cssHash` for this slug, or null when never checkpointed. */
  journalHash: string | null;
  /** Hash fn — passed in so this table stays as dependency-free as the rest. */
  hash: (s: string) => string;
  /** How the body lane resolved; the tie-break for a genuine divergence. */
  bodyWinner: 'local' | 'hub';
  /** V2-1.12 §5.9 — first sight of a format flip: never push local. */
  formatFirstSight?: boolean;
}

export interface CssColdStartDecision {
  winner: 'local' | 'hub' | 'none';
  /** True when local won because the doc held local repeated N≥2 times. */
  recoveredDuplication?: boolean;
  reason: string;
}

/**
 * Per-lane cold-start resolution for the canvas's sibling `.css` (issue #114).
 *
 * WHY THIS TABLE EXISTS. Every other Plane-A lane had one — `decideColdStart`
 * for the body, `decideAnnotationsColdStart` for annotations, `repairSharedMeta`
 * for meta — and css had none: it simply followed the body winner and re-applied
 * the whole file whenever the two sides disagreed. That left it the only lane
 * with no duplication guard at all, and `applyCssToDoc` is a delete-all+insert,
 * so two peers seeding one empty document concurrently kept BOTH inserts and the
 * lane became `CSS × N` (Yjs merges concurrent inserts at the same position by
 * keeping both — not a corruption, the CRDT doing its job). Worse, the "repair"
 * was itself another full insert, so every subsequent disagreement could double
 * it again. Measured on the reporting machine's 84 persisted docs: the body lane
 * was clean 21 times out of 84, the css lane ZERO times out of 43, and css
 * carried strictly more copies than its own document's body in 43 of 43.
 * Per-lane vigilance is what failed; a table per lane is the shape that holds.
 *
 * The rows mirror `decideColdStart`'s, in the same order and for the same
 * reasons — crucially the `recover-seed-dup` row, checked BEFORE the journal
 * fast-forward so a doubled lane is collapsed rather than read as "the hub moved
 * ahead". Like the body's, it repairs only what it can PROVE: an exact integer
 * repeat of the bytes on disk. A doc carrying genuinely new css is never an
 * exact repeat, so this cannot clobber an edit.
 */
export function decideCssColdStart(input: CssColdStartInput): CssColdStartDecision {
  const d = decideCssNewestWins(input);
  return input.formatFirstSight ? neverPushLocal(d, 'css') : d;
}

function decideCssNewestWins(input: CssColdStartInput): CssColdStartDecision {
  const { local, doc, journalHash, hash, bodyWinner } = input;
  const localEmpty = local === null || local === '';
  const docEmpty = doc === null || doc === '';

  if (localEmpty && docEmpty) return { winner: 'none', reason: 'both sides empty' };
  if (localEmpty) return { winner: 'hub', reason: 'no local css — materializing the hub lane' };
  if (docEmpty) {
    // The body lane's DDR-064 guard, applied here: an empty css lane means the
    // hub holds no css for this canvas YET, never "this canvas has no css".
    // Without this row a local `.css` next to a hub-winning body never travelled
    // at all — it sat on one disk and no peer ever saw it.
    return { winner: 'local', reason: 'hub css lane empty — seeding local css up (DDR-064 guard)' };
  }
  if (doc === local) return { winner: 'none', reason: 'local and hub css identical' };

  // Concurrent cold-seed collision, css edition — see the header. Collapsing is
  // re-applying local: `applyCssToDoc` replaces the lane wholesale, so the
  // repeated copies go and one stays.
  if (isExactRepeat(doc, local)) {
    return {
      winner: 'local',
      recoveredDuplication: true,
      reason:
        'hub css is local repeated — concurrent cold-seed duplication; collapsing to one copy',
    };
  }

  // The journal checkpoint the css lane has been WRITING since DDR-102 and never
  // reading. Same meaning as the body's: every local byte was already reconciled
  // through this machine, so the hub is simply ahead.
  if (journalHash !== null && journalHash === hash(local)) {
    return {
      winner: 'hub',
      reason: 'local css matches the last-synced journal hash — hub is ahead, fast-forwarding',
    };
  }

  // Genuine divergence. The css is visually coupled to the body, so it follows
  // the body's resolution rather than inventing a second, possibly disagreeing
  // winner for the same canvas — the pre-existing behaviour, now reached only
  // when the rows above have ruled out the cases they can decide on their own.
  return {
    winner: bodyWinner,
    reason: `css diverged — following the body winner (${bodyWinner})`,
  };
}
