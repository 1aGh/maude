// sync/link-consent.ts — gate-b-sec4 (M1): a committed `linkedHub` is a CLAIM, not a link.
//
// `.design/config.json` is versioned. A repo cloned from anywhere can name a hub this Mac already
// holds a credential for (`hubs.json` is keyed by hub URL, not by folder), and the sync runtime
// used to dial it at boot carrying THIS Mac's token: uploading the clone's files into the victim's
// hub as the victim, and pulling the hub's files into a tree whose git remote the attacker owns.
//
// So the link itself is per-Mac too. `project-links.json` sits BESIDE `hubs.json` (same directory,
// so a desktop profile's own store follows `HUBS_CONFIG_PATH`; `MAUDE_PROJECT_LINKS_PATH` overrides),
// mode 0600, never synced, never in the tree — no new `_*` runtime path. It maps a folder (the repo
// root's realpath) to the hub (+ workspace) a person linked or confirmed ON THIS MAC:
//
//   { "v": 1, "since": <ms>, "links": { "<realpath>": { hub, workspaceId?, at, how } } }
//
// At boot `context.ts` honours `linkedHub` only when this record matches it (`linkConsent`); any
// other claim is PARKED (`ctx.unconfirmedHub`): the studio runs solo, sends nothing to that hub,
// and the Share sheet asks "This project says it syncs with <host>. Connect?" — the Connect route
// writes the record (routes/sync.ts). Every existing user-driven link path writes one too:
// cloud attach / Move to cloud (cloud/endpoints.ts), `maude design link` (cli/lib/project-links.mjs)
// and the app's own managed copies (the desktop passes its registry binding as
// `MAUDE_APP_BOUND_HUB`, which a repo cannot set).
//
// NO MIGRATION FROM FOLDER CONTENT (2.1.1, N1). Builds before 2.1.1 derived a `migrated` record at
// boot from the folder's own runtime sync files when their mtime predated this store. Retired:
// whoever made the folder controls both the files and their timestamps (archives restore stored
// mtimes), so that lane let folder content say "confirmed". Nothing inside the folder writes a
// record now. A `migrated` record an earlier build already wrote stays valid (`LinkHow` keeps the
// value, `matches` honours it like any other); a folder with no record gets the neutral Review…
// state and one Connect.

import {
  chmodSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export type LinkHow = 'connect' | 'link' | 'cloud-attach' | 'app' | 'migrated';

export interface ProjectLink {
  hub: string;
  workspaceId?: string;
  at: number;
  how: LinkHow;
}

interface LinksFile {
  v: 1;
  since: number;
  links: Record<string, ProjectLink>;
}

export interface LinkClaim {
  url: string;
  workspaceId?: string;
}

export interface ConsentOptions {
  /** the folder holding `.design/` — the record's key (by realpath) */
  repoRoot: string;
  /** kept for callers; nothing under it is read as evidence of a link (N1) */
  designRoot: string;
  /** the store file (default `linksPath()`) */
  file?: string;
  env?: Record<string, string | undefined>;
  now?: () => number;
}

export type ConsentVerdict =
  | { ok: true; how: LinkHow }
  | { ok: false; reason: 'no-record' | 'other-hub' | 'bad-url' };

/** Same rule as hubs-config.ts `hubsConfigPath` — kept inline so context.ts stays light. */
function hubsDir(env: Record<string, string | undefined>): string {
  if (env.HUBS_CONFIG_PATH) return path.dirname(env.HUBS_CONFIG_PATH);
  const xdg = env.XDG_CONFIG_HOME;
  return path.join(xdg && xdg.length > 0 ? xdg : path.join(homedir(), '.config'), 'maude');
}

/** `project-links.json` beside `hubs.json` (`MAUDE_PROJECT_LINKS_PATH` overrides). */
export function linksPath(env: Record<string, string | undefined> = process.env): string {
  return env.MAUDE_PROJECT_LINKS_PATH || path.join(hubsDir(env), 'project-links.json');
}

/** A hub URL as the stores key it: lower-case scheme + host, no trailing slash, no userinfo. */
export function normHub(url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null;
  try {
    const u = new URL(url);
    if (u.username || u.password) return null;
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    u.protocol = u.protocol.toLowerCase();
    u.hostname = u.hostname.toLowerCase();
    let s = u.toString();
    if (s.endsWith('/') && u.pathname === '/') s = s.slice(0, -1);
    return s;
  } catch {
    return null;
  }
}

/** The hub's host, for the words ("This project says it syncs with <host>."). */
export function hubHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.slice(0, 80);
  }
}

/** The folder as the disk names it (a /var ↔ /private/var spelling is one folder). */
export function folderKey(repoRoot: string): string {
  try {
    return realpathSync(repoRoot);
  } catch {
    return path.resolve(repoRoot);
  }
}

function readStore(file: string): LinksFile | null {
  try {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    if (!raw || typeof raw !== 'object' || typeof raw.links !== 'object' || raw.links === null)
      return null;
    const since = typeof raw.since === 'number' && Number.isFinite(raw.since) ? raw.since : 0;
    return { v: 1, since, links: raw.links as Record<string, ProjectLink> };
  } catch {
    return null;
  }
}

function writeStore(file: string, data: LinksFile): void {
  mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* best effort */
  }
  renameSync(tmp, file);
}

/** The store, created (with `since` = now) the first time this build looks. */
function loadOrInit(file: string, now: number): LinksFile {
  const have = readStore(file);
  if (have) return have;
  const fresh: LinksFile = { v: 1, since: now, links: {} };
  try {
    writeStore(file, fresh);
  } catch {
    /* unwritable: the store is created on the next write */
  }
  return fresh;
}

function matches(rec: ProjectLink | undefined, claim: LinkClaim): boolean {
  if (!rec || typeof rec !== 'object') return false;
  const hub = normHub(claim.url);
  return !!hub && rec.hub === hub && (rec.workspaceId ?? null) === (claim.workspaceId ?? null);
}

/** The record for this folder, or null. */
export function projectLinkOf(repoRoot: string, file: string = linksPath()): ProjectLink | null {
  return readStore(file)?.links[folderKey(repoRoot)] ?? null;
}

/** 2.1.1 T8 — has ANY folder on this Mac been linked to `url`? (Link your server asks before the
 *  first link to a server this Mac never linked, whatever that server says it holds.) */
export function hubEverLinked(url: string, file: string = linksPath()): boolean {
  const hub = normHub(url);
  if (!hub) return false;
  const links = readStore(file)?.links ?? {};
  return Object.values(links).some((r) => !!r && typeof r === 'object' && r.hub === hub);
}

/** Write (or replace) this folder's record — a person linked or confirmed it on this Mac. */
export function recordProjectLink(
  repoRoot: string,
  claim: LinkClaim,
  how: LinkHow,
  opts: { file?: string; now?: () => number } = {}
): void {
  const hub = normHub(claim.url);
  if (!hub) throw new Error('not a hub address');
  const file = opts.file ?? linksPath();
  const now = (opts.now ?? Date.now)();
  const store = loadOrInit(file, now);
  store.links[folderKey(repoRoot)] = {
    hub,
    ...(claim.workspaceId ? { workspaceId: claim.workspaceId } : {}),
    at: now,
    how,
  };
  writeStore(file, store);
}

/** Forget this folder's record (unlink). Best-effort. */
export function deleteProjectLink(repoRoot: string, file: string = linksPath()): void {
  const store = readStore(file);
  const key = folderKey(repoRoot);
  if (!store || !(key in store.links)) return;
  delete store.links[key];
  try {
    writeStore(file, store);
  } catch {
    /* best effort */
  }
}

/**
 * A folder that is NEW on this Mac (Home's "From GitHub" clone): forget any record left for its path
 * in every account's store (the default one and each `profiles/<id>/`), so a stale record from an
 * earlier folder at the same path can never vouch for what the clone's config claims. Returns the
 * stores it changed. The clone's own `linkedHub` is left in its file (it is the project's, and
 * versioned) — the boot gate parks it and the Share sheet asks.
 */
export function forgetFolderEverywhere(
  repoRoot: string,
  env: Record<string, string | undefined> = process.env
): number {
  const files = new Set<string>([linksPath(env)]);
  const base = env.MAUDE_PROJECT_LINKS_PATH ? null : hubsDir({ ...env, HUBS_CONFIG_PATH: '' });
  if (base) {
    files.add(path.join(base, 'project-links.json'));
    try {
      for (const id of readdirSync(path.join(base, 'profiles')))
        files.add(path.join(base, 'profiles', id, 'project-links.json'));
    } catch {
      /* no profiles */
    }
  }
  let n = 0;
  for (const f of files) {
    if (projectLinkOf(repoRoot, f)) {
      deleteProjectLink(repoRoot, f);
      n++;
    }
  }
  return n;
}

/**
 * May this Mac honour `claim` for this folder? A matching record → yes. Else the app's own binding
 * (`MAUDE_APP_BOUND_HUB`, the desktop registry's managed copy) → yes, and the record is written so
 * the question is never asked again. Else no: park the claim. Nothing in the folder counts (N1).
 */
export function linkConsent(claim: LinkClaim, o: ConsentOptions): ConsentVerdict {
  const hub = normHub(claim.url);
  if (!hub) return { ok: false, reason: 'bad-url' };
  const env = o.env ?? process.env;
  const file = o.file ?? linksPath(env);
  const now = (o.now ?? Date.now)();
  const store = loadOrInit(file, now);
  const rec = store.links[folderKey(o.repoRoot)];
  if (matches(rec, claim)) return { ok: true, how: rec?.how ?? 'connect' };
  // A record for ANOTHER hub is a person's choice on this Mac; a claim that differs from it is not
  // migrated past — it waits for Connect like any other.
  if (rec) return { ok: false, reason: 'other-hub' };
  if (normHub(env.MAUDE_APP_BOUND_HUB) !== hub) return { ok: false, reason: 'no-record' };
  const how: LinkHow = 'app';
  try {
    recordProjectLink(o.repoRoot, claim, how, { file, now: () => now });
  } catch {
    /* unwritable store: honoured for this boot; derived again next time */
  }
  return { ok: true, how };
}

/** The slice of the studio Context the Connect gate reads (structural — no context.ts import). */
export interface LinkGateCtx {
  paths: { repoRoot: string };
  unconfirmedHub?: { url: string; linkedAt: number; workspaceId?: string };
  syncControl?: {
    restart(linkedHub?: { url: string; linkedAt: number } | null): Promise<{
      syncing: boolean;
      canvases: number;
      reason?: string;
      detail?: string;
    }>;
  };
}

type SyncOutcome = { syncing: boolean; canvases: number; reason?: string; detail?: string };

export interface LinkGate {
  /** The parked claim's host, for the words — never a token, never the whole config. */
  pending(): { host: string } | null;
  /** The person pressed Connect: record consent on this Mac, adopt the claim, start syncing. */
  confirm(): Promise<
    | { ok: true; sync: SyncOutcome }
    | { ok: false; reason: 'nothing-pending' | 'record-failed'; detail: string }
  >;
}

/** gate-b-sec4 — the Connect behind "This project says it syncs with <host>. Connect?". */
export function createLinkGate(ctx: LinkGateCtx, opts: { file?: () => string } = {}): LinkGate {
  return {
    pending: () => (ctx.unconfirmedHub ? { host: hubHost(ctx.unconfirmedHub.url) } : null),
    async confirm() {
      const claim = ctx.unconfirmedHub;
      if (!claim)
        return {
          ok: false,
          reason: 'nothing-pending',
          detail: 'This project has no link waiting.',
        };
      try {
        recordProjectLink(
          ctx.paths.repoRoot,
          { url: claim.url, ...(claim.workspaceId ? { workspaceId: claim.workspaceId } : {}) },
          'connect',
          opts.file ? { file: opts.file() } : {}
        );
      } catch (err) {
        return {
          ok: false,
          reason: 'record-failed',
          detail: `Could not connect: ${String((err as Error)?.message ?? err).slice(0, 160)}`,
        };
      }
      // The value parked at boot, by value — the restart adopts it (and clears the park).
      const sync: SyncOutcome = (await ctx.syncControl?.restart(claim)) ?? {
        syncing: false,
        canvases: 0,
        reason: 'no-supervisor',
        detail: 'Restart Maude to start syncing.',
      };
      return { ok: true, sync };
    },
  };
}
