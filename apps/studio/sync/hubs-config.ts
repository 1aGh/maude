// Read-only mirror of cli/lib/hubs-config.mjs for the dev-server runtime.
//
// The CLI owns writes (`maude design link` adds + removes entries); the
// dev-server only ever reads. This module deliberately re-implements the
// reader instead of importing from cli/lib so the Bun-side ts compile chain
// doesn't pull in the .mjs CLI surface.

import { existsSync, readFileSync, type Stats, statSync, unwatchFile, watchFile } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

import { can, FLOOR_ROLE, projectRoleForAccount } from '../access/roles.ts';
import { type AccessClaim, legacyClaim, resolveAccess } from '../access/scope.ts';

export interface HubRecord {
  token: string;
  linkedAt: number;
  /**
   * The role the workspace vouched for at sign-in (Cloud Phase 25 C2).
   *
   * Stored so a viewer is known to be a viewer at BOOT, before any request is
   * made — the alternative is discovering it from the first refusal, which
   * means showing somebody an editor and taking it away.
   *
   * Absent means the FLOOR (`observer`, read-only) until a sign-in heals it —
   * Phase 4 security D3 / S9.9. It used to mean `member`, so a credential whose
   * role nobody ever learned (a pasted token, an older hub) counted as writable.
   *
   * v1 projection: a v2 writer stores here only a role a 1.x build reads the
   * right way round (`v1RoleProjection`) — 1.9.x reads `role === 'viewer'` as
   * its ONLY read-only answer, so `observer` here would be writable there.
   */
  role?: string;
  /**
   * The whole access claim the hub vouched (V2-1.7 §5.4) — project role +
   * canvas grants — when it says more than `role` can (an observer, canvas
   * grants). Additive: a 1.x build ignores the unknown key and reads `role`.
   */
  access?: AccessClaim;
  /**
   * When this credential dies (ms epoch), as the workspace reported at mint.
   *
   * A cell session expires WITH the 12 h project token that minted it (Phase
   * 23 B2 — that cap is the revocation window and must stay). What was
   * missing is anyone LOOKING at the deadline: the token was saved, the
   * expiry discarded, and ≤ 12 h later all sync died into a permanent
   * `connecting…`. Stored so the runtime can renew BEFORE it, silently.
   *
   * Absent on self-hosted hubs (their tokens may not expire) and on every
   * credential written before this shipped — both mean "no scheduled
   * renewal", which is exactly the old behaviour.
   */
  expiresAt?: number;
  /**
   * A LOCAL, user-given consent: may this hub deliver executable modules?
   *
   * `role` above is the hub's own claim about you, re-read from every sign-in
   * response — a cache of what the hub said, not local knowledge. Deriving the
   * `code-module` receive gate from it meant the gate was set by the party it
   * defends against: a hostile hub answers `user.role: "owner"` once and every
   * `.ts`/`.mjs` it offers lands in `.design/`, where the AGENT and the
   * `maude design *` helpers read it — a different blast radius from a `.tsx`
   * rendering in the sandboxed canvas origin.
   *
   * So it is recorded here at link time by an explicit answer and NEVER
   * rewritten by a login response. Absent means no — the pessimistic branch,
   * the same direction every other default in this file leans.
   */
  codeModulesAllowed?: boolean;
  /**
   * LOCAL consent: this machine's outbound delete breaker is OFF for this hub,
   * so a deliberate bulk cleanup propagates at once instead of 10 per pass and
   * 25 per hour. Same discipline as `codeModulesAllowed` — written only by
   * `maude design bulk-deletes`, never by a sign-in response. It pairs with the
   * hub, which admits unlimited deletes only from an OWNER-role token
   * (`apps/hub/src/journal.mjs` OWNER_DELETE_SOURCE): a non-owner who sets it
   * just meets the hub's 429 sooner. Absent means the breaker is on.
   */
  unlimitedDeletes?: boolean;
}

export interface HubsConfig {
  hubs: Record<string, HubRecord>;
}

/** Resolve the on-disk path to hubs.json (matches cli/lib/hubs-config.mjs). */
export function hubsConfigPath(): string {
  if (process.env.HUBS_CONFIG_PATH) return process.env.HUBS_CONFIG_PATH;
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), '.config');
  return join(base, 'maude', 'hubs.json');
}

/** Normalize a hub URL — trim trailing slash, lower-case scheme + host. */
export function normalizeUrl(url: string): string {
  const u = new URL(url);
  // Reject embedded credentials outright (2026-08-10 review, claim-a residual).
  // `URL.toString()` PRESERVES `user:pass@` — the renewal lane is safe only
  // because it fetches the normalized string and requires it to equal a URL the
  // cloud itself listed. A `https://evil@proj.cloud.maude.sh` config would
  // survive normalization intact; refusing it here means such a value can never
  // be stored or matched, so a later "fetch hubUrl directly" edit can't become
  // credential exfiltration. A real hub URL never carries userinfo.
  if (u.username || u.password) {
    throw new Error('hub URL must not contain embedded credentials');
  }
  u.protocol = u.protocol.toLowerCase();
  u.hostname = u.hostname.toLowerCase();
  let str = u.toString();
  if (str.endsWith('/') && u.pathname === '/') str = str.slice(0, -1);
  return str;
}

export function loadHubsConfig(path: string = hubsConfigPath()): HubsConfig {
  if (!existsSync(path)) return { hubs: {} };
  warnIfWorldOrGroupReadable(path);
  try {
    const raw = readFileSync(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed.hubs !== 'object' || parsed.hubs === null) {
      return { hubs: {} };
    }
    return parsed;
  } catch {
    return { hubs: {} };
  }
}

// DDR-054 §2h (attacker F15). The CLI writes hubs.json with mode 0600. If a
// user later opens the file with an editor that resets permissions, or syncs
// it from a different host, the dev-server warns once on read. Non-blocking —
// Windows + funky-umask hosts get a polite nudge rather than a hard refusal.
let _modeWarnedFor: string | null = null;
function warnIfWorldOrGroupReadable(path: string): void {
  if (platform() === 'win32') return; // POSIX-mode semantics don't apply
  if (_modeWarnedFor === path) return; // warn once per process
  try {
    const stats = statSync(path);
    const mode = stats.mode & 0o777;
    if ((mode & 0o077) !== 0) {
      console.warn(
        `[sync] ${path} is mode ${mode.toString(8)} — recommend 'chmod 600 ${path}' (only owner can read hub tokens).`
      );
      _modeWarnedFor = path;
    }
  } catch {
    /* statSync raced with a delete — next read will retry */
  }
}

/** A hub-vouched role that may edit. Anything else a hub names holds nothing (V2-1.7 R1). */
export const isEditRole = (role: unknown): boolean =>
  typeof role === 'string' && can(projectRoleForAccount(role), 'edit');

/**
 * The role a 1.x build must read for `role` (the hubs.json `role` field): the role itself
 * when 1.x reads it right (`owner` / `member` / `viewer` / `admin`), else `viewer` — the
 * only read-only answer 1.9.x knows (`isHubReadOnly`: `role === 'viewer'`). The real
 * claim then rides in `access` (V2-1.7 Q3: no second 1.x release).
 */
export function v1RoleProjection(role: string | null | undefined): string {
  if (typeof role === 'string' && ['owner', 'member', 'viewer', 'admin'].includes(role))
    return role;
  return 'viewer';
}

/**
 * The stored access claim for `url` — what the local gate asks (V2-1.7 §5.7 `accessFor`,
 * replacing the 1-bit `isHubReadOnly`).
 *
 *   - `access` stored → that claim (validated by `resolveAccess` where it is used);
 *   - a `role` stored → `legacyClaim(role)` (an unknown role holds nothing, R1);
 *   - a record WITHOUT a role → the floor (`observer`): read-only until a sign-in heals it
 *     (Phase 4 security D3). It used to be writable;
 *   - no record (or no readable file) → `member`: a linked project with no credential on
 *     this Mac syncs nothing, so it is edited like a local one, but is never the owner's.
 */
export function accessFor(url: string, path?: string): AccessClaim {
  let record: HubRecord | undefined;
  try {
    record = loadHubsConfig(path).hubs[normalizeUrl(url)];
  } catch {
    record = undefined;
  }
  if (!record || typeof record !== 'object') return legacyClaim('member');
  if (record.access && typeof record.access === 'object') return record.access;
  if (typeof record.role === 'string' && record.role) return legacyClaim(record.role);
  return legacyClaim(FLOOR_ROLE);
}

/** The 1-bit projection of `accessFor`: may NOT edit anything at project level. */
export function isHubReadOnly(url: string): boolean {
  return !resolveAccess(accessFor(url)).can('edit', null);
}

/** Look up a token for `url`. Returns null when no entry exists. */
export function getHubToken(url: string): string | null {
  return getHubRecord(url)?.token ?? null;
}

/** The whole stored record for `url` (token + role + expiresAt), or null. */
export function getHubRecord(url: string, path?: string): HubRecord | null {
  try {
    const norm = normalizeUrl(url);
    const record = loadHubsConfig(path).hubs[norm];
    return record && typeof record.token === 'string' ? record : null;
  } catch {
    return null;
  }
}

/**
 * S9.12b (V2-1.16 U6, desktop) — call `onChange` whenever hubs.json is written, replaced,
 * created or removed (a re-sign-in, a role drop, a link or unlink — from this process, the
 * CLI or the desktop shell). A stat poll, not `fs.watch`: the writers replace the file by
 * rename, and the file may not exist yet. Unref'd; returns the stop function.
 */
export function watchHubsConfig(
  onChange: () => void,
  opts: { path?: string; intervalMs?: number } = {}
): () => void {
  const path = opts.path ?? hubsConfigPath();
  const listener = (cur: Stats, prev: Stats) => {
    if (cur.mtimeMs === prev.mtimeMs && cur.ino === prev.ino && cur.size === prev.size) return;
    try {
      onChange();
    } catch (err) {
      console.error('[sync] hubs.json change handler failed:', err);
    }
  };
  watchFile(path, { interval: opts.intervalMs ?? 500, persistent: false }, listener);
  return () => unwatchFile(path, listener);
}
