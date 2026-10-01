// Read-only mirror of cli/lib/hubs-config.mjs for the dev-server runtime.
//
// The CLI owns writes (`maude design link` adds + removes entries); the
// dev-server only ever reads. This module deliberately re-implements the
// reader instead of importing from cli/lib so the Bun-side ts compile chain
// doesn't pull in the .mjs CLI surface.

import { existsSync, readFileSync, statSync } from 'node:fs';
import { homedir, platform } from 'node:os';
import { join } from 'node:path';

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
   * Absent means `member`: every credential written before this shipped was
   * write-capable, and nobody is demoted by an upgrade.
   */
  role?: string;
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

export function loadHubsConfig(): HubsConfig {
  const path = hubsConfigPath();
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

/**
 * Is the credential for `url` a READ-ONLY one? (Cloud Phase 25 C2)
 *
 * Answered from the role the workspace vouched for at sign-in, so the app
 * knows at BOOT rather than discovering it from the first refused write —
 * which would mean showing somebody an editor and then taking it away.
 *
 * Unknown, unreadable, or absent all answer FALSE, matching every credential
 * written before this shipped. This flag decides what the UI OFFERS; it is
 * never the thing that stops a write. That is the cell (Phase 25 C1) and the
 * gate in http.ts, both of which hold whatever this returns.
 */
export function isHubReadOnly(url: string): boolean {
  try {
    const record = loadHubsConfig().hubs[normalizeUrl(url)];
    return record?.role === 'viewer';
  } catch {
    return false;
  }
}

/** Look up a token for `url`. Returns null when no entry exists. */
export function getHubToken(url: string): string | null {
  return getHubRecord(url)?.token ?? null;
}

/** The whole stored record for `url` (token + role + expiresAt), or null. */
export function getHubRecord(url: string): HubRecord | null {
  try {
    const norm = normalizeUrl(url);
    const record = loadHubsConfig().hubs[norm];
    return record && typeof record.token === 'string' ? record : null;
  } catch {
    return null;
  }
}
