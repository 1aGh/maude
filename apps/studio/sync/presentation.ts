// One rule for "what is the hub link doing", shared by every surface.
//
// There were two answers to that question and they disagreed. The status bar
// keyed off `state` alone — it referenced `docs` zero times, so a link whose
// every document the hub had refused still showed a green dot and the word
// "synced". The connect note in the cloud rail keyed off the ATTACH RESPONSE,
// a value that means "the runtime started", and never updated again. A user
// who distrusted one was sent to the other, which was wrong in a different way.
//
// So the rule lives here, once, as a pure function over the payload both
// surfaces already receive. Agreement between them is then structural rather
// than a thing two files have to remember.
//
// DDR-054 — document names and project names originate at the hub. Counts come
// first in every sentence so a hostile name cannot dominate it, names are
// capped, and nothing here produces markup.

import type { SyncStatusSnapshot } from './connection-state.ts';

/** Where a link is, in the terms a person cares about. */
export type SyncPhase =
  | 'connecting'
  | 'syncing'
  | 'synced'
  | 'stalled'
  | 'refused'
  | 'offline'
  | 'nothing-syncable'
  /** The link works, but part of the project did not get through. */
  | 'attention';

/**
 * How long `connecting…` may honestly stay on screen with ZERO documents
 * synced before it becomes a different sentence. A real handshake settles in
 * seconds; five minutes of nothing is not a connection in progress, it is a
 * link that needs a person (the alligators incident sat in `connecting…` for
 * DAYS while every document was being refused). Matches the auth re-probe
 * cadence so the claim "nothing is moving" has had at least one full retry
 * cycle behind it.
 */
export const STALL_AFTER_MS = 5 * 60 * 1000;

export interface SyncPresentation {
  phase: SyncPhase;
  /** Green dot — reserved for a link that is genuinely carrying edits. */
  online: boolean;
  /** Status-bar slot text. Terse; never contains a hub-supplied name. */
  label: string;
  /** Full sentence — the rail note and the status-bar hover. */
  title: string;
  /**
   * What the person should do now, or null when the honest answer is "nothing,
   * it is working". Every non-null phase names one — being told a state without
   * being told the move is the complaint this whole change exists for.
   */
  next: string | null;
  /** Up to 3 hub-supplied names relevant to the phase (refused / pulled). */
  names: string[];
}

/**
 * The `/_sync-status` payload, in its three historical shapes:
 *   - `{ linked: false }`                      — solo project, no link
 *   - `{ notSyncable, tsxCount, reason }`      — DDR-060, linked but 0 syncable
 *   - the connection-state snapshot + url/canvases (the common case)
 *
 * Every field is optional on purpose: pre-DDR-102 payloads have no `docs`, and
 * the browser and the CLI read the same JSON.
 */
export interface SyncStatusLike extends Partial<SyncStatusSnapshot> {
  linked?: boolean;
  notSyncable?: boolean;
  tsxCount?: number;
  reason?: string;
  canvases?: number;
  /**
   * The other lanes `_sync.json` carries (`status.ts`): source-sync conflicts,
   * the file plane, the asset push. Typed `unknown` on purpose — they are read
   * off disk with no schema and validated below, never trusted.
   */
  conflicts?: unknown;
  files?: unknown;
  assets?: unknown;
  /** Accepted-revisions save counters (plan T29) — validated below. */
  accepted?: unknown;
  /** An AI action open or held (plan T16) — validated below. */
  aiAction?: unknown;
}

/** Hub-supplied text that reaches a UI. Bounded, never markup. */
const MAX_NAME_LEN = 60;
const SHOWN_NAMES = 3;

/** A whole sentence, not a name — the diagnose() details are up to ~90 chars. */
const MAX_DETAIL_LEN = 160;

export function safeName(raw: unknown, fallback: string): string {
  // Length alone was not enough. A name is hub-supplied (cell mode sets it from
  // `MAUDE_PROJECT_NAME`; `.design/config.json` is a committed file anyone with
  // repo access can author), and it lands in trusted app chrome — including a
  // `title=` tooltip, where a newline RENDERS and can push the true clause out
  // of view. `All 75 canvases synced.\n\n\n` fits inside 60 characters and
  // reads as a reassuring sentence of ours.
  //
  // So: strip control and format characters (which covers the bidi overrides
  // U+202A–U+202E / U+2066–U+2069 — a name that reverses the rest of the line
  // is the same attack by a different mechanism), then collapse whitespace to
  // single spaces so no name can ever contain a line break.
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return fallback;
  return s.length > MAX_NAME_LEN ? `${s.slice(0, MAX_NAME_LEN)}…` : s;
}

/**
 * The same sanitizing, for a SENTENCE.
 *
 * `SyncStartOutcome.detail` is a full clause a person is meant to act on
 * ("No sign-in for this workspace is stored on this machine yet."), and at
 * `safeName`'s 60-character name budget the useful half is exactly what gets
 * cut. The stripping is identical and non-negotiable — the string still passes
 * through the server from a hub-influenced world — only the budget differs.
 */
export function safeDetail(raw: unknown, fallback: string): string {
  const s = String(raw ?? '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!s) return fallback;
  return s.length > MAX_DETAIL_LEN ? `${s.slice(0, MAX_DETAIL_LEN)}…` : s;
}

function shownNames(list: readonly string[] | undefined): string[] {
  return (list ?? []).slice(0, SHOWN_NAMES).map((n) => safeName(n, '(unnamed)'));
}

/**
 * The per-document counts, or null if they cannot be trusted.
 *
 * FAIL CLOSED. `/_sync-status` returns `JSON.parse` of `_sync.json` with no
 * schema, so this function's input is whatever is on disk — a partial write, an
 * older producer, a newer one. `synced` was the FALL-THROUGH branch, which made
 * the reassuring answer the only reachable one for any shape not recognised:
 * `docs: {}` gave `total === NaN`, failed both `> 0` and `=== 0`, and rendered
 * "Synced — all NaN canvases", green. For a module whose entire premise is that
 * it does not overstate, the unreadable case must land in `connecting`, never
 * in `synced`.
 */
function readCounts(
  docs: SyncStatusLike['docs']
): { synced: number; pending: number; rejected: number } | null {
  if (!docs) return null;
  const ok = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
  if (!ok(docs.synced) || !ok(docs.pending) || !ok(docs.rejected)) return null;
  return { synced: docs.synced, pending: docs.pending, rejected: docs.rejected };
}

const isCount = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n >= 0;
const isRecord = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

/** What the non-document lanes say, validated. */
interface LaneFacts {
  /** A payload field we cannot read. Fail closed: never "synced". */
  unreadable: boolean;
  /** Canvases whose source change was refused and is waiting (#121 / T2). */
  sourceSlugs: string[];
  failedFiles: number;
  tooLarge: number;
  blockedOther: number;
  /** Changes a breaker is holding for a person's decision. */
  held: number;
  failedMedia: number;
  /** Files or media still moving on their own. */
  moving:
    | { delivered: number; tracked: number }
    | { media: { done: number; total: number } }
    | null;
  paused: boolean;
}

/**
 * Audit 2026-09-13 P0 #3 — "synced" is a claim about the whole project, not
 * about the document sockets. The payload already carried refused source
 * changes, failed files, a blocked seed and failed uploads; the summary read
 * none of them and said "Synced … all 91 canvases" over all four.
 */
function readLanes(status: SyncStatusLike): LaneFacts {
  const facts: LaneFacts = {
    unreadable: false,
    sourceSlugs: [],
    failedFiles: 0,
    tooLarge: 0,
    blockedOther: 0,
    held: 0,
    failedMedia: 0,
    moving: null,
    paused: false,
  };
  const { conflicts, files, assets } = status;
  if (conflicts !== undefined) {
    if (!Array.isArray(conflicts)) facts.unreadable = true;
    else {
      for (const c of conflicts) {
        // `body-rejected` is the only kind that stays until it is resolved
        // (`clearSourceConflict`); cold-start notes record a decision made.
        if (isRecord(c) && c.kind === 'body-rejected') {
          facts.sourceSlugs.push(typeof c.slug === 'string' ? c.slug : '(unnamed)');
        }
      }
    }
  }
  if (files !== undefined) {
    if (!isRecord(files)) facts.unreadable = true;
    else {
      for (const key of ['synced', 'pulled', 'conflicts', 'pushed', 'failed'] as const) {
        if (files[key] !== undefined && !isCount(files[key])) facts.unreadable = true;
      }
      if (isCount(files.failed)) facts.failedFiles = files.failed;
      if (Array.isArray(files.held)) {
        for (const h of files.held) facts.held += isRecord(h) && isCount(h.count) ? h.count : 1;
      }
      if (isRecord(files.rateLimited)) facts.paused = true;
      const progress = files.progress;
      if (isRecord(progress)) {
        if (Array.isArray(progress.blocked)) {
          for (const b of progress.blocked) {
            if (!isRecord(b) || !isCount(b.count)) continue;
            if (b.class === 'too-large') facts.tooLarge += b.count;
            else facts.blockedOther += b.count;
          }
        }
        if (progress.phase === 'paused') facts.paused = true;
        if (
          progress.phase === 'scanning' ||
          progress.phase === 'seeding' ||
          progress.phase === 'paused'
        ) {
          facts.moving =
            isCount(progress.delivered) && isCount(progress.tracked)
              ? {
                  delivered: Math.min(progress.delivered, progress.tracked),
                  tracked: progress.tracked,
                }
              : { delivered: 0, tracked: 0 };
        }
      } else if (progress !== undefined) facts.unreadable = true;
    }
  }
  if (assets !== undefined) {
    if (!isRecord(assets)) facts.unreadable = true;
    else {
      if (isCount(assets.failedCount)) facts.failedMedia = assets.failedCount;
      else if (assets.failedCount !== undefined) facts.unreadable = true;
      if (assets.finished === false && !facts.moving) {
        facts.moving = {
          media: {
            done: isCount(assets.done) ? assets.done : 0,
            total: isCount(assets.total) ? assets.total : 0,
          },
        };
      }
    }
  }
  return facts;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/**
 * Read a sync payload the way a person would.
 *
 * Returns null when there is nothing to say — an unlinked project has no hub
 * status, and inventing one would put a slot on screen that can only ever be
 * empty.
 */
export function syncPresentation(
  status: SyncStatusLike | null | undefined,
  opts: { project?: string | null; now?: number } = {}
): SyncPresentation | null {
  if (!status || status.linked === false) return null;
  const project = safeName(opts.project, 'the workspace');
  const now = typeof opts.now === 'number' ? opts.now : Date.now();

  // ZERO PROGRESS HAS A DEADLINE. Every `connecting…` below is honest for a
  // handshake and a lie after five minutes of it — the phase reads as "in
  // progress" while nothing is moving and nothing will. Once the link has
  // been trying since `startedAt` with not one document synced, the sentence
  // changes to the one that names the move. Validated like everything else
  // read off disk; an absent/garbage stamp simply never stalls (old payloads).
  const startedAt =
    typeof status.startedAt === 'number' &&
    Number.isFinite(status.startedAt) &&
    status.startedAt > 0
      ? status.startedAt
      : null;
  /**
   * @param credentialUnknown  Can an expired sign-in still be the cause?
   *
   * ONLY BLAME THE SIGN-IN WHEN THE SIGN-IN COULD BE THE PROBLEM (issue #118).
   * This unconditionally told the person to reconnect the workspace because
   * "the sign-in may have expired" — at call sites that have ALREADY proved
   * `rejected === 0`, i.e. where the hub has refused exactly nothing and the
   * credential is demonstrably fine. Naming a cause we have evidence against is
   * worse than naming none: it sent the reporter to Resync, which re-handshakes
   * every canvas against a hub that is not answering, times out the fresh
   * monitor's grace window, and lands on `offline`. The product talked the
   * person into making its own display worse.
   *
   * A rejection has its OWN branch (`phase: 'refused'`) and outranks this one,
   * and it is the branch that may legitimately say "credential". Here we say
   * what we actually know: the hub is not completing handshakes. Only the
   * legacy no-`docs` payload, where refusals are unknowable, keeps the older
   * hedge — and it is written as a possibility rather than a diagnosis.
   */
  const stalled = (credentialUnknown = false): SyncPresentation => {
    // `?? now` rather than a cast: every call site is behind `isStalled`, which
    // has already proved `startedAt` is a number — and a future one that isn't
    // reads "1 minute" instead of "NaN minutes".
    const min = Math.max(1, Math.round((now - (startedAt ?? now)) / 60_000));
    return {
      phase: 'stalled',
      online: false,
      label: 'stalled',
      title: `Nothing has synced with ${project} in the ${min} minute${min === 1 ? '' : 's'} since Maude started trying.`,
      next: credentialUnknown
        ? 'Maude keeps retrying. If it persists, reconnect the workspace — the sign-in may have expired.'
        : 'Maude keeps retrying — the workspace is reachable but is not completing handshakes.',
      names: [],
    };
  };
  const isStalled = startedAt !== null && now - startedAt > STALL_AFTER_MS;

  if (status.notSyncable) {
    const tsx = status.tsxCount ?? 0;
    return {
      phase: 'nothing-syncable',
      online: false,
      label: `0 syncable${tsx > 0 ? ` · ${tsx} tsx` : ''}`,
      title: status.reason
        ? safeName(status.reason, 'No canvases in this project are syncable yet.')
        : `Connected to ${project} — no canvases here are syncable yet.`,
      next: 'Create a canvas — it will start syncing on its own.',
      names: [],
    };
  }

  const queued = status.queuedOps ?? 0;
  const queueNote = queued > 0 ? ` ${queued} local edit${queued === 1 ? '' : 's'} are queued.` : '';
  const unreachable = status.state === 'offline' || status.state === 'offline-long';
  const lanes = readLanes(status);

  /**
   * Part of the project did not get through. `sourceOnly` is the ranking
   * split: a refused source change never heals on its own, so it outranks an
   * unreachable hub; a failed transfer may be the outage itself, so file and
   * media problems rank below it.
   */
  const attention = (sourceOnly: boolean): SyncPresentation | null => {
    const parts: string[] = [];
    let items = 0;
    const add = (n: number, text: string) => {
      if (n <= 0) return;
      parts.push(text);
      items += n;
    };
    const src = lanes.sourceSlugs.length;
    add(src, `${plural(src, 'source change')} ${src === 1 ? 'was' : 'were'} not applied`);
    if (!sourceOnly) {
      add(lanes.failedFiles, `${plural(lanes.failedFiles, 'file')} could not be delivered`);
      add(
        lanes.tooLarge,
        `${plural(lanes.tooLarge, 'file')} ${lanes.tooLarge === 1 ? 'is' : 'are'} too large to sync`
      );
      add(
        lanes.blockedOther,
        `${plural(lanes.blockedOther, 'file')} ${lanes.blockedOther === 1 ? 'is' : 'are'} blocked`
      );
      add(
        lanes.held,
        `${plural(lanes.held, 'change')} ${lanes.held === 1 ? 'is' : 'are'} held for your decision`
      );
      add(lanes.failedMedia, `${plural(lanes.failedMedia, 'media upload')} failed`);
    }
    if (items === 0) return null;
    return {
      phase: 'attention',
      online: false,
      label: `${items} to review`,
      title:
        `${items === 1 ? 'A change needs' : `${items} changes need`} your attention in ${project}: ` +
        `${parts.join('; ')}.` +
        (unreachable ? ' The hub is also unreachable right now.' : '') +
        queueNote,
      next: 'Open the Sync panel to see what is waiting and why.',
      names: shownNames(lanes.sourceSlugs),
    };
  };
  // Validated, not taken on trust — see `readCounts`. `null` means "unreadable",
  // which is deliberately NOT the same as "absent" (an old payload, handled
  // below) and must never reach the synced branch.
  const docs = readCounts(status.docs);
  const unreadable = status.docs !== undefined && docs === null;

  // A REFUSAL OUTRANKS EVERYTHING, including an unreachable hub.
  //
  // The offline branch used to sit above this one, and that was the bug from
  // one branch up: a hub can refuse auth on the documents it wants silenced and
  // then drop the sockets, and the user would be told "your edits are safe and
  // queued — nothing to do". For an auth-rejected document that is false and
  // never self-heals. Rejections are deliberately sticky (a dropped socket does
  // not launder them), so if one is on record it is still true while offline —
  // and it is the only part of the picture that needs a person.
  if (docs && docs.rejected > 0) {
    const total = docs.synced + docs.pending + docs.rejected;
    return {
      phase: 'refused',
      online: false,
      label: `${docs.rejected} refused`,
      title:
        `${docs.rejected} of ${total} canvas${total === 1 ? '' : 'es'} were refused by ${project} — their edits are not syncing.` +
        (unreachable ? ' The hub is also unreachable right now.' : ''),
      next: 'Reconnect the workspace — the credential may have been rotated.',
      names: shownNames(status.rejectedSlugs),
    };
  }

  // Accepted revisions: the project answered "sign in first" to a change —
  // the sign-in was revoked or its person removed. The change is kept on this
  // device and retried, but it cannot reach anyone until someone signs in
  // again, so this is a refusal, never "Saving … check your connection".
  const refusedSignIn = readAcceptedRefused(status.accepted);
  if (refusedSignIn) {
    const n = refusedSignIn.pending;
    return {
      phase: 'refused',
      online: false,
      label: 'sign in again',
      title:
        `${project} no longer accepts your sign-in — ` +
        (n > 0
          ? `${n} change${n === 1 ? ' is' : 's are'} kept on this device and not shared.`
          : 'your changes are not shared.'),
      next: 'Sign in again to share them.',
      names: [],
    };
  }

  // A refused SOURCE change outranks an unreachable hub for the same reason a
  // refusal does: it is sticky, and it is the part that needs a person.
  // (With the hub reachable, the same sentence lists every other lane too.)
  if (lanes.sourceSlugs.length > 0) {
    const sourceAttention = attention(unreachable);
    if (sourceAttention) return sourceAttention;
  }

  // Otherwise an unreachable hub outranks every count. Whatever the documents
  // last said, nothing is moving — and "72 synced" over a dead socket is the
  // exact shape of lie this module exists to stop.
  //
  // Count first, name second: `project` is hub-supplied, and a leading name is
  // a name that gets to set the tone of our own sentence.
  if (unreachable) {
    return {
      phase: 'offline',
      online: false,
      label: queued > 0 ? `offline · ${queued} ↑` : 'offline',
      title: `Not reachable: ${project}. Your edits are safe on this machine and queued.${queueNote}`,
      next: 'Nothing to do — syncing resumes by itself when the hub is back.',
      names: [],
    };
  }

  if (unreadable || lanes.unreadable) {
    // A payload we cannot read is not a payload that says everything is fine.
    return {
      phase: 'connecting',
      online: false,
      label: 'status unreadable',
      title: `Cannot read the sync status for ${project} — the counts on disk are malformed.`,
      next: 'Reconnect the workspace; if it persists, restart Maude.',
      names: [],
    };
  }

  if (!docs) {
    // Pre-DDR-102 payload: `state` is all there is. Report it as the weaker
    // evidence it is, rather than promoting it to a document-level claim.
    const online = status.state === 'online' || status.flash === 'synced';
    // Pre-DDR-102 payload — no per-document counts, so a refusal cannot be
    // ruled out and the credential hedge stays.
    if (!online && isStalled) return stalled(true);
    const laneAttention = online ? attention(false) : null;
    if (laneAttention) return laneAttention;
    return {
      phase: online ? 'synced' : 'connecting',
      online,
      label: online ? (queued > 0 ? `${queued} ↑` : 'synced') : 'connecting…',
      title: online ? `Syncing with ${project}.${queueNote}` : `Connecting to ${project}…`,
      next: online ? null : 'Nothing to do — this usually takes a moment.',
      names: [],
    };
  }

  // Refusals were already handled above — they outrank an unreachable hub, so
  // that branch has to come first. Everything from here on has `rejected === 0`.
  const total = docs.synced + docs.pending + docs.rejected;

  if (total === 0) {
    if (isStalled) return stalled();
    return {
      phase: 'connecting',
      online: false,
      label: 'connecting…',
      title: `Connecting to ${project}…`,
      next: 'Nothing to do — this usually takes a moment.',
      names: [],
    };
  }

  // Needs a person, so it outranks work that will finish by itself.
  const laneAttention = attention(false);
  if (laneAttention) return laneAttention;

  // Plan T16 — an AI edit that did not finish is kept on this device, not
  // shared. It is the person's decision, so it reads as attention.
  const ai = readAiAction(status.aiAction);
  if (ai?.state === 'held') {
    const n = ai.canvases;
    return {
      phase: 'attention',
      online: true,
      label: 'AI edit held',
      title: `An unfinished AI edit to ${n} canvas${n === 1 ? '' : 'es'} is kept on this device — it is not shared with ${project} yet.`,
      next: 'Open the Sync panel to publish it as it stands or discard it.',
      names: [],
    };
  }

  if (docs.pending > 0) {
    // Zero settled yet is a different fact from some settled: one is a
    // handshake in flight, the other is visible progress.
    const started = docs.synced > 0;
    if (!started && isStalled) return stalled();
    return {
      phase: started ? 'syncing' : 'connecting',
      online: false,
      label: started ? `${docs.synced}/${total}` : 'connecting…',
      title: started
        ? `Syncing with ${project} — ${docs.synced} of ${total} canvas${total === 1 ? '' : 'es'} so far.`
        : `Connecting to ${project}…`,
      next: 'Nothing to do — this usually takes a moment.',
      names: [],
    };
  }

  // Every canvas is in step, but files or media are still moving: that is
  // syncing, not synced. The denominator is the ledger's (seed-progress.ts).
  if (lanes.moving) {
    const m = lanes.moving;
    const detail =
      'media' in m
        ? `uploading media (${m.media.done} of ${m.media.total})`
        : m.tracked > 0
          ? `files ${m.delivered} of ${m.tracked} delivered`
          : 'checking project files';
    return {
      phase: 'syncing',
      online: true,
      label:
        'media' in m ? 'media ↑' : m.tracked > 0 ? `${m.delivered}/${m.tracked} files` : 'files…',
      title:
        `Syncing with ${project} — all ${total} canvas${total === 1 ? '' : 'es'} in step, ${detail}.` +
        (lanes.paused ? ' Paused while the hub asks us to wait.' : '') +
        queueNote,
      next: 'Nothing to do — this continues on its own.',
      names: [],
    };
  }

  // Plan T29 — accepted revisions: "synced" documents only mean the replica is
  // current. A change still waiting for the project's durable answer is saved
  // on this device, not yet shared — so it is Saving, never Saved.
  if (ai?.state === 'open') {
    return {
      phase: 'syncing',
      online: true,
      label: 'AI editing',
      title: `An AI edit is in progress — its changes are shared with ${project} together when it finishes.`,
      next: null,
      names: [],
    };
  }
  const acceptedPending = readAcceptedPending(status.accepted);
  if (acceptedPending) {
    const ageS = acceptedPending.oldestPendingAt
      ? Math.max(0, Math.round((Date.now() - acceptedPending.oldestPendingAt) / 1000))
      : 0;
    return {
      phase: 'syncing',
      online: true,
      label: `saving ${acceptedPending.pending}`,
      title:
        `Saving ${acceptedPending.pending} change${acceptedPending.pending === 1 ? '' : 's'} to ${project}` +
        (ageS >= 10 ? ` — the oldest has waited ${ageS} s.` : '.') +
        ' They are kept on this device until the project confirms them.',
      next: ageS >= 60 ? 'Maude keeps trying. If this persists, check your connection.' : null,
      names: [],
    };
  }

  // Clamped and validated for the same reason as the doc counts: `count` is
  // read off disk, and "1000000000 came down from the project" is not a
  // sentence this module should be capable of producing. The ceiling is `total`
  // — a pulled document becomes one of the canvases being counted, so more
  // pulled than exist is not a big number, it is a broken payload.
  const rawPulled = status.pulled?.count;
  const pulledCount =
    typeof rawPulled === 'number' && Number.isInteger(rawPulled) && rawPulled >= 0
      ? Math.min(rawPulled, total)
      : 0;
  return {
    phase: 'synced',
    online: true,
    label: queued > 0 ? `${queued} ↑` : 'synced',
    title:
      `Synced with ${project} — all ${total} canvas${total === 1 ? '' : 'es'}.` +
      (pulledCount > 0 ? ` ${pulledCount} came down from the project on this connect.` : '') +
      queueNote,
    // Deliberately NOT "open one of the canvases that just arrived". A pulled
    // canvas is hub-authored TSX (DDR-054, and the DDR-079 residual it carries),
    // and an imperative in our own green success sentence is the strongest
    // possible endorsement of content we do not vouch for. State the fact; the
    // decision to open stays the person's.
    next: pulledCount > 0 ? 'They are new to this machine — look them over before editing.' : null,
    names: pulledCount > 0 ? shownNames(status.pulled?.names) : [],
  };
}

/** `status.accepted`, validated — it is read off disk like every other count. */
function readAcceptedPending(
  raw: unknown
): { pending: number; oldestPendingAt: number | null } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { pending?: unknown; oldestPendingAt?: unknown };
  const pending = r.pending;
  if (typeof pending !== 'number' || !Number.isInteger(pending) || pending <= 0 || pending > 1e6)
    return null;
  const at = r.oldestPendingAt;
  return {
    pending,
    oldestPendingAt: typeof at === 'number' && Number.isFinite(at) && at > 0 ? at : null,
  };
}

/** `status.accepted.credentialRefused`, validated — only a literal `true` counts. */
function readAcceptedRefused(raw: unknown): { pending: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { credentialRefused?: unknown; pending?: unknown };
  if (r.credentialRefused !== true) return null;
  const p = r.pending;
  return { pending: typeof p === 'number' && Number.isInteger(p) && p > 0 && p <= 1e6 ? p : 0 };
}

/** `status.aiAction`, validated — never trusted off disk. */
function readAiAction(raw: unknown): { state: 'open' | 'held'; canvases: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { state?: unknown; canvases?: unknown };
  if (r.state !== 'open' && r.state !== 'held') return null;
  const canvases = Array.isArray(r.canvases) ? Math.min(r.canvases.length, 10_000) : 0;
  return { state: r.state, canvases };
}
