// Per-canvas bidirectional sync agent — Phase 9 Task 4.
//
// Wires together the Y.Doc the HocuspocusProvider keeps in sync with the hub
// and the local on-disk files Claude Code reads + writes:
//
//   `.design/<slug>.html`           ←→ Y.Text  (Y_SYNC_TYPES.html)
//   `.design/_comments/<slug>.json` ←→ Y.Array (Y_TYPES.comments)
//   `.design/<slug>.annotations.svg`←→ Y.Map.svg (Y_TYPES.annotations)
//
// Provider is INJECTED — the agent doesn't import @hocuspocus/provider. This
// keeps the orchestration testable with an in-memory pair of Y.Docs (no hub
// process required) and makes the wiring layer (sync/index.ts) responsible
// for the HocuspocusProvider lifecycle.
//
// Flow A — local edit (Claude `Write`, designer ⌘S) → hub:
//   1. fs.watch fires → fs-mirror debounces 250ms → onRead({bytes, hash})
//   2. echoGuard.consume(path, hash) returns false (genuine edit)
//   3. applyHtmlToDoc(doc, str, agentOrigin) — emits Y op
//   4. HocuspocusProvider broadcasts the op to hub → other peers
//
// Flow B — hub broadcasts other peer's edit → us:
//   1. Provider applies update to doc with NON-agent origin
//   2. doc.on('update') schedules a 800ms-debounced flush
//   3. On flush: htmlFromDoc(doc) → echoGuard.record(path, hash) → atomicWrite
//   4. fs.watch fires → fs-mirror reads → onRead matches the recorded echo
//      → echoGuard.consume returns true → event dropped (no infinite loop)
//
// 800ms quiescence matches the existing Phase 8 collab room flush (DDR-051).
//
// Cold-start resolution (DDR-102, supersedes the v1.1 "always hub-wins"):
// reconcile() feeds the journal-aware decision table in cold-start.ts. A
// hub-wins overwrite of local disk happens ONLY on a clean fast-forward
// (local hash == journal hash); genuine divergence snapshots BOTH versions
// to `_history/<slug>/` and resolves newest-wins (doc syncMeta.bodyEditAt vs
// local file mtime; unknown/tie → hub). Comments union-merge by id.

import { existsSync, readFileSync, statSync } from 'node:fs';

import type * as Y from 'yjs';

import { atomicWrite } from './atomic-write.ts';
import {
  annotationsEditAtFromDoc,
  annotationsFromDoc,
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyCssToDoc,
  applyHtmlToDoc,
  applyMetaToDoc,
  bodyEditAtFromDoc,
  commentsFromDoc,
  cssFromDoc,
  htmlFromDoc,
  isEmptyAnnotationsSvg,
  mergeSharedMetaIntoLocal,
  metaFromDoc,
  movedToFromDoc,
  repairSharedMeta,
  stampAnnotationsEdit,
  stampBodyEdit,
  Y_SYNC_TYPES,
} from './codec.ts';
import {
  decideAnnotationsColdStart,
  decideColdStart,
  decideCssColdStart,
  unionCommentsById,
} from './cold-start.ts';
import { applyColdStart, type ColdStartSnapshotReason } from './cold-start-apply.ts';
import { dedupeCommentsById, hasDuplicateComments } from './comment-identity.ts';
import { type EchoGuard, hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import { rememberSeed, repairSeedDuplication } from './seed-repair.ts';

export const DOC_FLUSH_MS = 800;

/**
 * Window after a `seed-local-up` during which this agent will repair a
 * concurrent-seed duplication (F1). Bounded so the repair only ever fires for
 * the cold-start race — a genuine peer edit that arrives minutes later is NEVER
 * collapsed back to our original seed. Generous relative to the hub sync RTT.
 */
export { SEED_REPAIR_WINDOW_MS } from './seed-repair.ts';

export interface CanvasSyncPaths {
  /** Absolute path to <designRoot>/<canvas>.html. */
  html: string;
  /** Absolute path to <designRoot>/_comments/<slug>.json. */
  comments: string;
  /** Absolute path to <designRoot>/<slug>.annotations.svg. */
  annotations: string;
  /** Absolute path to the canvas `.meta.json` (sibling of the body). Optional:
   *  when set (always, in production wiring), shared meta keys (layout/artboards)
   *  sync while per-user viewport stays local (Phase 9.1 Gap 2). Omitted in
   *  older test constructions → meta sync is simply inert. */
  meta?: string;
  /** Absolute path to the canvas's sibling `.css` (Phase 9.1 Gap 3). Optional —
   *  inline-CSS canvases have none; omitted/absent → css sync is inert. */
  css?: string;
}

export interface CanvasSyncAgentOptions {
  slug: string;
  doc: Y.Doc;
  paths: CanvasSyncPaths;
  echoGuard: EchoGuard;
  /** When true, the first reconcile() pushes local disk state up to the doc
   *  instead of overwriting disk with the doc state. Cleared after first run. */
  adopt?: boolean;
  /** Override the 800ms flush. Tests use 0 to flush synchronously. */
  flushMs?: number;
  /** Injected for tests — defaults to atomicWrite. */
  writer?: (path: string, bytes: string | Uint8Array) => void;
  /**
   * Per-machine sync journal (DDR-102) — the divergence detector. Every
   * successful disk↔doc traversal checkpoints the content hash here; the
   * cold-start decision allows a hub-wins overwrite ONLY when local matches
   * the journal (clean fast-forward). Optional — older test constructions
   * without it simply degrade to the conservative conflict path.
   */
  journal?: SyncJournal;
  /**
   * Snapshot writer (DDR-102 conflict protocol) — persists a body version to
   * `_history/<slug>/` and resolves with the snapshot's ISO ts (null on
   * failure). The runtime wires this to history.ts `writeSnapshot`. Optional —
   * without it the conflict path still resolves newest-wins, just without the
   * recovery snapshots (test-only constructions).
   */
  snapshot?: (content: string, reason: ColdStartSnapshotReason) => Promise<string | null>;
  /**
   * Called when a non-adopt reconcile (cold-start / post-git-pull) found
   * divergent non-empty content on both sides (DDR-102). `winner` is the side
   * newest-wins kept; `snapshots` carries the `_history/` ISO timestamps of
   * the pre-resolution versions (when the snapshot writer is wired). The
   * legacy `cold-start-hub-wins` kind stays in the union for old readers.
   */
  onConflict?: (info: {
    slug: string;
    kind: 'cold-start-hub-wins' | 'cold-start-diverged';
    winner?: 'local' | 'hub';
    snapshots?: { local?: string; hub?: string };
    /** DDR-102 fail-closed (F1): the local snapshot didn't land, so the
     *  hub-wins overwrite was refused and local kept instead. */
    snapshotFailed?: boolean;
  }) => void;
}

export interface CanvasSyncAgent {
  readonly slug: string;
  /** Set up the doc.on('update') listener. Idempotent. */
  start(): void;
  /**
   * Reconcile disk ↔ doc once. In adopt mode, disk wins; otherwise doc
   * (= hub) wins. Call this AFTER the provider's `synced` event.
   */
  reconcile(): Promise<void>;
  /** Apply an fs event (from fs-mirror) to the doc, honoring echo guard. */
  applyFromFs(evt: { path: string; bytes: Uint8Array; hash: string }): boolean;
  /** Force the pending flush timer immediately. */
  flush(): Promise<void>;
  /** Stop all timers + listeners. */
  stop(): void;
  /** Test/inspection: the origin tag used on agent-applied transactions. */
  readonly origin: object;
}

export function createCanvasSyncAgent(opts: CanvasSyncAgentOptions): CanvasSyncAgent {
  const { slug, doc, paths, echoGuard } = opts;
  const flushMs = opts.flushMs ?? DOC_FLUSH_MS;
  const writer = opts.writer ?? atomicWrite;
  let adopt = !!opts.adopt;

  const origin = Object.freeze({ agent: 'sync', slug });

  let started = false;
  let stopped = false;
  let dirty = false;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  // Tracks the last-written contents for each path so we don't issue redundant
  // disk writes when a flush fires but the projection hasn't changed.
  let lastHtml: string | null = null;
  let lastComments: string | null = null;
  let lastAnnotations: string | null = null;
  let lastMeta: string | null = null;
  let lastCss: string | null = null;

  function onDocUpdate(_update: Uint8Array, updateOrigin: unknown): void {
    if (stopped) return;
    // Self-applied (we just synced from disk) — disk is already current.
    if (updateOrigin === origin) return;
    // F1 — a remote update during the seed window may have concatenated a
    // concurrent peer's identical seed onto ours. Collapse it (single elected
    // writer) BEFORE the flush below can mirror a doubled body to disk.
    maybeRepairSeedDuplication();
    maybeCollapseCommentsDuplication();
    scheduleFlush();
  }

  function scheduleFlush(): void {
    dirty = true;
    if (flushMs === 0) {
      // Synchronous mode for tests — fire on next microtask so the doc
      // observer has fully run.
      queueMicrotask(() => {
        void flush();
      });
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushMs);
  }

  /**
   * F1 — collapse a concurrent cold-seed duplication. When two peers
   * `seed-local-up` the SAME body into an empty hub at the same instant, the
   * merged Y.Text holds both insertions (`BODY` × N — un-buildable). This runs
   * on every remote update inside the seed window and, on the single peer the
   * `seededBy` Y.Map LWW elected, re-applies the canonical body so
   * `applyHtmlToDoc`'s diff deletes the trailing duplicate(s). Only the elected
   * owner repairs → the collapse op is emitted once and converges across peers
   * (a non-owner just receives the delete). Restricted to an EXACT repeat of our
   * seed: a divergent edit carries genuine bytes, so we DON'T touch it here —
   * silently collapsing it would discard content. NOTE: that leaves the rare
   * "two DIFFERENT bodies seeded into one empty hub at the same instant" case
   * un-buildable until the NEXT boot, when `decideColdStart` routes it through
   * the conflict path (dual snapshot + newest-wins). This live repair only
   * covers the identical-seed race (the F1 RCA's scenario); the divergent
   * variant is an accepted follow-up, not handled in-flight.
   */
  function maybeRepairSeedDuplication(): void {
    const repaired = repairSeedDuplication(doc, origin);
    if (repaired.includes('body')) {
      lastHtml = htmlFromDoc(doc);
      opts.journal?.record(slug, { bodyHash: hashBytes(lastHtml) });
    }
    if (repaired.includes('css')) {
      lastCss = cssFromDoc(doc);
      if (lastCss !== null) opts.journal?.record(slug, { cssHash: hashBytes(lastCss) });
    }

    if (repaired.length > 0) {
      console.warn(
        `[sync/${slug}] concurrent cold-seed duplication detected in ${repaired.join(
          ' + '
        )} — collapsed to one copy (F1).`
      );
    }
  }

  /**
   * The comments half of the same collision (issue #112) — and deliberately
   * NOT shaped like the body's.
   *
   * The body repair needs the `seededBy` election and an exact-repeat proof
   * because collapsing a Y.Text can only be justified when the discarded bytes
   * are provably a copy. Comments carry stable ids, so "the same comment twice"
   * is decidable per entry, not per lane: the collapse keeps one of two
   * byte-identical-by-identity entries and discards nothing a reader could
   * want. That makes it safe for EVERY peer to run — no election, no seed
   * window, no snapshot (per issue #114's follow-up, a collapse that preserves
   * zero unique bytes must not consume the `_history/` snapshot ring).
   *
   * It converges because `applyCommentsToDoc` emits the collapse as a pure
   * delete of items every peer holds, and concurrent deletes of the same items
   * are idempotent. Running it here — on the remote-update path, before the
   * flush — is what stops a duplicated array from reaching disk and becoming
   * the canvas's new truth.
   */
  function maybeCollapseCommentsDuplication(): void {
    const current = commentsFromDoc(doc);
    if (!hasDuplicateComments(current)) return;
    const collapsed = dedupeCommentsById(current);
    doc.transact(() => {
      applyCommentsToDoc(doc, collapsed, origin);
    }, origin);
    console.warn(
      `[sync/${slug}] comments lane held ${current.length} entries for ${collapsed.length} distinct comments — collapsed (#112).`
    );
  }

  async function flush(): Promise<void> {
    if (!dirty || stopped) return;
    // A RETIRED document is write-inert. Its canvas moved to a new path in a
    // new document; landing another byte from THIS one is how a moved canvas
    // resurrected itself at its old path on every machine (see stampMovedTo).
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
      writeHtmlIfChanged();
      writeCommentsIfChanged();
      writeAnnotationsIfChanged();
      writeMetaIfChanged();
      writeCssIfChanged();
    } catch (err) {
      dirty = true;
      console.error(`[sync/${slug}] flush failed:`, err);
    }
  }

  function writeHtmlIfChanged(): void {
    const next = htmlFromDoc(doc);
    if (next === lastHtml) return;
    const hash = hashBytes(next);
    echoGuard.record(paths.html, hash);
    writer(paths.html, next);
    lastHtml = next;
    // DDR-102 — a successful doc→disk body flush is a journal checkpoint:
    // disk now holds exactly what the hub holds.
    opts.journal?.record(slug, { bodyHash: hash });
  }

  function writeCommentsIfChanged(): void {
    // This lane writes `_comments/<slug>.json` DIRECTLY, not through the api's
    // `saveCommentsForFile` — so it does not inherit that boundary's dedupe.
    // Collapse first (issue #112): a duplicated array reaching disk is how the
    // doubling outlived restarts and became the canvas's truth. Idempotent, and
    // self-originated, so it can't re-enter `onDocUpdate`.
    maybeCollapseCommentsDuplication();
    const next = commentsFromDoc(doc);
    const serialized = next.length > 0 ? `${JSON.stringify(next, null, 2)}\n` : '';
    if (serialized === lastComments) return;
    if (serialized === '') {
      // Empty comments — don't create an empty file; just remember the state.
      lastComments = serialized;
      return;
    }
    const hash = hashBytes(serialized);
    echoGuard.record(paths.comments, hash);
    writer(paths.comments, serialized);
    lastComments = serialized;
  }

  function writeAnnotationsIfChanged(): void {
    const next = annotationsFromDoc(doc);
    const value = next ?? '';
    if (value === lastAnnotations) return;
    if (value === '') {
      // Empty annotations — same handling as comments.
      lastAnnotations = value;
      return;
    }
    const hash = hashBytes(value);
    echoGuard.record(paths.annotations, hash);
    writer(paths.annotations, value);
    lastAnnotations = value;
  }

  function writeMetaIfChanged(): void {
    if (!paths.meta) return;
    const shared = metaFromDoc(doc);
    if (shared === lastMeta) return;
    lastMeta = shared;
    if (shared === null) return; // doc carries no shared meta yet — nothing to merge down
    const local = readLocal(paths.meta);
    const merged = mergeSharedMetaIntoLocal(local, shared);
    if (merged === null || merged === local) return; // unparseable, or disk already matches
    const hash = hashBytes(merged);
    echoGuard.record(paths.meta, hash);
    writer(paths.meta, merged);
  }

  function writeCssIfChanged(): void {
    if (!paths.css) return;
    const next = cssFromDoc(doc);
    if (next === lastCss) return;
    lastCss = next;
    if (next === null) return; // doc carries no css yet — nothing to write
    const hash = hashBytes(next);
    echoGuard.record(paths.css, hash);
    writer(paths.css, next);
    opts.journal?.record(slug, { cssHash: hash }); // DDR-102 checkpoint
  }

  function applyFromFs(evt: { path: string; bytes: Uint8Array; hash: string }): boolean {
    if (stopped) return false;
    // Write-inert both ways — a local edit to a stale pre-move file must not
    // revive the retired document either (see stampMovedTo).
    if (movedToFromDoc(doc) !== null) return false;
    // Echo of our own atomicWrite — drop.
    if (echoGuard.consume(evt.path, evt.hash)) return false;

    const str = bytesToString(evt.bytes);
    if (evt.path === paths.html) {
      // Body apply + syncMeta stamp in ONE transaction (same origin) so peers
      // receive a single update and the newest-wins stamp rides the body edit.
      let changed = false;
      doc.transact(() => {
        changed = applyHtmlToDoc(doc, str, origin);
        if (changed) stampBodyEdit(doc, origin);
      }, origin);
      if (changed) {
        lastHtml = htmlFromDoc(doc);
        // DDR-102 — a successful disk→doc body apply is a journal checkpoint.
        opts.journal?.record(slug, { bodyHash: evt.hash });
      }
      return changed;
    }
    if (evt.path === paths.comments) {
      const parsed = tryParseJsonArray(str);
      if (parsed === null) return false;
      const changed = applyCommentsToDoc(doc, parsed, origin);
      if (changed) lastComments = str;
      return changed;
    }
    if (evt.path === paths.annotations) {
      // Apply + per-lane stamp in ONE transaction (mirrors the html branch) so
      // peers receive a single update and the annotations newest-wins stamp
      // rides the edit — this is what makes a deliberate delete-all (empty
      // wrapper written by saveAnnotations) cold-start-safe on other peers.
      let changed = false;
      doc.transact(() => {
        changed = applyAnnotationsToDoc(doc, str, origin);
        if (changed) stampAnnotationsEdit(doc, origin);
      }, origin);
      if (changed) lastAnnotations = str;
      return changed;
    }
    if (paths.meta && evt.path === paths.meta) {
      // Local meta changed (canvas-meta PATCH / design:edit) → push its SHARED
      // subset (layout/artboards, minus per-user viewport) into the doc.
      const changed = applyMetaToDoc(doc, str, origin);
      if (changed) lastMeta = metaFromDoc(doc);
      return changed;
    }
    if (paths.css && evt.path === paths.css) {
      const changed = applyCssToDoc(doc, str, origin);
      if (changed) {
        lastCss = str;
        opts.journal?.record(slug, { cssHash: evt.hash }); // DDR-102 checkpoint
      }
      return changed;
    }
    return false;
  }

  async function reconcile(): Promise<void> {
    if (stopped) return;
    // A retired doc reconciles NOTHING — materialising it is the resurrection
    // this stamp exists to end. The runtime's retirement watcher owns what
    // happens to the stale local file (quarantine to _trash/).
    if (movedToFromDoc(doc) !== null) return;
    const localHtml = readLocal(paths.html);
    const localComments = readLocal(paths.comments);
    const localAnnotations = readLocal(paths.annotations);
    const localMeta = paths.meta ? readLocal(paths.meta) : null;
    const localCss = paths.css ? readLocal(paths.css) : null;

    const docHtml = htmlFromDoc(doc);
    const docComments = commentsFromDoc(doc);
    const docCommentsStr =
      docComments.length > 0 ? `${JSON.stringify(docComments, null, 2)}\n` : '';
    const docAnnotations = annotationsFromDoc(doc) ?? '';
    const docMeta = metaFromDoc(doc);
    const docCss = cssFromDoc(doc);

    if (adopt) {
      // Push local up: doc takes its values from disk. Hub becomes our
      // canonical view of this canvas. One-shot.
      if (localHtml !== null) {
        doc.transact(() => {
          if (applyHtmlToDoc(doc, localHtml, origin)) stampBodyEdit(doc, origin);
          // F1 — adopt is also a "seed local up" (first link / fresh hub); claim
          // it + arm the repair window so two peers adopting the same draft into
          // one hub at once self-heal the same way the decision-table seed does.
          rememberSeed(doc, localHtml, localCss, origin);
        }, origin);
      }
      if (localComments !== null) {
        const parsed = tryParseJsonArray(localComments);
        if (parsed !== null) applyCommentsToDoc(doc, parsed, origin);
      }
      if (localAnnotations !== null) {
        doc.transact(() => {
          if (applyAnnotationsToDoc(doc, localAnnotations, origin)) {
            // Stamp with the FILE's mtime — adopt seeds pre-existing content,
            // which must not claim apply-time freshness over a newer peer.
            stampAnnotationsEdit(doc, origin, localMtimeMs(paths.annotations) ?? undefined);
          }
        }, origin);
      }
      if (paths.meta && localMeta !== null) applyMetaToDoc(doc, localMeta, origin);
      if (paths.css && localCss !== null) applyCssToDoc(doc, localCss, origin);
      lastHtml = localHtml ?? '';
      lastComments = localComments ?? '';
      lastAnnotations = localAnnotations ?? '';
      lastMeta = metaFromDoc(doc);
      lastCss = cssFromDoc(doc);
      adopt = false;
      // DDR-102 — adopt is a disk→doc traversal: checkpoint it so the next
      // boot fast-forwards instead of re-entering the conflict path.
      if (localHtml !== null) {
        opts.journal?.record(slug, {
          bodyHash: hashBytes(localHtml),
          ...(localCss !== null ? { cssHash: hashBytes(localCss) } : {}),
        });
      }
      return;
    }

    // ---- body: cold-start decision table (DDR-102; replaces v1.1 hub-wins) --
    const decision = decideColdStart({
      localBody: localHtml,
      docBody: docHtml,
      journalHash: opts.journal?.get(slug)?.bodyHash ?? null,
      localMtimeMs: localMtimeMs(paths.html),
      docBodyEditAtMs: bodyEditAtFromDoc(doc),
    });

    const writeBodyFromDoc = (): void => {
      const hash = hashBytes(docHtml);
      echoGuard.record(paths.html, hash);
      writer(paths.html, docHtml);
      lastHtml = docHtml;
      opts.journal?.record(slug, { bodyHash: hash });
    };
    const seedBodyUp = (body: string): void => {
      doc.transact(() => {
        if (applyHtmlToDoc(doc, body, origin)) stampBodyEdit(doc, origin);
        // F1 — claim the seed (clientID marker) in the SAME update so a
        // concurrent second seeder's merge resolves a single elected writer.
        rememberSeed(doc, body, localCss, origin);
      }, origin);
      lastHtml = body;
      // Arm the de-dup repair window: if another peer seeded the same content at
      // the same instant, the merged Y.Text will double — maybeRepairSeedDuplication
      // (on the elected owner) collapses it back during this window. `localCss`
      // is remembered too, since it collides identically (issue #114).
      opts.journal?.record(slug, { bodyHash: hashBytes(body) });
    };

    // ONE application body, shared with migrate-seed.ts (DDR-226 Increment 0):
    // exhaustive over every action with a compile-time `never` default, so the
    // fail-closed snapshot guard, the conflict report and the row set can never
    // drift between the two architectures again. Only the three EFFECTS differ
    // and they are injected here.
    const applied = await applyColdStart({
      slug,
      decision,
      localBody: localHtml,
      docBody: docHtml,
      takeHub: writeBodyFromDoc,
      takeLocal: seedBodyUp,
      checkpointIdentity: (body) => opts.journal?.record(slug, { bodyHash: hashBytes(body) }),
      ...(opts.snapshot ? { snapshot: opts.snapshot } : {}),
      ...(opts.onConflict ? { onConflict: opts.onConflict } : {}),
    });
    // `noop` leaves disk and doc alone; the local mirror still tracks the doc.
    if (applied.action === 'noop') lastHtml = docHtml;

    // Which side owns the visually-coupled lanes (annotations fallback / css).
    const bodyWinner = applied.bodyWinner;

    // ---- comments: id-union merge (DDR-102 — union loses nothing) ----------
    const localParsedComments = localComments !== null ? tryParseJsonArray(localComments) : null;
    if (localParsedComments !== null && localParsedComments.length > 0) {
      const merged = unionCommentsById(docComments, localParsedComments);
      const mergedStr = merged.length > 0 ? `${JSON.stringify(merged, null, 2)}\n` : '';
      applyCommentsToDoc(doc, merged, origin); // no-ops when equal
      if (mergedStr !== '' && mergedStr !== localComments) {
        const hash = hashBytes(mergedStr);
        echoGuard.record(paths.comments, hash);
        writer(paths.comments, mergedStr);
      }
      lastComments = mergedStr;
    } else {
      // No (parseable) local comments — hub state materializes as before.
      lastComments = docCommentsStr;
      if (docCommentsStr !== '' && localComments !== docCommentsStr) {
        const hash = hashBytes(docCommentsStr);
        echoGuard.record(paths.comments, hash);
        writer(paths.comments, docCommentsStr);
      }
    }

    // ---- annotations: PER-LANE newest-wins (the 2026-08-14 eraser fix) -----
    // Annotations used to blindly follow the body winner, but annotation edits
    // don't move the body's edit time — so a hub with a newer body and a stale
    // EMPTY-WRAPPER annotations lane (72 bytes, not '') erased newer local
    // strokes on every cold start, taking the `assets/<sha8>` references the
    // asset pull scans with them. decideAnnotationsColdStart owns the table;
    // the rule that matters: unstamped emptiness never beats content.
    {
      const annDecision = decideAnnotationsColdStart({
        local: localAnnotations,
        doc: docAnnotations,
        isEmpty: isEmptyAnnotationsSvg,
        localMtimeMs: localMtimeMs(paths.annotations),
        docEditAtMs: annotationsEditAtFromDoc(doc),
        bodyWinner,
      });
      if (annDecision.winner === 'local' && localAnnotations !== null) {
        console.warn(`[sync/${slug}] cold-start annotations: ${annDecision.reason}`);
        doc.transact(() => {
          if (applyAnnotationsToDoc(doc, localAnnotations, origin)) {
            stampAnnotationsEdit(doc, origin, localMtimeMs(paths.annotations) ?? undefined);
          }
        }, origin);
        lastAnnotations = localAnnotations;
      } else if (annDecision.winner === 'hub' && localAnnotations !== docAnnotations) {
        // Warn only when this overwrites real local content — the clean
        // first-sync materialize (local empty/absent) is the common quiet path.
        if (!isEmptyAnnotationsSvg(localAnnotations)) {
          console.warn(`[sync/${slug}] cold-start annotations: ${annDecision.reason}`);
        }
        const hash = hashBytes(docAnnotations);
        echoGuard.record(paths.annotations, hash);
        writer(paths.annotations, docAnnotations);
        lastAnnotations = docAnnotations;
      } else {
        lastAnnotations = docAnnotations;
      }
    }

    // ---- css: PER-LANE resolution (issue #114 — was "follow the body winner")
    // The css lane used to be the only Plane-A lane with no table and no
    // duplication guard, which is why it was the only one that NEVER came out
    // of a multi-peer cold start clean. decideCssColdStart owns the rows now;
    // the two that matter are the exact-repeat collapse and the DDR-064
    // empty-lane guard, and it finally consumes the `cssHash` checkpoint the
    // journal has been writing since DDR-102.
    {
      const cssDecision = decideCssColdStart({
        local: localCss,
        doc: docCss,
        journalHash: opts.journal?.get(slug)?.cssHash ?? null,
        hash: hashBytes,
        bodyWinner,
      });
      if (cssDecision.recoveredDuplication) {
        // WARN, BUT DO NOT SNAPSHOT — symmetric with the body's
        // `recover-seed-dup`, which deliberately doesn't either.
        //
        // A snapshot stood here briefly, on the reasoning that `X + X` is valid
        // CSS (unlike a doubled body, which can't build) so the collapse might
        // discard a real edit. The reasoning was wrong about the bytes:
        // `isExactRepeat` is true only when the doc is EXACTLY local repeated
        // N times, so the copies thrown away contain nothing the retained copy
        // doesn't. The snapshot preserved zero unique bytes — and cost a slot
        // in a per-slug ring buffer that `pruneSnapshots` evicts oldest-first
        // at MAX_SNAPSHOTS_PER_SLUG. A hostile hub that keeps re-doubling this
        // lane could therefore drive one worthless snapshot per reconcile and
        // push the user's genuine `pre-sync-local` and conflict copies off the
        // end — turning DDR-102's recovery spine into the attack surface.
        // Adversarial review found it; the safety net was the vulnerability.
        console.warn(`[sync/${slug}] cold-start css: ${cssDecision.reason}`);
      }
      if (cssDecision.winner === 'local' && paths.css && localCss !== null) {
        applyCssToDoc(doc, localCss, origin);
        lastCss = localCss;
        opts.journal?.record(slug, { cssHash: hashBytes(localCss) });
      } else if (cssDecision.winner === 'hub') {
        lastCss = docCss;
        if (paths.css && docCss !== null && localCss !== docCss) {
          const hash = hashBytes(docCss);
          echoGuard.record(paths.css, hash);
          writer(paths.css, docCss);
          opts.journal?.record(slug, { cssHash: hash });
        }
      } else {
        lastCss = docCss;
      }
    }

    // ---- meta: hub wins where it has an opinion, local seeds where it does not
    //
    // Repair first. Two peers publishing the same meta into an empty lane leave
    // two identical copies in the Y.Text, which every consumer's `JSON.parse`
    // rejects — so the canvas reads as having no meta at all on any machine
    // that syncs it afterwards. Collapsing it here, on a doc that has synced,
    // is the only place the duplication is provable rather than suspected.
    repairSharedMeta(doc, origin);
    lastMeta = docMeta;
    if (paths.meta && docMeta !== null) {
      const merged = mergeSharedMetaIntoLocal(localMeta, docMeta);
      if (merged !== null && merged !== localMeta) {
        const hash = hashBytes(merged);
        echoGuard.record(paths.meta, hash);
        writer(paths.meta, merged);
      }
    } else if (paths.meta && localMeta !== null) {
      // AN EMPTY DOC IS NOT A CANVAS WITH NO TITLE.
      //
      // This branch used to not exist, and the comment above it said meta was
      // "unchanged in all cases". The consequence: a canvas created on a peer
      // reached the hub as a body with NO meta — no title, no kind, no
      // design-system binding — and stayed that way until somebody happened to
      // move an artboard, because a meta EDIT was the only thing that ever
      // pushed meta up.
      //
      // It looked fine from the cloud, which is what kept it hidden: a cell's
      // studio child arms `activity:suppress` on create, the container write
      // bridge turns that into an `fs:any` a quarter-second later, and by then
      // the new canvas has an agent to receive it. A desktop has no bridge — its
      // real `fs.watch` fires immediately, before the agent for a
      // just-created canvas exists, and the event lands nowhere. So the race
      // was won on one side and lost on the other, and the underlying gap
      // (cold-start meta was doc→file only) was invisible from the winning end.
      //
      // Seeding here is safe by construction: it runs ONLY when the doc carries
      // no shared meta at all, so it cannot overwrite another peer's opinion —
      // the same "absence is never authority" rule the rest of the sync applies
      // to files, applied to the one sidecar that was exempt from it.
      if (applyMetaToDoc(doc, localMeta, origin)) lastMeta = metaFromDoc(doc);
    }
  }

  return {
    slug,
    origin,
    start() {
      if (started) return;
      doc.on('update', onDocUpdate);
      started = true;
    },
    reconcile,
    applyFromFs,
    flush,
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

function localMtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

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

// Reviver strips dangerous keys at parse time so a malicious hub-pushed
// payload (or a planted commit) can't seed `__proto__` / `constructor` /
// `prototype` own-properties into the comment objects yjs subsequently
// serializes to other peers. Modern V8/Bun block direct Object.prototype
// pollution at parse, but the reviver also closes the cross-machine
// propagation surface where an unsafe `for…in` on a peer would re-pollute.
// DDR-054 §2g (defender M2).
function tryParseJsonArray(s: string): unknown[] | null {
  try {
    const parsed = JSON.parse(s, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') {
        return undefined;
      }
      return value;
    });
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Re-export for the wiring layer to know which shared type holds HTML.
export { Y_SYNC_TYPES };
