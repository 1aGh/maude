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
  mergeSharedMetaIntoLocal,
  metaFromDoc,
  movedToFromDoc,
  stampAnnotationsEdit,
  stampBodyEdit,
} from './codec.ts';
import { type EchoGuard, hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import { MAX_CSS_BYTES, MAX_HTML_BYTES, MAX_META_BYTES, withinByteCap } from './limits.ts';
import { ORIGINS } from './origins.ts';
import { repairSeedDuplication } from './seed-repair.ts';
import { saveRecoveryBody } from './source-recovery.ts';
import { sourceError } from './source-validation.ts';

export const PROJECT_FLUSH_MS = 800;
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
    repairSeedDuplication(doc, ORIGINS.DISK_PROJECTION);
    scheduleFlush();
  }

  function scheduleFlush(): void {
    dirty = true;
    if (flushMs === 0) {
      queueMicrotask(() => void flush());
      return;
    }
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void flush();
    }, flushMs);
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
    return true;
  }

  function writeCssIfChanged(): void {
    if (!paths.css) return;
    const next = cssFromDoc(doc);
    if (next === lastCss) return;
    lastCss = next;
    if (next === null) return; // doc carries no css yet — nothing to write
    if (!withinCap(paths.css, next, MAX_CSS_BYTES)) return;
    recordEcho(paths.css, next);
    writeAndAnnounce(paths.css, next);
    opts.journal?.record(slug, { cssHash: hashBytes(next) }); // DDR-102 checkpoint
  }

  function writeMetaIfChanged(): void {
    if (!paths.meta) return;
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

    if (evt.path === paths.html) {
      if (!withinCap(paths.html, str, MAX_HTML_BYTES)) return false;
      if (validation(str) !== null) {
        strike(evt.path, evt.hash);
        reject('invalid-source', str, htmlFromDoc(doc));
        return false;
      }
      clearStrike(evt.path);
      // Keep both sides when a watcher arrives after a remote update. A user's
      // explicit file edit may repair corrupt state, but must remain recoverable.
      if (lastHtml !== null && htmlFromDoc(doc) !== lastHtml && htmlFromDoc(doc) !== str) {
        reject('local-edit', str, htmlFromDoc(doc));
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
          changed = applyHtmlToDoc(doc, str, importOrigin);
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
