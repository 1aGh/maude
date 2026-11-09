// Cold start under accepted revisions — DDR-241 §3, plan T13/T14.
//
// The legacy cold start (`migrate-seed.ts`) had to CHOOSE a source and write it
// into the shared document, because the document was writable and whatever a
// peer put there was the project. Here the document is a read-only replica of
// the accepted state, so cold start only ever DECIDES, per lane:
//
//   agreed       — disk already holds the accepted value;
//   materialize  — disk is older than the project (or absent): the projection
//                  writes the accepted value, keeping local bytes in recovery;
//   propose      — disk carries a change made on top of a known base: it is
//                  proposed, and the hub merges it three-way from that base;
//   hold         — disk differs and nothing proves what it was derived from:
//                  both are kept, the lane stays blocked with a visible
//                  conflict, and the next save resolves it (T2's rule — never a
//                  silent overwrite of either side).
//
// A canvas the project does not know yet is proposed as `doc.create` with all
// of its lanes, so it arrives on every peer as ONE action.
//
// Annotations are never re-proposed from disk here: every change the studio
// made to them went through the durable outbox (drained before any cold start),
// so a difference on disk is an older accepted state the room had not
// re-projected — the accepted value wins, and the local file is kept in a
// recovery slot in case a raw edit made while the studio was down lived there.
//
// Comments had the same rule, and the premise did not hold for them (issue
// #133, reproduced end-to-end): a comment added while the sync runtime was not
// up yet (`proposeLane` unavailable, server.ts) went to the local room and disk
// only, never into the outbox — so the web never saw it, and the file then
// froze behind it. Comments carry stable ids, so the difference is decidable:
// an id on disk that the accepted state lacks and that the comment ledger says
// was never synced from here is a local comment still owed to the project; it
// is proposed, as the accepted list plus those comments (a three-way id merge
// on the hub). Ids the ledger knows were synced are deletions made while this
// machine was away and are not proposed back. With no ledger record for the
// canvas (first launch after upgrading) nothing is decidable: the old rule —
// accepted wins, local kept in recovery — stands.

import { existsSync, readFileSync } from 'node:fs';
import type * as Y from 'yjs';

import { annotationsLaneValue } from '../annotations/board-text.ts';
import { parseBoard, serializeBoard } from '../annotations/schema.ts';
import type { AnnotationElement } from '../annotations/types.ts';
import {
  cssFromDoc,
  htmlFromDoc,
  isEmptyAnnotationsSvg,
  laneValueFromFile,
  readLaneFromDoc,
  readLocalAnnotations,
} from './codec.ts';
import { commentKey } from './comment-identity.ts';
import type { CommentLedger } from './comment-ledger.ts';
import { hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import type { DocProjection, ProjectionPaths, ProposalLane } from './projection.ts';
import { readRecoveryBody, readRecoveryCandidate, saveRecoveryBody } from './source-recovery.ts';
import { sourceError } from './source-validation.ts';

export type LaneDecision = 'agreed' | 'materialize' | 'propose' | 'hold';

export interface LaneVerdict {
  lane: ProposalLane;
  decision: LaneDecision;
  /** For `propose`: the value the local edit was derived from. For `hold`: the accepted value adopted as the base. */
  base?: string;
  local?: string;
}

function readText(p: string | undefined): string | null {
  if (!p || !existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function parseList(v: string): unknown[] {
  if (!v) return [];
  try {
    const parsed = JSON.parse(v) as unknown;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/**
 * The comments list to propose at cold start — the accepted list plus the local
 * comments never synced from here — or null when there is nothing owed (or no
 * ledger record to decide by). See the header.
 */
export function commentsOwedToProject(
  local: string,
  accepted: string,
  slug: string,
  ledger: CommentLedger | undefined
): string | null {
  if (!ledger?.known(slug)) return null;
  const acceptedList = parseList(accepted);
  const inProject = new Set(acceptedList.map(commentKey));
  const synced = ledger.get(slug);
  const owed = parseList(local).filter((c) => {
    const k = commentKey(c);
    return !inProject.has(k) && !synced.has(k);
  });
  return owed.length > 0 ? JSON.stringify([...acceptedList, ...owed]) : null;
}

/** An unresolved refused draft of this source is on record (unreadable counts: fail closed). */
function openConflict(historyDir: string | undefined, file: string): boolean {
  if (!historyDir) return false;
  try {
    const c = readRecoveryCandidate(historyDir, file);
    return c !== null && !c.resolved;
  } catch {
    return true;
  }
}

/**
 * Pure decision for the source lanes. `knownBase` is the last value disk and
 * the accepted replica agreed on (recovery slot), `baseHash` the journal's
 * hash of it when the bytes are gone.
 */
export function decideSourceLane(input: {
  local: string | null;
  accepted: string;
  knownBase: string | null;
  baseHash?: string | null;
}): { decision: LaneDecision; base?: string } {
  const { local, accepted } = input;
  if (local === null) return { decision: 'materialize' };
  if (local === accepted) return { decision: 'agreed' };
  let base = input.knownBase;
  if (base === null && input.baseHash) {
    if (hashBytes(accepted) === input.baseHash) base = accepted;
    else if (hashBytes(local) === input.baseHash) base = local;
  }
  if (base === null) {
    // The project never had this lane: nothing of anybody's can be lost.
    if (accepted === '') return { decision: 'propose', base: '' };
    return { decision: 'hold', base: accepted };
  }
  if (base === local) return { decision: 'materialize' }; // an older accepted state
  return { decision: 'propose', base };
}

export interface AcceptedColdStartInput {
  slug: string;
  doc: Y.Doc;
  paths: ProjectionPaths;
  /** Design-root-relative body path (`ui/home.tsx`). */
  rel: string;
  /** Is this canvas a live document of the project's accepted state? */
  inProject: boolean;
  projection: DocProjection;
  historyDir?: string;
  journal?: SyncJournal;
  /** Issue #133 — comment ids synced from here before (see the header). */
  commentLedger?: CommentLedger;
  /**
   * This disk's own html proposal a previous run left unanswered, which the
   * outbox drain has just had accepted. The disk was saved on top of it, so it
   * is the base — the recovery slot still holds the value before it.
   */
  ownAccepted?: string | null;
  /**
   * #14 (2.0.5) — the css twin's `ownAccepted`: this disk's own css proposal a previous run left
   * unanswered (an edit made offline, or just before quitting), which the drain has just had
   * accepted. Without it a css edited while the studio was closed was judged against the css
   * before that save, and refused as a conflict with the person's own older css.
   */
  ownAcceptedCss?: string | null;
  /**
   * Did the project ever accept exactly this value? A disk with no record of
   * its base that holds a value the store accepted at some revision holds an
   * OLDER accepted state (a checkout restored from a backup — every cloud
   * cell wake), not an edit: it is materialized, never held.
   */
  wasAccepted?: (content: string) => Promise<boolean | null>;
  /**
   * 2.1.1 T11 — this disk is a hub's own checkout (the paired studio of a cell or a self-hosted
   * workspace hub, `cellPairing`): the project's cache, not a person's work (DDR-243; the hub is
   * the sole committer, DDR-209). A source lane that would be HELD is materialized instead — the
   * project's version wins and the checkout's bytes go to the recovery slot. A held conflict there
   * is a dead end: the hub's proxy refuses the conflict route in a cell (v2-S9.24b), so Compare
   * and Keep mine answer 404, and the lane stays blocked behind it.
   */
  checkoutIsCache?: boolean;
  createDoc: (lanes: Partial<Record<ProposalLane, string>>) => Promise<{
    status: 'accepted' | 'rejected';
    code?: string;
    /** S6.13 — the source the project accepted, when not the disk read here
     *  (a create this Mac proposed earlier: offline Cmd+N, or a drained one). */
    html?: string | null;
  }>;
  log?: Pick<Console, 'log' | 'warn'>;
}

/**
 * The lanes a local canvas joins the project with (its `doc.create`), read
 * from disk. Shared by the cold start and S6.13's offline create, which
 * proposes the same thing before the hub has answered.
 */
export function localCreateLanes(
  paths: ProjectionPaths,
  html: string
): Partial<Record<ProposalLane, string>> {
  const lanes: Partial<Record<ProposalLane, string>> = { html };
  const css = readText(paths.css);
  if (css) lanes.css = css;
  const metaText = readText(paths.meta);
  const meta = metaText === null ? null : laneValueFromFile('meta', metaText);
  if (meta && meta !== '{}') lanes.meta = meta;
  // DDR-242 — canonical board text; a legacy sidecar arrives migrated.
  const ann = readLocalAnnotations(paths.annotations, readText);
  if (ann && !isEmptyAnnotationsSvg(ann)) lanes.annotations = ann;
  const commentsText = readText(paths.comments);
  const comments = commentsText === null ? null : laneValueFromFile('comments', commentsText);
  if (comments) lanes.comments = comments;
  return lanes;
}

export type AcceptedColdStartResult =
  | { kind: 'created' }
  | { kind: 'create-refused'; code?: string }
  | {
      kind: 'reconciled';
      verdicts: LaneVerdict[];
      /** S1 — lanes whose local value the project's replaced; each is in its recovery slot. */
      setAside?: ProposalLane[];
    };

export async function acceptedColdStart(
  i: AcceptedColdStartInput
): Promise<AcceptedColdStartResult> {
  const log = i.log ?? console;
  const localHtml = readText(i.paths.html);

  if (!i.inProject) {
    if (localHtml === null) return { kind: 'reconciled', verdicts: [] };
    const lanes = localCreateLanes(i.paths, localHtml);
    const r = await i.createDoc(lanes);
    if (r.status === 'accepted') {
      // What the project now holds IS the local file: the next save is based
      // on it, even if it lands before the publication reaches this replica.
      const base = r.html ?? localHtml;
      // Persisted (v2-204): the creator has a base on record like any peer that received it, so
      // an offline edit after a restart is proposed against it instead of held as a conflict.
      i.projection.adoptBase(base, { remember: true });
      // S6.13b — saved again on top of that create while it waited (offline,
      // or a previous run): the disk is an edit of it, proposed as one.
      if (base !== localHtml && !sourceError(i.paths.html, localHtml)) {
        void i.projection.proposeLane('html', localHtml, { baseContent: base, stageable: true });
      }
      log.log(`[sync/${i.slug}] added to the project (accepted).`);
      return { kind: 'created' };
    }
    log.warn(
      `[sync/${i.slug}] the project did not accept this canvas (${r.code ?? 'rejected'}) — it stays local.`
    );
    return { kind: 'create-refused', code: r.code };
  }

  const verdicts: LaneVerdict[] = [];
  /** S1 — lanes whose local value the project's replaced, kept in their recovery slot. */
  const setAside: ProposalLane[] = [];
  const saveQuietly = (file: string, text: string): boolean => {
    if (!i.historyDir) return false;
    try {
      saveRecoveryBody(i.historyDir, file, 'local', text);
      return true;
    } catch {
      return false; /* recovery is best-effort for these lanes */
    }
  };
  const keepAside = (lane: ProposalLane, file: string, text: string): void => {
    saveQuietly(file, text);
    if (!setAside.includes(lane)) setAside.push(lane);
  };

  // ---- html — the canvas source
  const acceptedHtml = htmlFromDoc(i.doc);
  if (localHtml !== null && localHtml !== acceptedHtml && sourceError(i.paths.html, localHtml)) {
    // An invalid local body cannot be proposed; the projection keeps its bytes
    // in recovery and reports it when it materializes the accepted source.
    verdicts.push({ lane: 'html', decision: 'materialize', local: localHtml });
  } else if (i.ownAccepted != null && localHtml === i.ownAccepted) {
    // Disk IS the drained, accepted save; its publication may still be on the
    // way. Nothing to propose, and nothing older to write over it.
    verdicts.push({ lane: 'html', decision: 'agreed', local: localHtml });
    i.projection.adoptOwnAccepted(i.ownAccepted);
  } else {
    const d = decideSourceLane({
      local: localHtml,
      accepted: acceptedHtml,
      knownBase:
        i.ownAccepted ??
        (i.historyDir ? readRecoveryBody(i.historyDir, i.paths.html, 'base') : null),
      baseHash: i.journal?.get(i.slug)?.bodyHash ?? null,
    });
    // "The project once accepted exactly these bytes" proves an OLDER accepted state (a checkout
    // restored from a backup — every cloud cell wake) only when this Mac is not holding a refused
    // save: the hub answers by content hash, across every document and revision, and a refused
    // candidate is very often bytes the project took somewhere (the same artboards trashed on a
    // twin canvas, a trash a restore undid). An open conflict episode on disk (its first refused
    // draft, unresolved) keeps the hold — the person sees it again after a restart instead of
    // losing it in silence (F15, v2-204).
    const older =
      d.decision === 'hold' &&
      localHtml !== null &&
      !openConflict(i.historyDir, i.paths.html) &&
      (await i.wasAccepted?.(localHtml)) === true;
    verdicts.push({
      lane: 'html',
      ...(older ? { decision: 'materialize' as const } : d),
      ...(localHtml !== null ? { local: localHtml } : {}),
    });
  }

  // ---- css — opaque text, journal-checkpointed
  if (i.paths.css) {
    const localCss = readText(i.paths.css);
    if (i.ownAcceptedCss != null && localCss === i.ownAcceptedCss) {
      // Disk IS the drained, accepted css; its publication may still be on the way.
      verdicts.push({ lane: 'css', decision: 'agreed', local: localCss });
      i.projection.adoptOwnAcceptedCss(i.ownAcceptedCss);
    } else {
      const d = decideSourceLane({
        local: localCss,
        accepted: cssFromDoc(i.doc) ?? '',
        knownBase:
          i.ownAcceptedCss ??
          (i.historyDir ? readRecoveryBody(i.historyDir, i.paths.css, 'base') : null),
        baseHash: i.journal?.get(i.slug)?.cssHash ?? null,
      });
      const older =
        d.decision === 'hold' && localCss !== null && (await i.wasAccepted?.(localCss)) === true;
      verdicts.push({
        lane: 'css',
        ...(older ? { decision: 'materialize' as const } : d),
        ...(localCss !== null ? { local: localCss } : {}),
      });
    }
  }

  // ---- meta — the shared layout keys (viewport never travels)
  if (i.paths.meta) {
    const metaText = readText(i.paths.meta);
    const local = metaText === null ? null : laneValueFromFile('meta', metaText);
    const accepted = readLaneFromDoc(i.doc, 'meta');
    if (local === null || local === accepted || (local === '{}' && accepted === '')) {
      verdicts.push({ lane: 'meta', decision: local === null ? 'materialize' : 'agreed' });
    } else if (accepted === '') {
      verdicts.push({ lane: 'meta', decision: 'propose', base: '', local });
    } else {
      // No base is recorded for layout: the project's arrangement wins and the
      // projection merges it into the local file's private keys. S1 — unless the
      // project once had exactly this layout (an older accepted state), it is this
      // Mac's own (a first link to a server that already holds the canvas): kept
      // in its own recovery slot and reported as set aside, never dropped.
      if (metaText !== null && (await i.wasAccepted?.(local)) !== true) {
        keepAside('meta', i.paths.meta, metaText);
      }
      verdicts.push({ lane: 'meta', decision: 'materialize', local });
    }
  }

  // ---- comments / annotations — the accepted value wins (see header)
  for (const lane of ['comments', 'annotations'] as const) {
    const p = lane === 'comments' ? i.paths.comments : i.paths.annotations;
    const text = lane === 'annotations' ? readLocalAnnotations(p, readText) : readText(p);
    const local = text === null ? null : laneValueFromFile(lane, text);
    const accepted = readLaneFromDoc(i.doc, lane);
    if (local === null || local === accepted) {
      verdicts.push({ lane, decision: local === null ? 'materialize' : 'agreed' });
      continue;
    }
    if (lane === 'comments') {
      const owed = commentsOwedToProject(local, accepted, i.slug, i.commentLedger);
      if (owed) {
        verdicts.push({ lane, decision: 'propose', base: accepted, local: owed });
        continue;
      }
    }
    // S1 (2.1.1) — "a difference on disk is an older accepted state" (the header)
    // holds only for a value the project once accepted. One it never did is this
    // Mac's own work: a first link to a server that already holds this canvas, or a
    // raw edit made while the studio was down. Comments and board elements carry
    // stable ids, so it joins the project as the accepted value plus what only this
    // disk has; an id both sides changed keeps the project's, and this Mac's is set
    // aside. A hub's checkout is the project's cache and owes it nothing (T11).
    const onceAccepted = i.checkoutIsCache ? null : ((await i.wasAccepted?.(local)) ?? null);
    if (onceAccepted === false) {
      const joined = unionById(lane, local, accepted);
      if (joined !== null) {
        if (!joined.complete && text) keepAside(lane, p, text);
        verdicts.push({ lane, decision: 'propose', base: accepted, local: joined.value });
        continue;
      }
    }
    if (text) {
      // An older accepted state (or a hub checkout) is kept quietly, as before; anything
      // else of this Mac's that the project's value replaces is reported.
      if (onceAccepted === true || i.checkoutIsCache) saveQuietly(p, text);
      else keepAside(lane, p, text);
    }
    verdicts.push({ lane, decision: 'materialize', local: text ?? undefined });
  }

  // ---- a hub checkout never holds (see `checkoutIsCache`)
  if (i.checkoutIsCache) {
    for (const v of verdicts) {
      if (v.decision !== 'hold') continue;
      const p = v.lane === 'html' ? i.paths.html : v.lane === 'css' ? i.paths.css : undefined;
      if (i.historyDir && p && v.local !== undefined) {
        try {
          saveRecoveryBody(i.historyDir, p, 'local', v.local);
        } catch {
          /* best-effort, as for the other lanes the project's value wins on */
        }
      }
      v.decision = 'materialize';
      v.base = undefined;
    }
  }

  // ---- act
  for (const v of verdicts) {
    if (v.decision === 'propose' && v.local !== undefined) {
      const value = v.lane === 'meta' ? v.local : (laneValueFromFile(v.lane, v.local) ?? v.local);
      if (v.lane === 'html') i.projection.adoptBase(v.base ?? '');
      // Stageable: a restored unfinished AI action (T16) keeps its canvases'
      // differences for the person's decision instead of publishing them.
      void i.projection.proposeLane(v.lane, value, { baseContent: v.base ?? '', stageable: true });
    } else if (v.decision === 'hold' && v.local !== undefined) {
      i.projection.hold(v.lane, v.base ?? '', v.local);
    }
  }
  const moved = verdicts.filter((v) => v.decision === 'propose' || v.decision === 'hold');
  if (moved.length) {
    log.log(
      `[sync/${i.slug}] cold start: ${moved.map((v) => `${v.lane}=${v.decision}`).join(', ')}`
    );
  }
  if (setAside.length) {
    log.warn(
      `[sync/${i.slug}] cold start: the project's ${setAside.join(', ')} replaced this Mac's — kept in the recovery folder.`
    );
  }
  return { kind: 'reconciled', verdicts, ...(setAside.length ? { setAside } : {}) };
}

const SET_ASIDE_WORDS: Partial<Record<ProposalLane, string>> = {
  meta: 'layout',
  annotations: 'sticky notes',
  comments: 'comments',
};

/** S1 — the Sync notice for lanes set aside at cold start (CONTRACT §3–§4 voice). */
export function setAsideNotice(rel: string, slug: string, lanes: readonly ProposalLane[]): string {
  const name =
    rel
      .split('/')
      .pop()
      ?.replace(/\.tsx$/i, '') || rel;
  const words = lanes.map((l) => SET_ASIDE_WORDS[l] ?? l);
  const list =
    words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : words[0];
  return `${name}: the project’s ${list} replaced this Mac’s. This Mac’s copy is kept in _history/${slug}/sync-recovery/.`;
}

/**
 * S1 — an id-keyed lane (comments, board elements) joined the way a first link
 * needs: the accepted value, plus the entries only `local` has. `complete` is
 * false when an id both sides hold differs (the project's entry is kept). Null
 * when `local` adds nothing.
 */
export function unionById(
  lane: 'comments' | 'annotations',
  local: string,
  accepted: string
): { value: string; complete: boolean } | null {
  if (lane === 'comments') {
    const there = parseList(accepted);
    const byKey = new Map(there.map((c) => [commentKey(c), JSON.stringify(c)]));
    let complete = true;
    const extra: unknown[] = [];
    for (const c of parseList(local)) {
      const theirs = byKey.get(commentKey(c));
      if (theirs === undefined) extra.push(c);
      else if (theirs !== JSON.stringify(c)) complete = false;
    }
    return extra.length ? { value: JSON.stringify([...there, ...extra]), complete } : null;
  }
  const there = accepted ? parseBoard(accepted).elements : [];
  const byId = new Map(there.map((e) => [e.id, JSON.stringify(e)]));
  let complete = true;
  const extra: AnnotationElement[] = [];
  for (const e of parseBoard(local).elements) {
    const theirs = byId.get(e.id);
    if (theirs === undefined) extra.push(e);
    else if (theirs !== JSON.stringify(e)) complete = false;
  }
  if (!extra.length) return null;
  const value = annotationsLaneValue(serializeBoard([...there, ...extra]));
  return value ? { value, complete } : null;
}
