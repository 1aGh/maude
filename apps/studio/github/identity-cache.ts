// github/identity-cache.ts — per-user, on-disk SWR cache for the signed-in
// GitHub identity (login · name · avatar_url). DDR-132.
//
// WHY DISK (not in-memory): a repo switch RESPAWNS the dev-server sidecar with a
// new --root (sidecar.rs `switch_project` kills + respawns), so any in-process
// cache is lost on every open/switch/restart and "Checking GitHub…" re-fetches
// the (essentially never-changing) profile each time. A per-USER file survives
// the respawn so the identity paints instantly.
//
// SECURITY (DDR-108 / DDR-054): the token is the single source of truth and is
// NEVER written here — only a sha256 prefix (`tokenHash`) is stored as the cache
// KEY. A token swap / different account ⇒ a different key ⇒ a clean miss ⇒ one
// fresh fetch, so the file can never serve account A's profile to account B.
// Identity is per-user public profile data (not secret), so a shared per-user
// cache is correct and sidesteps the `.design/` runtime-state machinery entirely.
// File + dir are owner-only (0600 / 0700).
//
// Disk path uses `os.homedir()` / `$XDG_CACHE_HOME`, never `__dirname` — inside a
// `bun --compile` standalone binary `import.meta.url` is the virtual /$bunfs root
// (DDR-045); the home dir is always a real disk path.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { atomicWrite } from '../sync/atomic-write.ts';
import type { GitHubIdentity } from './service.ts';

// V2-3.4 (old T9) — ONE FILE PER KEY. Account profiles put two GitHub tokens on one machine
// (one per tab's profile); a single slot made them evict each other, so every switch between
// two tabs was a cache miss and a GitHub round-trip. Each token hash now owns
// `github-identity-<hash16>.json`; the newest MAX_ENTRIES survive (a profile is a handful of
// accounts, not a crowd). The token itself is still never written (DDR-132).
const CACHE_PREFIX = 'github-identity-';
const CACHE_SUFFIX = '.json';
/** The pre-V2-3.4 single slot. Removed on the next write; never read. */
const LEGACY_CACHE_FILE = 'github-identity.json';
const MAX_ENTRIES = 8;
/** A key names a file, so it must be exactly what `tokenHash` produces. */
const KEY_RE = /^[0-9a-f]{16}$/;
// The record is three short public strings — a few hundred bytes. Cap the read so
// a poisoned/oversized file at the cache path can't slurp into memory on the
// identity hot path (security review: treat the on-disk file as untrusted input).
const MAX_CACHE_BYTES = 64 * 1024;

interface CacheRecord {
  /** sha256(token) prefix — the only token-derived value persisted. */
  key: string;
  identity: GitHubIdentity;
  /** epoch ms of the last successful (re)validation. */
  at: number;
}

/**
 * The per-user cache directory: `$XDG_CACHE_HOME/maude` when set, else `~/.maude`.
 * Created 0700 (owner-only) on first use; mkdir is a cheap no-op when present.
 */
export function cacheDir(): string {
  const xdg = process.env.XDG_CACHE_HOME;
  const base = xdg && xdg.length > 0 ? join(xdg, 'maude') : join(homedir(), '.maude');
  mkdirSync(base, { recursive: true, mode: 0o700 });
  // mkdirSync only applies `mode` when it CREATES the dir — re-tighten a
  // pre-existing one (e.g. a looser `~/.cache` parent or an older `~/.maude`) so
  // a shared-tenant co-user can't even list the cache. Best-effort; the 0600 file
  // is the real confidentiality guarantee.
  try {
    chmodSync(base, 0o700);
  } catch {
    /* not our dir to tighten / unsupported fs — the file mode still protects content */
  }
  return base;
}

function cacheFile(key: string): string {
  return join(cacheDir(), `${CACHE_PREFIX}${key}${CACHE_SUFFIX}`);
}

/** Keep the newest MAX_ENTRIES per-key files (by mtime) and drop the legacy slot. Best-effort. */
function prune(dir: string): void {
  try {
    unlinkSync(join(dir, LEGACY_CACHE_FILE));
  } catch {
    /* absent — the usual case */
  }
  let entries: { name: string; at: number }[];
  try {
    entries = readdirSync(dir)
      .filter((n) => n.startsWith(CACHE_PREFIX) && n.endsWith(CACHE_SUFFIX))
      .map((name) => ({ name, at: statSync(join(dir, name)).mtimeMs }));
  } catch {
    return;
  }
  entries.sort((a, b) => b.at - a.at);
  for (const e of entries.slice(MAX_ENTRIES)) {
    try {
      unlinkSync(join(dir, e.name));
    } catch {
      /* raced with another sidecar — fine */
    }
  }
}

/**
 * sha256 of the token, first 16 hex chars. In-memory only — derived per call and
 * used solely as the cache key. 64 bits of prefix is collision-safe for the tiny
 * keyspace (one token per machine at a time) while not persisting the full hash.
 */
export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}

/**
 * Return the cached identity ONLY when its stored key matches `key` (same token).
 * A missing/corrupt file, a parse error, or a key mismatch is a clean miss (null)
 * — never throws, so the endpoint always degrades to a fresh fetch.
 */
export function readCached(key: string): GitHubIdentity | null {
  if (!KEY_RE.test(key)) return null;
  const file = cacheFile(key);
  let raw: string;
  try {
    // Size-gate before reading: a record is a few hundred bytes; refuse anything
    // implausibly large as a clean miss rather than slurping it synchronously.
    if (statSync(file).size > MAX_CACHE_BYTES) return null;
    raw = readFileSync(file, 'utf8');
  } catch {
    return null; // missing file — the common first-run miss
  }
  try {
    const rec = JSON.parse(raw) as Partial<CacheRecord>;
    if (
      rec &&
      rec.key === key &&
      rec.identity &&
      typeof rec.identity.login === 'string' &&
      typeof rec.identity.avatar_url === 'string' &&
      (rec.identity.name === null || typeof rec.identity.name === 'string')
    ) {
      return {
        login: rec.identity.login,
        name: rec.identity.name ?? null,
        avatar_url: rec.identity.avatar_url,
      };
    }
  } catch {
    // corrupt JSON — fall through to a clean miss; the next write heals it.
  }
  return null;
}

/**
 * Persist `identity` under `key` atomically (tmp + rename, mode 0600). The token
 * itself is never part of the payload. Best-effort: a write failure is swallowed
 * by the caller (a cache miss next time is harmless).
 */
export function writeCached(key: string, identity: GitHubIdentity): void {
  if (!KEY_RE.test(key)) return;
  const rec: CacheRecord = { key, identity, at: Date.now() };
  atomicWrite(cacheFile(key), JSON.stringify(rec));
  prune(cacheDir());
}

/**
 * Drop one key's entry (e.g. a revoked token surfaced during background
 * revalidation), so the next call for that token re-fetches. Other profiles'
 * entries stay. Best-effort; a missing file is fine.
 */
export function clearCached(key: string): void {
  if (!KEY_RE.test(key)) return;
  try {
    unlinkSync(cacheFile(key));
  } catch {
    /* already gone */
  }
}

export const __testing = { cacheFile, MAX_ENTRIES, LEGACY_CACHE_FILE };
