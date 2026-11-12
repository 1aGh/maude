// S3 (universal-ACP security review, defender H1) — no agent whose READS are judged by its own
// permission engine starts in a folder that holds a link out of it.
//
// Measured (S1, contract note "Security fixes S1"): opencode 1.18.30's `read` tool follows an
// in-project symlink, committed or not, to a file outside every root and returns it with no card.
// Its permission engine judges the path it is GIVEN, never the real one. Gemini and Copilot judge
// reads the same way (`readGate: 'agent-permission-engine'`). Codex is unaffected: its OS sandbox
// (Seatbelt) resolves the link before it judges (`readGate: 'os-sandbox'`).
//
// Decision (lead, fail closed): such an agent does not start while any root it is given (every
// write root and read root) holds a symlink whose real target lies outside the read roots or inside
// a credential path. The walk never follows a link and skips nothing; what it cannot finish (too
// many entries, too slow, a folder it cannot read, a link loop) also refuses, each with its own
// words. A dangling link is ignored: it leads nowhere today.
//
// Residual (named): a link that appears mid-session (the person's own `ln -s`, an approved shell
// command, a `git pull` they ran) is not seen until the next spawn; a HARD link is the file itself
// and cannot be told from one (a clone never carries one; making one needs the shell card).

import { type Dirent, readdirSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { CredentialPaths } from '../may-scope.ts';
import { isInsideRoot } from '../write-scope.ts';

/**
 * Default caps: a project past them is refused as "too large to check" (fail closed). Measured
 * 2026-11-12 (M-series, warm cache): ≈1.8 µs per entry (42k entries in 77 ms), so 250k entries is
 * ≈0.5 s and the time cap only bites on a slow or cold disk. The read roots include Maude's own
 * studio folder (≈42k entries in a source checkout, few in the app), so the cap is shared with it.
 */
export const LINK_SCAN_MAX_ENTRIES = 250_000;
export const LINK_SCAN_MAX_MS = 2_000;

export type LinkScanReason = 'escape' | 'credential' | 'loop' | 'unreadable' | 'too-large';

export type LinkScanResult =
  | { ok: true; entries: number }
  | {
      ok: false;
      reason: LinkScanReason;
      /** The link (escape / credential / loop) or the folder (unreadable) it stopped at. */
      path?: string;
      /** Where an escaping link leads (its real path). */
      target?: string;
      entries: number;
    };

export interface LinkScanInput {
  /** Every root the agent is given: write roots and read roots (duplicates and nesting are fine). */
  roots: readonly string[];
  /** What a link may lead into. */
  readRoots: readonly string[];
  credentialPaths: CredentialPaths;
  maxEntries?: number;
  maxMs?: number;
  /** Monotonic clock in ms (tests). */
  now?: () => number;
}

const errCode = (e: unknown) => (e as NodeJS.ErrnoException | null)?.code ?? '';

function realOrNull(p: string): string | null {
  try {
    return realpathSync.native(p);
  } catch {
    return null;
  }
}

/** Inside or equal — a link to a root itself stays inside it. */
const within = (target: string, root: string) => target === root || isInsideRoot(target, root);

/**
 * Each credential path as given AND as its real path (`/var` → `/private/var`), case-folded like
 * `isProtectedInProject`: macOS's default disk is case-insensitive, so `~/.SSH` is `~/.ssh`. The
 * fold only ever ADDS a refusal.
 */
function foldedCredentials(cred: CredentialPaths): { dirs: string[]; files: string[] } {
  const both = (list: readonly string[]) => {
    const out = new Set<string>();
    for (const p of list) {
      if (!isAbsolute(p)) continue;
      out.add(resolve(p).toLowerCase());
      const real = realOrNull(p);
      if (real) out.add(real.toLowerCase());
    }
    return [...out];
  };
  return { dirs: both(cred.dirs), files: both(cred.files) };
}

function inCredentials(target: string, cred: { dirs: string[]; files: string[] }): boolean {
  const t = target.toLowerCase();
  return cred.dirs.some((d) => within(t, d)) || cred.files.includes(t);
}

/** Walk every root without following a link; the first unsafe link (or an unfinished walk) wins. */
export function scanLinks(input: LinkScanInput): LinkScanResult {
  const maxEntries = input.maxEntries ?? LINK_SCAN_MAX_ENTRIES;
  const maxMs = input.maxMs ?? LINK_SCAN_MAX_MS;
  const now = input.now ?? (() => performance.now());
  const started = now();
  let entries = 0;
  const credentials = foldedCredentials(input.credentialPaths);

  // What a link may lead into: each read root as given AND as its real path (`/var` → `/private/var`).
  const allowed = new Set<string>();
  for (const r of input.readRoots) {
    if (!isAbsolute(r)) continue;
    allowed.add(resolve(r));
    const real = realOrNull(r);
    if (real) allowed.add(real);
  }

  // The folders to walk: each root's real path once, a root nested in another walked as part of it.
  const real: string[] = [];
  for (const r of input.roots) {
    if (!isAbsolute(r)) continue;
    let p: string;
    try {
      p = realpathSync.native(r);
    } catch (e) {
      // A root that does not exist holds no link; one we cannot resolve cannot be checked.
      if (errCode(e) === 'ENOENT' || errCode(e) === 'ENOTDIR') continue;
      return { ok: false, reason: 'unreadable', path: resolve(r), entries };
    }
    if (!real.includes(p)) real.push(p);
  }
  real.sort((a, b) => a.length - b.length);
  const walk = real.filter((p, i) => !real.slice(0, i).some((q) => isInsideRoot(p, q)));

  for (const root of walk) {
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop() as string;
      let list: Dirent[];
      try {
        list = readdirSync(dir, { withFileTypes: true });
      } catch (e) {
        // A root that is a plain file holds no link below it.
        if (dir === root && errCode(e) === 'ENOTDIR') break;
        // Removed while we walked: nothing there to follow.
        if (errCode(e) === 'ENOENT') continue;
        return { ok: false, reason: 'unreadable', path: dir, entries };
      }
      for (const ent of list) {
        entries++;
        if (entries > maxEntries) return { ok: false, reason: 'too-large', entries };
        if ((entries & 511) === 0 && now() - started > maxMs) {
          return { ok: false, reason: 'too-large', entries };
        }
        const p = join(dir, ent.name);
        if (ent.isSymbolicLink()) {
          let target: string;
          try {
            target = realpathSync.native(p);
          } catch (e) {
            const code = errCode(e);
            if (code === 'ENOENT' || code === 'ENOTDIR') continue; // dangling: leads nowhere today
            if (code === 'ELOOP') return { ok: false, reason: 'loop', path: p, entries };
            return { ok: false, reason: 'unreadable', path: p, entries };
          }
          if (inCredentials(target, credentials)) {
            return { ok: false, reason: 'credential', path: p, target, entries };
          }
          if (![...allowed].some((r) => within(target, r))) {
            return { ok: false, reason: 'escape', path: p, target, entries };
          }
        } else if (ent.isDirectory()) {
          stack.push(p);
        }
      }
    }
    if (now() - started > maxMs) return { ok: false, reason: 'too-large', entries };
  }
  return { ok: true, entries };
}

/** The refusal an agent's spawn throws; index.ts sends it as an `agent-unsafe-link` error frame. */
export class UnsafeLinkError extends Error {
  readonly code = 'agent-unsafe-link';
  constructor(
    message: string,
    readonly reason: LinkScanReason,
    /** The link (or folder) it stopped at, relative to the project when inside it. */
    readonly link: string | null
  ) {
    super(message);
    this.name = 'UnsafeLinkError';
  }
}

/** Plain words for a refusal (CONTRACT §4 voice: what happened · what to do). */
export function unsafeLinkWords(
  r: Extract<LinkScanResult, { ok: false }>,
  label: string,
  link: string | null
): string {
  const head = `Maude did not start ${label} in this project:`;
  switch (r.reason) {
    case 'escape':
      return `${head} the link ${link} leads outside the folders AI may read, and ${label} would read through it without asking. Remove the link, or use Claude or Codex here.`;
    case 'credential':
      return `${head} the link ${link} leads to a place where sign-ins and keys are kept. Remove the link, or use Claude or Codex here.`;
    case 'loop':
      return `${head} the link ${link} points back at itself, so Maude cannot check where it leads. Remove the link, or use Claude or Codex here.`;
    case 'unreadable':
      return `${head} Maude cannot read ${link ?? 'a folder'} to check it for links that lead outside the project. Use Claude or Codex here.`;
    case 'too-large':
      return `${head} the project is too large for Maude to check for links that lead outside it. Use Claude or Codex here.`;
  }
}

/**
 * Throws `UnsafeLinkError` when the scan fails. `projectRoot` only shortens the link in the words
 * (a path outside it is shown in full).
 */
export function assertNoUnsafeLinks(
  input: LinkScanInput & { label: string; projectRoot: string }
): void {
  const r = scanLinks(input);
  if (r.ok) return;
  let link: string | null = r.path ?? null;
  if (link) {
    const base = realOrNull(input.projectRoot) ?? resolve(input.projectRoot);
    if (isInsideRoot(link, base)) link = relative(base, link);
  }
  throw new UnsafeLinkError(unsafeLinkWords(r, input.label, link), r.reason, link);
}
