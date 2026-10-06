// Per-machine comment ledger — issue #133.
//
// Records, per canvas slug, the comment identities (`commentKey`) that were on
// this machine's `_comments/<slug>.json` AND in the shared document at the last
// point the two agreed. It answers the one question neither side can answer
// alone after a restart: an id that is on disk but not in the document — is it
// a comment still on its way TO the document (keep it), or one the document
// DROPPED while this machine was away (a remote delete — let it go)?
//
//   - in the ledger → it was synced before, the document no longer has it: a
//     delete. The projection may write the file without it, and a cold-start
//     union must not put it back.
//   - not in the ledger → never synced from here: still in flight (a mutation
//     whose import has not landed, an external edit — how /design:edit resolves
//     comments). Keep it; defer, exactly as before.
//
// Before this, the "ever carried" knowledge lived only in memory
// (collab/persistence.ts), so it started empty on every launch. A desktop that
// was closed while a comment was deleted on the web then read that id as "in
// flight" forever and never wrote its comments file again (accepted mode: the
// file froze), and the legacy cold-start union re-added it for everyone.
//
// Per hub, like the sync journal (DDR-102): the file carries the hub URL it was
// recorded against, and relinking to a different hub wipes it — "synced
// before" against one hub says nothing about another. Best-effort and never
// throws: a missing or corrupt ledger reads as empty, which degrades to the old
// behaviour (defer), the safe direction. Lives under `_state/`, which is
// already per-machine runtime state (DDR-115 taxonomy), so no new path.

import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { atomicWrite } from './atomic-write.ts';
import { commentKey } from './comment-identity.ts';

const LEDGER_FILE = 'comment-ledger.json';
/**
 * Written immediately, not debounced: a record follows a comments-file write
 * (rare), and a peer quit right after syncing must not lose it — a debounced
 * ledger lost exactly that record in the E2E relaunch run and left the file
 * frozen. Order is file first, ledger second, so a crash between the two
 * leaves ids the ledger does not know: deferred, the safe direction.
 */
const FLUSH_MS = 0;
/** Same ceiling as collab/persistence.ts MAX_SEEN_COMMENT_IDS (DDR-054 §2d). */
const MAX_IDS_PER_SLUG = 10_000;

interface LedgerFileShape {
  hubUrl: string | null;
  updatedAt: number;
  slugs: Record<string, string[]>;
}

/** A read-only view of the identities recorded for one canvas. */
export interface SyncedSet {
  readonly size: number;
  /** Takes a raw `commentKey`; the ledger stores only its hash. */
  has(key: string): boolean;
}

/**
 * The stored form of a comment key. Hashed (security review F3): an id-less
 * comment's key is its whole JSON body, which a peer controls — the ledger must
 * not grow with comment bodies, only with how many there are.
 */
export function ledgerKey(key: string): string {
  return createHash('sha256').update(key).digest('base64url').slice(0, 22);
}

export interface CommentLedger {
  /** Identities last known synced for `slug` (empty when never recorded). */
  get(slug: string): SyncedSet;
  /** Has `slug` ever been recorded (under the current hub)? Distinguishes
   *  "synced, and had no comments" from "no knowledge" (first launch after
   *  upgrading, a fresh link) — only the first may act on a difference. */
  known(slug: string): boolean;
  /** Replace `slug`'s record with the identities of a list both sides now agree on. */
  record(slug: string, keys: Iterable<string>): void;
  /**
   * Linked to a (different) hub → drop every record. The identity must name
   * the document namespace, not just the URL: one hub serves several
   * workspaces (and branches), and "synced before" in one says nothing about
   * another (security review F1c). `null` = no hub.
   */
  invalidateIfHubChanged(identity: string | null): void;
  /** Persist now. Best-effort. */
  flush(): void;
}

export function commentLedgerPath(designRoot: string): string {
  return path.join(designRoot, '_state', LEDGER_FILE);
}

export interface LoadCommentLedgerOptions {
  /** Tests use 0 to persist synchronously. */
  flushMs?: number;
  writer?: (file: string, bytes: string) => void;
}

export function loadCommentLedger(
  designRoot: string,
  opts: LoadCommentLedgerOptions = {}
): CommentLedger {
  const file = commentLedgerPath(designRoot);
  const flushMs = opts.flushMs ?? FLUSH_MS;
  const writer = opts.writer ?? ((p: string, bytes: string) => void atomicWrite(p, bytes));

  let hubUrl: string | null = null;
  const slugs = new Map<string, Set<string>>();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let dirty = false;

  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8')) as Partial<LedgerFileShape>;
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        hubUrl = typeof parsed.hubUrl === 'string' ? parsed.hubUrl : null;
        const raw = parsed.slugs;
        if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
          for (const [slug, ids] of Object.entries(raw)) {
            if (!Array.isArray(ids)) continue;
            const keys = ids.filter((k): k is string => typeof k === 'string');
            slugs.set(slug, new Set(keys.slice(-MAX_IDS_PER_SLUG)));
          }
        }
      }
    }
  } catch {
    /* corrupt → empty; every id then reads as "in flight", the old behaviour */
  }

  function persist(): void {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (!dirty) return;
    dirty = false;
    const payload: LedgerFileShape = {
      hubUrl,
      updatedAt: Date.now(),
      slugs: Object.fromEntries([...slugs].map(([s, ids]) => [s, [...ids]])),
    };
    try {
      writer(file, `${JSON.stringify(payload)}\n`);
    } catch (err) {
      console.warn(
        '[sync/comment-ledger] persist failed:',
        err instanceof Error ? err.message : err
      );
    }
  }

  function schedule(): void {
    dirty = true;
    if (flushMs === 0) {
      persist();
      return;
    }
    if (!timer) timer = setTimeout(persist, flushMs);
  }

  return {
    get(slug) {
      const set = slugs.get(slug);
      return {
        size: set?.size ?? 0,
        has: (key: string) => !!set && set.has(ledgerKey(key)),
      };
    },
    known(slug) {
      return slugs.has(slug);
    },
    record(slug, keys) {
      const next = new Set<string>();
      for (const k of keys) {
        next.add(ledgerKey(k));
        if (next.size >= MAX_IDS_PER_SLUG) break;
      }
      const prev = slugs.get(slug);
      if (prev && prev.size === next.size && [...next].every((k) => prev.has(k))) return;
      slugs.set(slug, next);
      schedule();
    },
    invalidateIfHubChanged(url) {
      if (url === hubUrl) return;
      hubUrl = url;
      slugs.clear();
      schedule();
    },
    flush: persist,
  };
}

/**
 * The local half of a cold-start comments union, minus the comments a peer
 * deleted while this machine was away: those the ledger knows were synced from
 * here and the document no longer holds. Everything else — comments never
 * synced from here — still unions up, exactly as before. Shared by both
 * cold-start paths (sync/agent.ts reconcile, sync/migrate-seed.ts), which must
 * agree or one would resurrect what the other let go.
 */
export function withoutRemotelyDeleted(
  local: unknown[],
  docList: unknown[],
  syncedBefore: Pick<SyncedSet, 'size' | 'has'> | undefined
): unknown[] {
  if (!syncedBefore || syncedBefore.size === 0) return local;
  const inDoc = new Set(docList.map(commentKey));
  return local.filter((c) => {
    const k = commentKey(c);
    return inDoc.has(k) || !syncedBefore.has(k);
  });
}

// One ledger per design root per process: the room projection (collab/) and the
// sync agent (sync/) must share it, or two writers would overwrite each other's
// file and each would only know half of what was synced.
const shared = new Map<string, CommentLedger>();

export function commentLedgerFor(designRoot: string): CommentLedger {
  let l = shared.get(designRoot);
  if (!l) {
    l = loadCommentLedger(designRoot);
    shared.set(designRoot, l);
  }
  return l;
}
