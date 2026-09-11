// One-time authoritative seed for the shared-doc cutover — Phase 9.2 (DDR-064
// Task 9), cold-start resolution upgraded by DDR-102.
//
// The trap (dmonad-confirmed, discuss.yjs.dev/t/.../2538): if a shared doc is
// populated from TWO independent sources — the local file-seed (room.seed
// pushing `_comments/<slug>.json` as fresh Y.Array items) AND the hub provider
// (syncing the hub's canonical items) — the two item-sets have different client
// IDs, so the CRDT merge CONCATENATES them: comment "c1" appears twice. You
// cannot fix this with `applyUpdate` of two docs; you must pick ONE authoritative
// source and build the doc from it.
//
// This module is that decision, run ONCE per canvas at cutover, AFTER the
// provider's first sync (so the doc already holds hub state if the hub had any):
//
//   - hub EMPTY (doc empty)            → ADOPT. Clear+rebuild the doc from the
//     local files inside `transact(fn, MIGRATION)`.
//   - hub HAD state, body resolution   → the DDR-102 decision table
//     (cold-start.ts): identical → keep; journal-matched local → fast-forward
//     (hub keeps); empty local → materialize; divergence → dual snapshot +
//     NEWEST-WINS — winner `local` rebuilds the body from disk inside ONE
//     MIGRATION transaction (one source per type, never a CRDT merge of two
//     histories); winner `hub` keeps the doc.
//   - comments under a non-empty doc   → id-union (plain array rebuild from
//     merged JSON via the delete-then-insert codec — NOT a CRDT merge, so the
//     duplication trap stays closed; same-id entries keep the doc's version).
//
// Idempotent: re-running with hub state present and no divergence is a no-op;
// re-running an adopt rebuilds from the same files → byte-identical.
// The companion guard is the room's seed being disabled for pinned
// (provider-attached) slugs under sharedDoc (see collab/index.ts `shouldSeed`).

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

import type * as Y from 'yjs';

import { Y_TYPES } from '../collab/persistence.ts';
import { atomicWrite } from './atomic-write.ts';
import {
  annotationsEditAtFromDoc,
  applyAnnotationsToDoc,
  applyCommentsToDoc,
  applyCssToDoc,
  applyHtmlToDoc,
  applyMetaToDoc,
  bodyEditAtFromDoc,
  isEmptyAnnotationsSvg,
  stampAnnotationsEdit,
  stampBodyEdit,
  Y_SYNC_TYPES,
} from './codec.ts';
import type { ColdStartAction } from './cold-start.ts';
import {
  decideAnnotationsColdStart,
  decideColdStart,
  decideCssColdStart,
  isExactRepeat,
  unionCommentsById,
} from './cold-start.ts';
import { applyColdStart, type ColdStartSnapshotReason } from './cold-start-apply.ts';
import { hashBytes } from './echo-guard.ts';
import type { SyncJournal } from './journal.ts';
import { ORIGINS } from './origins.ts';
import { rememberSeed } from './seed-repair.ts';
import { lastValidSource, saveRecoveryBody } from './source-recovery.ts';
import { sourceError } from './source-validation.ts';

export interface MigrateSeedPaths {
  html: string;
  comments: string;
  annotations: string;
  meta?: string;
  css?: string;
}

export interface MigrateSeedOptions {
  slug: string;
  doc: Y.Doc;
  paths: MigrateSeedPaths;
  /** `_history/<slug>/` (or any dir) — when set, local files are snapshotted
   *  here (the legacy `pre-shared-doc-migration/` whole-set copy) before any
   *  doc-keeps-state path can overwrite them via the projection. Best-effort. */
  historyDir?: string;
  /** DDR-102 — per-machine journal; gates fast-forward vs conflict. */
  journal?: SyncJournal;
  /** DDR-102 — body snapshot writer (history.ts), same contract as the agent's. */
  snapshot?: (content: string, reason: ColdStartSnapshotReason) => Promise<string | null>;
  /**
   * Does the HUB hold state for this slug, per its last document listing?
   *
   * `docIsEmpty` asks the local replica, and an empty replica has two
   * completely different meanings: "the hub has never seen this canvas" (adopt
   * — the local file is the only copy) and "the hub's state has not landed in
   * this replica YET" (do nothing — it is on its way). Adopting in the second
   * case is the DDR-102 F1 concurrent cold-seed collision: both peers
   * clear-and-rebuild their own replica from a file with the same bytes, and
   * because the two runs carry different client ids the CRDT merge
   * CONCATENATES them — the canvas ends up with its body twice on every peer.
   *
   * The listing is the only enumeration a peer has, so it is also the only way
   * to tell the two cases apart before writing. Absent ⇒ treated as "the hub
   * does not have it", which is the pre-existing behaviour.
   */
  hubHasState?: (slug: string) => boolean;
  /** DDR-102 — divergence notification, same contract as the agent's. */
  onConflict?: (info: {
    slug: string;
    kind: 'cold-start-diverged';
    winner?: 'local' | 'hub';
    snapshots?: { local?: string; hub?: string };
    /** DDR-102 fail-closed (F1) — local snapshot didn't land; hub-wins refused. */
    snapshotFailed?: boolean;
  }) => void;
}

export type MigrateSeedResult =
  | 'hub-wins'
  | 'local-adopt'
  | 'empty'
  /** DDR-102 — doc held state but no body; local body seeded up in-place. */
  | 'body-seed-up'
  /** DDR-102 F1 — the hub body was our local body repeated N≥2 times (a
   *  concurrent cold-seed collision); local was re-applied so the codec's diff
   *  deletes the duplicate. Before Increment 0 this decision had NO case in
   *  this module's switch and fell through to `hub-wins`, keeping (and
   *  materializing) the doubled body. */
  | 'recover-seed-dup'
  /** DDR-102 — divergence resolved newest-wins. */
  | 'conflict-local-wins'
  | 'conflict-hub-wins'
  /** The replica is empty but the HUB is not — its state is still in flight.
   *  Seeding here is the F1 collision (see `hubHasState`), so this seed does
   *  nothing and lets the document arrive. */
  | 'defer-hub-state';

/** True when the shared doc holds no synced content for any of the five types. */
export function docIsEmpty(doc: Y.Doc): boolean {
  if (doc.getText(Y_SYNC_TYPES.html).length > 0) return false;
  if (doc.getText(Y_SYNC_TYPES.css).length > 0) return false;
  if (doc.getText(Y_SYNC_TYPES.meta).length > 0) return false;
  if (doc.getArray(Y_TYPES.comments).length > 0) return false;
  const svg = doc.getMap<unknown>(Y_TYPES.annotations).get('svg');
  if (typeof svg === 'string' && svg.length > 0) return false;
  return true;
}

/**
 * Run the one-time authoritative seed. Returns which source won so the caller
 * can log / surface a conflict. Safe to call on every boot (idempotent).
 */
export async function migrateSeed(opts: MigrateSeedOptions): Promise<MigrateSeedResult> {
  const { slug, doc, paths } = opts;

  const diskHtml = readLocal(paths.html);
  const localHtml =
    diskHtml !== null && sourceError(paths.html, diskHtml) === null ? diskHtml : null;
  const localComments = readLocal(paths.comments);
  const localAnnotations = readLocal(paths.annotations);
  const localMeta = paths.meta ? readLocal(paths.meta) : null;
  const localCss = paths.css ? readLocal(paths.css) : null;

  // Hub was empty → adopt local. Build the doc from the local files ONCE, inside
  // a single MIGRATION transaction. The apply* codecs delete-then-insert, so
  // this is a clear+rebuild (re-running is a no-op once content matches).
  if (docIsEmpty(doc)) {
    // AN EMPTY REPLICA IS NOT AN EMPTY HUB. See `hubHasState` — on a cell the
    // hub's workspace agent writes every document onto the checkout, so the
    // studio child scans up a file whose document the hub already owns. Seeding
    // from it doubles the body on every peer.
    if (opts.hubHasState?.(slug)) {
      // SNAPSHOT BEFORE STANDING ASIDE. Deferring means the local body never
      // enters the doc — so when the hub's state does arrive, the projection
      // writes it over this file with no `pre-sync-local` copy behind it and no
      // conflict recorded, because both live in the non-empty branch this
      // return skips. The adopt path it replaced could not lose the local body:
      // it was inside the merge. One snapshot buys back the recoverability.
      if (localHtml && opts.snapshot) {
        try {
          await opts.snapshot(localHtml, 'pre-sync-local');
        } catch {
          /* best-effort — history is a safety net, never a gate on syncing */
        }
      }
      return 'defer-hub-state';
    }
    const hasLocal =
      !!localHtml || !!localComments || !!localAnnotations || !!localMeta || !!localCss;
    if (!hasLocal) return 'empty';

    doc.transact(() => {
      if (localHtml) {
        rememberSeed(doc, localHtml, localCss, ORIGINS.MIGRATION);
        if (applyHtmlToDoc(doc, localHtml, ORIGINS.MIGRATION)) {
          stampBodyEdit(doc, ORIGINS.MIGRATION);
        }
      }
      if (localComments) {
        const parsed = tryParseJsonArray(localComments);
        if (parsed) applyCommentsToDoc(doc, parsed, ORIGINS.MIGRATION);
      }
      if (localAnnotations) {
        if (applyAnnotationsToDoc(doc, localAnnotations, ORIGINS.MIGRATION)) {
          // Stamp with the FILE's mtime — adopt seeds pre-existing content,
          // which must not claim apply-time freshness over a newer peer.
          stampAnnotationsEdit(
            doc,
            ORIGINS.MIGRATION,
            localMtimeMs(paths.annotations) ?? undefined
          );
        }
      }
      if (paths.meta && localMeta) applyMetaToDoc(doc, localMeta, ORIGINS.MIGRATION);
      if (paths.css && localCss) applyCssToDoc(doc, localCss, ORIGINS.MIGRATION);
    }, ORIGINS.MIGRATION);

    // DDR-102 — the adopt is a disk→doc traversal: checkpoint it.
    if (localHtml) {
      opts.journal?.record(slug, {
        bodyHash: hashBytes(localHtml),
        ...(localCss ? { cssHash: hashBytes(localCss) } : {}),
      });
    }
    return 'local-adopt';
  }

  // Hub had state. Legacy whole-set safety copy (fixed dir, overwritten per
  // boot — not spam) so non-body files keep their pre-cutover backup too.
  snapshotLocal(opts);

  // Invalid hub source must reach the projector's quarantine unchanged. Never
  // checkpoint it, elect it by timestamp, or merge a healthy local file into it
  // merely because the connection restarted. A deliberate file edit can repair it.
  if (
    sourceError(paths.html, doc.getText(Y_SYNC_TYPES.html).toString()) !== null &&
    !(localHtml && isExactRepeat(doc.getText(Y_SYNC_TYPES.html).toString(), localHtml))
  ) {
    return 'hub-wins';
  }

  // Body resolution via the DDR-102 decision table.
  const docHtml = doc.getText(Y_SYNC_TYPES.html).toString();
  const decision = decideColdStart({
    localBody: localHtml,
    docBody: docHtml,
    journalHash: opts.journal?.get(slug)?.bodyHash ?? null,
    localMtimeMs: localMtimeMs(paths.html),
    docBodyEditAtMs: bodyEditAtFromDoc(doc),
  });

  /** Rebuild body (+ visually-coupled css) from local, in ONE MIGRATION
   *  transaction — one source per type, never a two-history merge.
   *  Annotations are deliberately NOT here any more: they resolve per-lane
   *  below (decideAnnotationsColdStart), independent of the body winner. */
  const rebuildBodyFromLocal = (): void => {
    doc.transact(() => {
      if (docHtml === '' && localHtml) rememberSeed(doc, localHtml, localCss, ORIGINS.MIGRATION);
      if (applyHtmlToDoc(doc, localHtml as string, ORIGINS.MIGRATION)) {
        stampBodyEdit(doc, ORIGINS.MIGRATION);
      }
      if (paths.css && localCss !== null) applyCssToDoc(doc, localCss, ORIGINS.MIGRATION);
    }, ORIGINS.MIGRATION);
    opts.journal?.record(slug, {
      bodyHash: hashBytes(localHtml as string),
      ...(localCss !== null ? { cssHash: hashBytes(localCss) } : {}),
    });
  };

  // ONE application body, shared with agent.ts reconcile (DDR-226 Increment 0).
  // `takeHub` is a genuine no-op here: under shared-doc the doc KEEPS its state
  // and `projection.reconcile()` materializes it to disk (recording the journal
  // checkpoint on its own write). Everything else — the dual snapshot, the
  // fail-closed refusal, the conflict report, and crucially the
  // `recover-seed-dup` row this switch used to be missing — now lives in
  // exactly one place.
  const applied = await applyColdStart({
    slug,
    decision,
    localBody: localHtml,
    docBody: docHtml,
    takeHub: () => {
      /* the projection materializes the doc; nothing to do here */
    },
    takeLocal: rebuildBodyFromLocal,
    checkpointIdentity: (body) => opts.journal?.record(slug, { bodyHash: hashBytes(body) }),
    logLabel: 'shared-doc',
    ...(opts.snapshot ? { snapshot: opts.snapshot } : {}),
    ...(opts.onConflict ? { onConflict: opts.onConflict } : {}),
  });

  const result: MigrateSeedResult = resultFor(applied.action, applied.bodyWinner);

  // ---- annotations: PER-LANE newest-wins (the 2026-08-14 eraser fix; the
  // same table as agent.ts reconcile). Under sharedDoc the collab room's
  // persistJson materializes the doc's annotations to disk, so a stale hub
  // EMPTY WRAPPER (non-'' but zero strokes) in the doc erased local strokes
  // right after this seed ran. Resolve the lane here, before the room
  // materializes: unstamped emptiness never beats content.
  {
    const docSvg = doc.getMap<unknown>(Y_TYPES.annotations).get('svg');
    const docAnnotations = typeof docSvg === 'string' ? docSvg : '';
    const annDecision = decideAnnotationsColdStart({
      local: localAnnotations,
      doc: docAnnotations,
      isEmpty: isEmptyAnnotationsSvg,
      localMtimeMs: localMtimeMs(paths.annotations),
      docEditAtMs: annotationsEditAtFromDoc(doc),
      bodyWinner: applied.bodyWinner,
    });
    if (annDecision.winner === 'local' && localAnnotations !== null) {
      console.warn(`[sync/${slug}] shared-doc cold-start annotations: ${annDecision.reason}`);
      doc.transact(() => {
        if (applyAnnotationsToDoc(doc, localAnnotations, ORIGINS.MIGRATION)) {
          stampAnnotationsEdit(
            doc,
            ORIGINS.MIGRATION,
            localMtimeMs(paths.annotations) ?? undefined
          );
        }
      }, ORIGINS.MIGRATION);
    }
    // winner 'hub' → nothing to write here: the collab room owns the
    // annotations doc→file half and materializes it (persistJson).
  }

  // ---- css: PER-LANE resolution (issue #114), the same table agent.ts uses.
  // `rebuildBodyFromLocal` above already re-seeds css when the BODY winner was
  // local; this block is what covers every other row — above all the exact-repeat
  // collapse, which is how a `CSS × N` lane from a concurrent cold seed gets
  // back to one copy on a hub-wins boot. It no-ops when the two sides already
  // agree, so running after the body applier costs nothing.
  if (paths.css) {
    const docCssNow = doc.getText(Y_SYNC_TYPES.css).toString();
    const cssDecision = decideCssColdStart({
      local: localCss,
      doc: docCssNow.length > 0 ? docCssNow : null,
      journalHash: opts.journal?.get(slug)?.cssHash ?? null,
      hash: hashBytes,
      bodyWinner: applied.bodyWinner,
    });
    if (cssDecision.recoveredDuplication) {
      // Warn, don't snapshot — see the note on the same branch in agent.ts
      // reconcile. An exact integer repeat carries no unique bytes to recover,
      // and snapshotting it hands a hostile hub an eviction lever against the
      // `_history/` copies that DO.
      console.warn(`[sync/${slug}] shared-doc cold-start css: ${cssDecision.reason}`);
    }
    if (cssDecision.winner === 'local' && localCss !== null) {
      doc.transact(() => {
        applyCssToDoc(doc, localCss, ORIGINS.MIGRATION);
      }, ORIGINS.MIGRATION);
      opts.journal?.record(slug, { cssHash: hashBytes(localCss) });
    }
    // winner 'hub' → nothing to write here: the projection materializes the
    // doc's css to disk, exactly as it does for the body.
  }

  // Comments id-union (DDR-102): rebuild from merged JSON via the
  // delete-then-insert codec — same-id entries keep the doc's version, so the
  // duplication trap stays closed; local-only comments survive.
  if (localComments) {
    const parsed = tryParseJsonArray(localComments);
    if (parsed && parsed.length > 0) {
      const docList = doc.getArray(Y_TYPES.comments).toArray();
      const merged = unionCommentsById(docList, parsed);
      if (merged.length !== docList.length) {
        doc.transact(() => {
          applyCommentsToDoc(doc, merged, ORIGINS.MIGRATION);
        }, ORIGINS.MIGRATION);
      }
    }
  }

  return result;
}

/* ---------------------------------------------------------------- helpers */

/**
 * Map the shared applier's verdict onto this module's public result string.
 * Total over `ColdStartAction`, so a new row in the table surfaces here as a
 * type error instead of silently reading as `hub-wins` (the exact shape of the
 * `recover-seed-dup` bug this refactor fixed).
 */
function resultFor(action: ColdStartAction, bodyWinner: 'local' | 'hub'): MigrateSeedResult {
  switch (action) {
    case 'noop':
    case 'materialize-hub':
    case 'fast-forward-hub':
      return 'hub-wins';
    case 'seed-local-up':
      return 'body-seed-up';
    case 'recover-seed-dup':
      return 'recover-seed-dup';
    case 'conflict':
      return bodyWinner === 'local' ? 'conflict-local-wins' : 'conflict-hub-wins';
    default: {
      const never: never = action;
      throw new Error(`migrate-seed: unhandled cold-start action ${String(never)}`);
    }
  }
}

function snapshotLocal(opts: MigrateSeedOptions): void {
  if (!opts.historyDir) return;
  try {
    const dir = path.join(opts.historyDir, 'pre-shared-doc-migration');
    mkdirSync(dir, { recursive: true });
    for (const p of [
      opts.paths.html,
      opts.paths.comments,
      opts.paths.annotations,
      opts.paths.meta,
      opts.paths.css,
    ]) {
      if (p && existsSync(p)) {
        const target = path.join(dir, path.basename(p));
        if (p === opts.paths.html) {
          const current = readLocal(p);
          const valid =
            current?.trim() && sourceError(p, current) === null
              ? current
              : lastValidSource(opts.historyDir, p);
          if (valid) {
            saveRecoveryBody(opts.historyDir, p, 'last-valid', valid);
            const prior = readLocal(target);
            if (!prior || sourceError(p, prior) !== null) atomicWrite(target, valid);
          }
        } else copyFileSync(p, target);
      }
    }
  } catch {
    /* best-effort — a snapshot failure must not block the cutover */
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

function localMtimeMs(p: string): number | null {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
}

// Proto-pollution-safe (DDR-054 §2g), mirroring the agent + projection comments
// parse — a planted local `_comments/<slug>.json` must not seed dangerous keys
// during adopt.
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
