// Loop-free bidirectional disk projection for the shared-doc path — Phase 9.2
// (DDR-064 Tasks 6 + 7).
//
// In the two-doc world (flag OFF) the sync AGENT mirrored a SECOND doc to disk.
// Under MAUDE_SHARED_DOC there is ONE doc per canvas (the collab room's), so the
// file stops being a reconciliation medium and becomes a materialized
// PROJECTION of the doc (Zed's principle). This module owns that projection:
//
//   doc → file  (browser/hub edits converged): debounced, hash-gated, writes the
//                human-readable files. The projector writes html/css/meta ONLY —
//                the collab room already persists comments + annotations doc→file
//                (persistence.ts), so projecting them here too would double-write.
//   file → doc  (external edit by /design:edit, a human, git): diff the file
//                against the doc's current materialization and apply ONLY the
//                delta as Yjs ops tagged ORIGINS.FILE_IMPORT — never a wholesale
//                replace (that was the Phase 9.1 clobber). All 5 types import.
//
// Loop freedom rests on two guards, exactly as the agent's:
//   1. echo hash — every doc→file write records sha256(bytes); the fs event it
//      triggers carries the same hash → consume() drops it.
//   2. origin    — a file→doc import is tagged FILE_IMPORT; the projector's own
//      doc.on('update') skips that origin so it doesn't re-project what it just
//      imported.
// Plus a per-path circuit breaker: a file that fails to PARSE 3× in a row is
// quarantined until its checksum changes, so an unparseable file can't spin.

import { existsSync, readFileSync } from 'node:fs';

import type * as Y from 'yjs';

import { atomicWrite } from './atomic-write.ts';
import {
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyCssToDoc,
  applyHtmlToDoc,
  applyMetaToDoc,
  cssFromDoc,
  htmlFromDoc,
  laneValueFromFile,
  mergeSharedMetaIntoLocal,
  metaFromDoc,
  movedToFromDoc,
  readLaneFromDoc,
  stampAnnotationsEdit,
  stampBodyEdit,
} from './codec.ts';
import { type EchoGuard, hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import { MAX_CSS_BYTES, MAX_HTML_BYTES, MAX_META_BYTES, withinByteCap } from './limits.ts';
import { ORIGINS } from './origins.ts';
import { repairSeedDuplication } from './seed-repair.ts';
import { mergeSource } from './source-merge.ts';
import { saveRecoveryBody } from './source-recovery.ts';
import { sourceError } from './source-validation.ts';
import { laneHash } from './transaction-client.ts';

export const PROJECT_FLUSH_MS = 800;
/**
 * Accepted revisions arrive as whole, validated states — not a keystroke
 * stream from a peer's editor that the 800 ms debounce exists to coalesce — so
 * the receiving disk (and the canvas that renders from it) follows almost at
 * once.
 */
export const ACCEPTED_FLUSH_MS = 30;
export const CIRCUIT_MAX_STRIKES = 3;

export interface ProjectionPaths {
  /** Absolute path to the canvas body (`.html` or opted-in `.tsx`). */
  html: string;
  /** Absolute path to `_comments/<slug>.json`. */
  comments: string;
  /** Absolute path to `<slug>.annotations.svg`. */
  annotations: string;
  /** Absolute path to the canvas `.meta.json` sibling (optional). */
  meta?: string;
  /** Absolute path to the canvas `.css` sibling (optional). */
  css?: string;
}

export interface BodyRejection {
  slug: string;
  kind: 'body-rejected';
  reason: 'invalid-source' | 'local-edit' | 'history-failed' | 'merge-budget';
  snapshotFailed: boolean;
}

export interface DocProjectionOptions {
  slug: string;
  doc: Y.Doc;
  paths: ProjectionPaths;
  /**
   * Echo guard shared with the rest of the sync runtime so a doc→file write here
   * is recognized as an echo when its fs event arrives. Optional — a standalone
   * test can omit it (echo handling then relies on the hash-equality drop only).
   */
  echoGuard?: EchoGuard;
  /** Injected for tests — defaults to atomicWrite. */
  writer?: (path: string, bytes: string | Uint8Array) => void;
  /**
   * Called with the absolute path after a doc→file write LANDS.
   *
   * Exists for one environment: a cell, where the container's recursive
   * `fs.watch` does not see our atomic tmp+rename writes. Locally the watcher
   * fires and the runtime leaves this unset — the same "the watcher owes us this
   * event" reasoning (and the same workspace-mode gate) as
   * `createContainerWriteBridge`, which covers the API write path and cannot
   * cover this one because the projector never arms `activity:suppress`.
   *
   * Without it a peer's edit reaches the doc, reaches disk, and the browser's
   * canvas iframe still shows the old render until somebody reloads by hand.
   */
  onWrote?: (absPath: string) => void;
  /** Override the 800 ms debounce. Tests use 0 to flush on the next microtask. */
  flushMs?: number;
  /** Circuit-breaker threshold (consecutive parse failures per path). */
  maxStrikes?: number;
  /** DDR-102 — per-machine sync journal; every successful disk↔doc body/css
   *  traversal checkpoints here (same discipline as the agent). Optional. */
  journal?: SyncJournal;
  /** Bounded recovery slots, separate from rolling history. */
  historyDir?: string;
  onConflict?: (info: BodyRejection) => void;
  onRecovered?: () => void;
  /** Runtime waits for cold-start snapshots before allowing any projection. */
  waitForReconcile?: boolean;
  /**
   * ACCEPTED-REVISIONS MODE (DDR-241). While `accepted.on()` holds, a local
   * change is never written into the shared document: it is PROPOSED with the
   * value it was derived from, and the document changes only when the hub
   * publishes the accepted (possibly merged) revision. The file is the
   * candidate until then; a rejection keeps it and reports a conflict.
   */
  accepted?: AcceptedLaneLink;
}

export type ProposalLane = 'html' | 'css' | 'meta' | 'annotations' | 'comments';
export interface ProposalOutcome {
  status: 'accepted' | 'rejected';
  code?: string;
  /** On a base conflict: the hash of the accepted value that won. */
  head?: string;
}

export interface LaneProposal {
  lane: ProposalLane;
  content: string;
  /** The value this edit was derived from — the hub merges three-way from it. */
  baseContent: string;
  writeId?: string;
  transactionId: string;
  /** An earlier proposal of the same lane this one was authored on top of. */
  dependsOn?: string[];
}

export interface AcceptedLaneLink {
  /** Is the project in accepted-revisions mode right now? */
  on(): boolean;
  newTransactionId(): string;
  propose(p: LaneProposal): Promise<ProposalOutcome>;
}

export interface DocProjection {
  readonly slug: string;
  /** Subscribe to doc updates (doc→file). Idempotent. */
  start(): void;
  /**
   * Apply an external file edit to the doc (file→doc). Returns true when the doc
   * changed. Mirrors the agent's `applyFromFs` signature so the runtime's
   * fs-reader can dispatch to either uniformly.
   */
  applyFromFs(evt: { path: string; bytes: Uint8Array; hash: string }): boolean;
  /** Project the doc's current html/css/meta to disk now (initial materialize).
   *  SAFE: never writes an empty doc value over non-empty local content — the
   *  authoritative push-local-up seed is Phase E (migrate-seed). */
  reconcile(): void;
  /** Force the pending doc→file flush immediately. */
  flush(): Promise<void>;
  /**
   * Adopt `body` as the shared base before `reconcile()`. A restart that could
   * not merge a local candidate (cold start) hands the base back here, so the
   * write stays blocked with a visible conflict and a later save can merge.
   */
  adoptBase(body: string): void;
  /**
   * Accepted-revisions mode: propose one lane value that did not come through
   * the watcher (a comment/annotation API write). Resolves with the outcome;
   * `null` when the projection is not in accepted mode.
   */
  proposeLane(
    lane: ProposalLane,
    value: string,
    opts?: { baseContent?: string; writeId?: string }
  ): Promise<ProposalOutcome> | null;
  /** Lanes with an unresolved proposal (status surfaces). */
  pendingCount(): number;
  /**
   * Accepted-revisions cold start: disk differs from the accepted value and
   * nothing proves what it was derived from. Keep both — block the lane's
   * writer, report the conflict, and let the next save (based on `base`, the
   * accepted value shown in the conflict) resolve it.
   */
  hold(lane: ProposalLane, base: string, local: string): void;
  /** Stop the doc listener + timers. */
  stop(): void;
  /** Test/inspection — the origin used on file→doc imports. */
  readonly importOrigin: object;
}

export function createDocProjection(opts: DocProjectionOptions): DocProjection {
  const { slug, doc, paths } = opts;
  const flushMs = opts.flushMs ?? PROJECT_FLUSH_MS;
  const writer = opts.writer ?? atomicWrite;
  const maxStrikes = opts.maxStrikes ?? CIRCUIT_MAX_STRIKES;
  const importOrigin = ORIGINS.FILE_IMPORT;

  let started = false;
  let stopped = false;
  let dirty = false;
  let ready = !opts.waitForReconcile;
  let observedBody = readLocal(paths.html);
  let rejectedKey: string | null = null;
  let validationCache: { body: string; error: string | null } | null = null;

  function recovered(): void {
    if (rejectedKey !== null) opts.onRecovered?.();
    rejectedKey = null;
  }

  function validation(body: string): string | null {
    if (validationCache?.body === body) return validationCache.error;
    const error = sourceError(paths.html, body);
    validationCache = { body, error };
    return error;
  }

  /** Persist the agreed body beside the journal checkpoint (best-effort). */
  function rememberBase(body: string): void {
    if (!opts.historyDir) return;
    try {
      saveRecoveryBody(opts.historyDir, paths.html, 'base', body);
    } catch {
      /* a restart then falls back to newest-wins — the pre-existing behaviour */
    }
  }

  function preserveLocal(body: string | null): void {
    if (opts.historyDir && body?.trim()) {
      // An invalid local draft can still contain authored work. Keep its raw
      // bytes too before accepting a valid remote replacement.
      saveRecoveryBody(opts.historyDir, paths.html, 'local', body);
      if (validation(body) === null)
        saveRecoveryBody(opts.historyDir, paths.html, 'last-valid', body);
    }
  }

  function reject(
    reason: BodyRejection['reason'],
    local: string | null,
    incoming: string,
    file = paths.html
  ): void {
    const key = `${file}:${reason}:${hashBytes(local ?? '')}:${hashBytes(incoming)}`;
    if (key === rejectedKey) return;
    rejectedKey = key;
    let snapshotFailed = false;
    try {
      if (file === paths.html) preserveLocal(local);
      if (opts.historyDir) {
        if (local !== null) saveRecoveryBody(opts.historyDir, file, 'local', local);
        saveRecoveryBody(opts.historyDir, file, 'incoming', incoming);
      }
    } catch {
      snapshotFailed = true;
    }
    console.warn(`[projection/${slug}] source sync blocked (${reason}); local file kept.`);
    opts.onConflict?.({ slug, kind: 'body-rejected', reason, snapshotFailed });
  }

  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // doc→file last-written hashes (skip redundant writes).
  let lastHtml: string | null = null;
  let lastMeta: string | null = null;
  let lastCss: string | null = null;

  // Circuit breaker: per-path { hash, strikes }. A file that fails to PARSE
  // maxStrikes times in a row is quarantined until its checksum changes.
  const quarantine = new Map<string, { hash: string; strikes: number }>();

  function onDocUpdate(_u: Uint8Array, origin: unknown): void {
    if (stopped) return;
    // Skip our own file→doc import — the file is already current, re-projecting
    // would be a redundant write. (Migration seed is on disk already too.)
    // DISK_PROJECTION is the `syncMeta.path` stamp — bookkeeping ABOUT the
    // file, derived from where the file already is, so it can never make the
    // file stale. (Its own doc comment promised this filterability; this is the
    // step that needed it.)
    if (
      origin === ORIGINS.FILE_IMPORT ||
      origin === ORIGINS.MIGRATION ||
      origin === ORIGINS.DISK_PROJECTION
    ) {
      return;
    }
    // The accepted replica is the hub's to change — a local repair would be a
    // write the fenced connection drops, leaving this replica diverged.
    if (!acceptedOn()) repairSeedDuplication(doc, ORIGINS.DISK_PROJECTION);
    scheduleFlush();
  }

  function scheduleFlush(): void {
    dirty = true;
    if (flushMs === 0) {
      queueMicrotask(() => void flush());
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(
      () => {
        flushTimer = null;
        void flush();
      },
      acceptedOn() ? Math.min(flushMs, ACCEPTED_FLUSH_MS) : flushMs
    );
  }

  function recordEcho(path: string, value: string): void {
    opts.echoGuard?.record(path, hashBytes(value));
  }

  /**
   * Write + announce. Every doc→file write goes through here rather than calling
   * `writer` directly, so a future fourth projected type cannot silently skip
   * the announcement — the bug class this whole hook exists to close.
   *
   * NO-OPS WHEN THE FILE ALREADY HOLDS THESE BYTES. The `last*` guards above
   * compare against what THIS projector wrote, which is null on the first pass —
   * so the cold-start `reconcile()` re-wrote every canvas with content identical
   * to what was already there. Harmless while nobody was listening; once the
   * write announces itself (below) it became a spurious reload of every open
   * canvas at boot. A write that changes nothing should cost nothing, including
   * downstream.
   *
   * `onWrote` is best-effort: it feeds a reload, and a reload that failed to
   * fire must never cost the write that already succeeded.
   */
  function writeAndAnnounce(path: string, value: string): void {
    if (readLocal(path) === value) return;
    writer(path, value);
    try {
      opts.onWrote?.(path);
    } catch (err) {
      console.error(`[projection/${slug}] onWrote(${path}) failed:`, err);
    }
  }

  // Security re-audit (Phase D, finding A2 / DDR-054 §2d): the codec's
  // MAX_*_BYTES caps guard the file→doc *import* lane, but hub-pushed content
  // arrives as raw Yjs updates through the provider (NOT via applyXToDoc), so it
  // bypasses those caps. This doc→file lane is the consumer's guard on that
  // direction — refuse to materialize an oversized hub-pushed body to disk
  // (disk-fill DoS). Returns true when the write is allowed. Shared with
  // `collab/persistence.ts`'s equivalent guard via `limits.ts`.
  function withinCap(path: string, value: string, max: number): boolean {
    return withinByteCap(`projection/${slug}`, path, Buffer.byteLength(value, 'utf8'), max);
  }

  // ----- doc → file (html / css / meta only; room owns comments/annotations)

  function writeHtmlIfChanged(): boolean {
    // A proposal for this lane is in flight: the file is our candidate and the
    // accepted value is about to be republished. Writing the document's
    // current value now would briefly undo the user's own edit.
    if (pending.has('html')) return false;
    const next = htmlFromDoc(doc);
    if (next === lastHtml) return true;
    // Don't clobber a non-empty local body with an empty doc (cold-start before
    // the doc is seeded — the safe-reconcile invariant; full adopt is Phase E).
    if (next === '') {
      lastHtml = next;
      return true;
    }
    if (!withinCap(paths.html, next, MAX_HTML_BYTES)) return false;
    const local = readLocal(paths.html);
    if (validation(next) !== null) {
      reject('invalid-source', local, next);
      return false;
    }
    if (local !== observedBody && local !== next) {
      reject('local-edit', local, next);
      return false;
    }
    try {
      preserveLocal(local);
    } catch {
      reject('history-failed', local, next);
      return false;
    }
    writeAndAnnounce(paths.html, next);
    recordEcho(paths.html, next);
    observedBody = next;
    recovered();
    lastHtml = next;
    opts.journal?.record(slug, { bodyHash: hashBytes(next) }); // DDR-102 checkpoint
    rememberBase(next);
    return true;
  }

  function writeCssIfChanged(): void {
    if (!paths.css) return;
    if (pending.has('css') || held.has('css')) return;
    const next = cssFromDoc(doc);
    if (next === lastCss) return;
    lastCss = next;
    if (next === null) return; // doc carries no css yet — nothing to write
    if (!withinCap(paths.css, next, MAX_CSS_BYTES)) return;
    recordEcho(paths.css, next);
    writeAndAnnounce(paths.css, next);
    opts.journal?.record(slug, { cssHash: hashBytes(next) }); // DDR-102 checkpoint
    if (opts.historyDir) {
      try {
        saveRecoveryBody(opts.historyDir, paths.css, 'base', next);
      } catch {
        /* the journal hash still covers the common case */
      }
    }
  }

  function writeMetaIfChanged(): void {
    if (!paths.meta) return;
    if (pending.has('meta') || held.has('meta')) return;
    const shared = metaFromDoc(doc);
    if (shared === lastMeta) return;
    lastMeta = shared;
    if (shared === null) return; // doc carries no shared meta yet
    const local = readLocal(paths.meta);
    const merged = mergeSharedMetaIntoLocal(local, shared);
    if (merged === null || merged === local) return; // unparseable / disk matches
    if (!withinCap(paths.meta, merged, MAX_META_BYTES)) return;
    recordEcho(paths.meta, merged);
    writeAndAnnounce(paths.meta, merged);
  }

  async function flush(): Promise<void> {
    if (!dirty || stopped || !ready) return;
    // A RETIRED document is write-inert — its canvas moved to a new path in a
    // new document, and materialising this one is how a moved canvas
    // resurrected itself at its old path (see codec stampMovedTo).
    if (movedToFromDoc(doc) !== null) {
      dirty = false;
      return;
    }
    dirty = false;
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    try {
      if (writeHtmlIfChanged()) writeCssIfChanged();
      writeMetaIfChanged();
    } catch (err) {
      dirty = true;
      console.error(`[projection/${slug}] flush failed:`, err);
    }
  }

  // ----- file → doc (all five types; diff-import, FILE_IMPORT origin)

  /** Returns true if the path is currently quarantined for `hash`. */
  function isQuarantined(path: string, hash: string): boolean {
    const q = quarantine.get(path);
    return !!q && q.hash === hash && q.strikes >= maxStrikes;
  }

  /** Record a parse failure; quarantine after maxStrikes for this exact hash. */
  function strike(path: string, hash: string): void {
    const q = quarantine.get(path);
    if (q && q.hash === hash) q.strikes += 1;
    else quarantine.set(path, { hash, strikes: 1 });
    if ((quarantine.get(path)?.strikes ?? 0) >= maxStrikes) {
      console.warn(
        `[projection/${slug}] quarantined ${path} after ${maxStrikes} parse failures; ignoring until its checksum changes.`
      );
    }
  }

  /** Clear any circuit-breaker state for a path (it parsed / changed). */
  function clearStrike(path: string): void {
    quarantine.delete(path);
  }

  // ----- accepted-revisions mode (DDR-241)

  const acceptedOn = (): boolean => !!opts.accepted?.on();
  /** Per lane: proposals not yet answered, and the newest one's id + value. */
  const pending = new Map<ProposalLane, { count: number; lastTx: string; lastValue: string }>();
  /** Lanes whose last answer was a rejection — the local file is the held candidate. */
  const held = new Set<ProposalLane>();
  /** The newest value proposed per lane — its watcher redelivery is not a new edit. */
  const lastProposed = new Map<ProposalLane, string>();
  /** Accepted mode: file events that arrived before the cold start decided. */
  const deferredBeforeReady = new Map<string, string>();

  const REJECTION_REASON: Record<string, BodyRejection['reason']> = {
    'source-invalid': 'invalid-source',
    capacity: 'merge-budget',
    // The change could not even be saved to this machine's outbox.
    'local-persistence': 'history-failed',
  };

  function laneOfPath(p: string): ProposalLane | null {
    if (p === paths.html) return 'html';
    if (paths.css && p === paths.css) return 'css';
    if (paths.meta && p === paths.meta) return 'meta';
    if (p === paths.comments) return 'comments';
    if (p === paths.annotations) return 'annotations';
    return null;
  }

  function pathOfLane(lane: ProposalLane): string {
    if (lane === 'html') return paths.html;
    if (lane === 'css') return paths.css ?? paths.html;
    if (lane === 'meta') return paths.meta ?? paths.html;
    return lane === 'comments' ? paths.comments : paths.annotations;
  }

  /** The value disk and the accepted replica last agreed on for `lane`. */
  function agreedValue(lane: ProposalLane): string {
    if (lane === 'html') return lastHtml ?? htmlFromDoc(doc);
    if (lane === 'css') return lastCss ?? cssFromDoc(doc) ?? '';
    return readLaneFromDoc(doc, lane);
  }

  function onRejected(lane: ProposalLane, local: string, outcome: ProposalOutcome): void {
    held.add(lane);
    // The candidate stays on disk: the projection's local-edit guard protects
    // it (html), `held` blocks the lane writer (css/meta), and the recovery
    // slots keep the bytes whatever happens next.
    //
    // The NEXT save is the resolution, and it is made looking at the version
    // the conflict reports as incoming — so that version becomes its base.
    // Keeping the old base would make every resolution that touches the same
    // region conflict again, forever (there is no way out but typing the
    // other side's bytes back exactly).
    const incoming = readLaneFromDoc(doc, lane);
    if (lane === 'html') {
      observedBody = null;
      lastHtml = incoming;
    } else if (lane === 'css') {
      lastCss = incoming;
    }
    reject(
      REJECTION_REASON[outcome.code ?? ''] ?? 'local-edit',
      local,
      readLaneFromDoc(doc, lane),
      pathOfLane(lane)
    );
  }

  /**
   * Send one lane proposal. A proposal made while an earlier one of the same
   * lane is unanswered was authored ON TOP of it: it is based on that value and
   * DEPENDS on it, so a rejected U1 can never be bypassed by an accepted U2
   * that silently carries half of it (plan T7/T13).
   */
  function submit(
    lane: ProposalLane,
    value: string,
    baseContent: string,
    local: string,
    writeId?: string
  ): Promise<ProposalOutcome> {
    const link = opts.accepted as AcceptedLaneLink;
    const prior = pending.get(lane);
    const transactionId = link.newTransactionId();
    pending.set(lane, {
      count: (prior?.count ?? 0) + 1,
      lastTx: transactionId,
      lastValue: value,
    });
    lastProposed.set(lane, value);
    const settle = async (outcome: ProposalOutcome): Promise<ProposalOutcome> => {
      // A rejection can outrun the publication of the version that beat it
      // (HTTP answer vs. WebSocket update). The conflict must report — and the
      // resolution be based on — THAT version, so wait briefly for it.
      if (outcome.status === 'rejected' && outcome.head) await untilLaneHash(lane, outcome.head);
      const p = pending.get(lane);
      if (p) {
        p.count -= 1;
        if (p.count <= 0) pending.delete(lane);
      }
      if (outcome.status === 'accepted') {
        if (!pending.has(lane)) held.delete(lane);
        if (lane === 'html') recovered();
      } else {
        onRejected(lane, local, outcome);
      }
      scheduleFlush();
      return outcome;
    };
    return link
      .propose({
        lane,
        content: value,
        baseContent,
        transactionId,
        ...(prior ? { dependsOn: [prior.lastTx] } : {}),
        ...(writeId ? { writeId } : {}),
      })
      .then(settle, (err: unknown) => {
        console.error(`[projection/${slug}] proposing ${lane} failed:`, err);
        const code = (err as { code?: unknown })?.code;
        return settle({
          status: 'rejected',
          code: typeof code === 'string' ? code : 'client-error',
        });
      });
  }

  function untilLaneHash(lane: ProposalLane, head: string, ms = 3_000): Promise<void> {
    const matches = () => laneHash(readLaneFromDoc(doc, lane)) === head;
    if (matches()) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        clearTimeout(timer);
        doc.off('update', onUpdate);
        resolve();
      };
      const onUpdate = () => {
        if (matches()) done();
      };
      const timer = setTimeout(done, ms);
      doc.on('update', onUpdate);
    });
  }

  /** Accepted-revisions import: propose the file's lane value; never touch the doc. */
  function proposeFromFs(evt: { path: string; hash: string }, str: string): boolean {
    const lane = laneOfPath(evt.path);
    if (!lane) return false;
    if (lane === 'html') {
      if (str === lastHtml && !held.has('html')) return false; // a redelivered projection
      if (!withinCap(paths.html, str, MAX_HTML_BYTES)) return false;
      if (validation(str) !== null) {
        strike(evt.path, evt.hash);
        reject('invalid-source', str, htmlFromDoc(doc));
        return false;
      }
    } else if (lane === 'css' && str === lastCss && !held.has('css')) {
      return false;
    }
    const value = laneValueFromFile(lane, str);
    if (value === null) {
      strike(evt.path, evt.hash);
      return false;
    }
    clearStrike(evt.path);
    const inFlight = pending.get(lane);
    // The watcher redelivering what we already proposed is not a new edit.
    if (inFlight?.lastValue === value) return false;
    const current = readLaneFromDoc(doc, lane);
    if (value === current) {
      if (inFlight) return false;
      held.delete(lane);
      if (lane === 'html') {
        observedBody = str;
        lastHtml = str;
        recovered();
      } else if (lane === 'css') {
        lastCss = str;
      }
      return false;
    }
    if (!inFlight && !held.has(lane) && lastProposed.get(lane) === value) return false;
    if (lane === 'html') {
      try {
        preserveLocal(str);
      } catch {
        reject('history-failed', str, current);
        return false;
      }
      observedBody = str;
    }
    void submit(lane, value, inFlight ? inFlight.lastValue : agreedValue(lane), str);
    return true;
  }

  function applyFromFs(evt: { path: string; bytes: Uint8Array; hash: string }): boolean {
    if (stopped) return false;
    // Write-inert both ways — a local edit to a stale pre-move file must not
    // revive the retired document (see codec stampMovedTo).
    if (movedToFromDoc(doc) !== null) return false;
    // Echo of our own doc→file write — drop.
    if (opts.echoGuard?.consume(evt.path, evt.hash)) return false;
    // Circuit breaker — a file that won't parse can't spin the loop.
    if (isQuarantined(evt.path, evt.hash)) return false;

    const str = bytesToString(evt.bytes);
    if (acceptedOn()) {
      // Before the cold start has decided, a proposal would race it (and a
      // brand-new canvas is not in the project yet). Remember the path; the
      // file is re-read once the decision is made.
      if (!ready) {
        deferredBeforeReady.set(evt.path, evt.hash);
        return false;
      }
      return proposeFromFs(evt, str);
    }

    if (evt.path === paths.html) {
      // Watchers can deliver the same projection more than once, including
      // after the one-shot echo token was consumed or expired. These bytes
      // contain no new local edit; diffing them against a newer remote body
      // would turn a delayed notification into a rollback of peer work.
      // Compare only the current baseline, so a deliberate A → B → A edit
      // still imports after B advances lastHtml.
      if (str === lastHtml) return false;
      if (!withinCap(paths.html, str, MAX_HTML_BYTES)) return false;
      if (validation(str) !== null) {
        strike(evt.path, evt.hash);
        reject('invalid-source', str, htmlFromDoc(doc));
        return false;
      }
      clearStrike(evt.path);
      // A PEER CHANGED THE DOC SINCE DISK AND DOC LAST AGREED (`lastHtml`), and
      // this save was authored against that older body. Importing it as a
      // whole-file diff against the doc turned every stale byte into an edit
      // and reverted the peer's work (audit 2026-09-13 P0 #1). Merge from the
      // shared base instead; what the merge cannot prove independent — or a
      // merged body that no longer validates — is preserved and blocked, and
      // the conflict stays until a later save actually resolves it.
      const current = htmlFromDoc(doc);
      let next = str;
      if (lastHtml !== null && current !== lastHtml && current !== str) {
        const merged = mergeSource(lastHtml, str, current);
        if (!merged.ok) {
          reject(merged.reason === 'budget' ? 'merge-budget' : 'local-edit', str, current);
          return false;
        }
        if (validation(merged.merged) !== null) {
          reject('local-edit', str, current);
          return false;
        }
        next = merged.merged;
      }
      try {
        preserveLocal(str);
      } catch {
        reject('history-failed', str, htmlFromDoc(doc));
        return false;
      }
      // Body import + syncMeta stamp in ONE transaction (same FILE_IMPORT
      // origin) — peers get a single update carrying the newest-wins stamp.
      let changed = false;
      try {
        doc.transact(() => {
          changed = applyHtmlToDoc(doc, next, importOrigin);
          if (changed) stampBodyEdit(doc, importOrigin);
        }, importOrigin);
      } catch {
        reject('merge-budget', str, htmlFromDoc(doc));
        return false;
      }
      observedBody = str;
      lastHtml = str;
      recovered();
      if (htmlFromDoc(doc) !== str) {
        // A synchronous peer update can land during the import transaction.
        // Only bytes actually on disk count as the projection's baseline.
        scheduleFlush();
      } else if (changed) {
        opts.journal?.record(slug, { bodyHash: evt.hash }); // DDR-102 checkpoint
        rememberBase(str);
      }
      return changed;
    }
    if (paths.css && evt.path === paths.css) {
      let changed: boolean;
      try {
        changed = applyCssToDoc(doc, str, importOrigin);
      } catch {
        strike(evt.path, evt.hash);
        reject('merge-budget', str, cssFromDoc(doc) ?? '', paths.css);
        return false;
      }
      clearStrike(evt.path);
      if (changed) {
        lastCss = str;
        opts.journal?.record(slug, { cssHash: evt.hash }); // DDR-102 checkpoint
      }
      return changed;
    }
    if (paths.meta && evt.path === paths.meta) {
      // applyMetaToDoc parses internally; a parse failure returns false. Detect
      // it explicitly so the circuit breaker can quarantine a broken sidecar.
      if (!isParseableJsonObject(str)) {
        strike(evt.path, evt.hash);
        return false;
      }
      clearStrike(evt.path);
      const changed = applyMetaToDoc(doc, str, importOrigin);
      if (changed) lastMeta = metaFromDoc(doc);
      return changed;
    }
    if (evt.path === paths.comments) {
      const parsed = tryParseJsonArray(str);
      if (parsed === null) {
        strike(evt.path, evt.hash);
        return false;
      }
      clearStrike(evt.path);
      return applyCommentsToDoc(doc, parsed, importOrigin);
    }
    if (evt.path === paths.annotations) {
      clearStrike(evt.path);
      // Apply + per-lane stamp in ONE transaction (mirrors agent.applyFromFs)
      // so a deliberate delete-all (empty wrapper) carries its freshness and
      // survives cold start on other peers (the 2026-08-14 eraser fix).
      let changed = false;
      doc.transact(() => {
        changed = applyAnnotationsToDoc(doc, str, importOrigin);
        if (changed) stampAnnotationsEdit(doc, importOrigin);
      }, importOrigin);
      return changed;
    }
    return false;
  }

  function reconcile(): void {
    if (stopped) return;
    // A retired doc materialises NOTHING (see codec stampMovedTo).
    if (movedToFromDoc(doc) !== null) return;
    ready = true;
    if (deferredBeforeReady.size && acceptedOn()) {
      const owed = [...deferredBeforeReady];
      deferredBeforeReady.clear();
      for (const [p, hash] of owed) {
        const text = readLocal(p);
        if (text !== null) proposeFromFs({ path: p, hash }, text);
      }
    }
    // Materialize the converged doc to disk (html/css/meta). The *IfChanged
    // writers already guard against clobbering non-empty local with empty doc
    // values, so this is safe to run at cold start before the authoritative
    // seed (Phase E) — it only writes what the doc actually holds.
    if (writeHtmlIfChanged()) writeCssIfChanged();
    writeMetaIfChanged();
  }

  return {
    slug,
    importOrigin,
    start() {
      if (started) return;
      // Snapshot before a provider can replace disk. Failure remains fail-closed
      // at the write boundary and is surfaced when a write is attempted.
      try {
        preserveLocal(observedBody);
      } catch {
        /* checked before writes */
      }
      doc.on('update', onDocUpdate);
      started = true;
    },
    applyFromFs,
    reconcile,
    flush,
    adoptBase(body: string) {
      lastHtml = body;
      observedBody = body;
    },
    hold(lane, base, local) {
      held.add(lane);
      if (lane === 'html') {
        lastHtml = base;
        observedBody = null;
      } else if (lane === 'css') {
        lastCss = base;
      }
      reject('local-edit', local, readLaneFromDoc(doc, lane), pathOfLane(lane));
    },
    proposeLane(lane, value, o) {
      if (!acceptedOn() || stopped) return null;
      if (lane === 'html') observedBody = value;
      const inFlight = pending.get(lane);
      if (inFlight?.lastValue === value) return Promise.resolve({ status: 'accepted' });
      if (!inFlight && value === readLaneFromDoc(doc, lane)) {
        held.delete(lane);
        return Promise.resolve({ status: 'accepted' });
      }
      const base = o?.baseContent ?? (inFlight ? inFlight.lastValue : agreedValue(lane));
      return submit(lane, value, base, value, o?.writeId);
    },
    pendingCount() {
      let n = 0;
      for (const p of pending.values()) n += p.count;
      return n;
    },
    stop() {
      stopped = true;
      doc.off('update', onDocUpdate);
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
    },
  };
}

/* ---------------------------------------------------------------- helpers */

function readLocal(p: string): string | null {
  if (!existsSync(p)) return null;
  try {
    return readFileSync(p, 'utf8');
  } catch {
    return null;
  }
}

function bytesToString(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function isParseableJsonObject(s: string): boolean {
  try {
    const v = JSON.parse(s);
    return !!v && typeof v === 'object' && !Array.isArray(v);
  } catch {
    return false;
  }
}

// Same proto-pollution-safe reviver the agent uses (DDR-054 §2g): strip
// dangerous keys at parse time so a hostile file can't seed __proto__ into the
// comment objects yjs serializes to peers.
function tryParseJsonArray(s: string): unknown[] | null {
  try {
    const parsed = JSON.parse(s, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    });
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
