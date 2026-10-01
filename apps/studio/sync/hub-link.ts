// sync/hub-link.ts — Phase 29 (E4) Door C: connect to a team hub from the wizard.
//
// The CLI (`maude design link`) owns the FULL link flow (interactive trust gate +
// per-project `.design/config.json` linkedHub write + `--adopt` push). This is the
// lean in-app counterpart used by the onboarding wizard's advanced door: it saves the
// hub CREDENTIAL to the global `~/.config/maude/hubs.json` (mode 0600) and records the
// hub as trusted on THIS machine — the in-UI "Connect" IS the explicit trust grant the
// CLI's interactive confirmation provides (DDR-054 F2). Hub tokens are GLOBAL /
// per-machine (keyed by normalized URL), so a project later opened whose
// `.design/config.json` names this hub syncs using the saved token. We deliberately do
// NOT write a per-project `linkedHub` here (onboarding has no project yet) — that stays
// a CLI / post-onboarding operation.
//
// SECURITY: the http layer gates this main-origin + loopback only (mirrors
// /_api/github/*). The health probe is a best-effort, TOKENLESS GET to the user-entered
// hub URL; only `{ ok, version }` is reflected back — no response-body passthrough, so it
// can't become an SSRF data-exfil channel. The probe deliberately does NOT carry the hub
// token: a user who pastes a lookalike URL must not have their credential delivered to the
// attacker's host (phase-29 /flow:done attacker finding A2). The token is only persisted
// locally (mode 0600) and presented later on the authenticated sync WS upgrade. The hub
// address is whatever the user typed (a LAN / Tailscale / fly.dev URL is legitimate —
// phase-9's hub model expects private hosts), so we do NOT block private IPs; the safety
// is the loopback caller gate + no reflection + no token on the probe.

import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { hubsConfigPath, normalizeUrl } from './hubs-config.ts';

export interface HubLinkResult {
  status: number;
  json: unknown;
}

const HUB_PROBE_TIMEOUT_MS = 4000;

interface HubsFile {
  hubs: Record<
    string,
    {
      token: string;
      linkedAt: number;
      role?: string;
      expiresAt?: number;
      /** Local consent — see `HubRecord.codeModulesAllowed` in hubs-config.ts. */
      codeModulesAllowed?: boolean;
      /** Local consent — see `HubRecord.unlimitedDeletes` in hubs-config.ts. */
      unlimitedDeletes?: boolean;
    }
  >;
  trusted?: string[];
}

/** Validate + probe + persist a hub credential. Returns an http-shaped result. */
export async function linkHub(body: unknown): Promise<HubLinkResult> {
  const b = (body ?? {}) as { url?: unknown; token?: unknown };
  if (typeof b.url !== 'string' || !b.url.trim()) return bad('Enter the hub address.');
  if (typeof b.token !== 'string' || !b.token.trim())
    return bad('Paste the invite link or token your team gave you.');

  let norm: string;
  try {
    norm = normalizeUrl(b.url.trim());
  } catch {
    return bad("That doesn't look like a valid hub address.");
  }
  let parsed: URL;
  try {
    parsed = new URL(norm);
  } catch {
    return bad('Invalid hub address.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')
    return bad('The hub address must start with http:// or https://.');

  const token = b.token.trim();

  // Best-effort reachability probe — TOKENLESS (never deliver the credential to a
  // possibly-lookalike host) and does NOT gate the save (a firewalled hub the user
  // trusts still links; the real auth happens on the sync WS upgrade).
  const probe = await probeHealth(norm);

  try {
    saveHubCredential(norm, token);
  } catch {
    return { status: 500, json: { ok: false, error: "Couldn't save the hub connection." } };
  }

  return {
    status: 200,
    json: { ok: true, url: norm, healthy: probe.ok, version: probe.version ?? null },
  };
}

function bad(error: string): HubLinkResult {
  return { status: 400, json: { ok: false, error } };
}

async function probeHealth(url: string): Promise<{ ok: boolean; version?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HUB_PROBE_TIMEOUT_MS);
  try {
    // Tokenless on purpose (attacker finding A2): /health is a liveness check; the
    // credential is never sent to the user-typed host, only to the trusted hub on the
    // authenticated sync WS upgrade later.
    const res = await fetch(`${url}/health`, { signal: ctrl.signal });
    if (!res.ok) return { ok: false };
    let version: string | undefined;
    try {
      const j = (await res.json()) as { version?: unknown };
      if (j && typeof j.version === 'string') version = j.version;
    } catch {
      /* health may not be JSON — reachability alone is enough */
    }
    return { ok: true, version };
  } catch {
    return { ok: false };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Upsert the token (+ the vouched role + expiry) under `normUrl` + record
 * per-machine trust; mode 0600.
 *
 * The upsert REPLACES the record, so a caller that knows the role/expiry must
 * pass them again or they are dropped — the silent-renewal path reads the old
 * record first and carries the role forward for exactly this reason.
 */
export function saveHubCredential(
  normUrl: string,
  token: string,
  role?: string,
  expiresAt?: number
): void {
  const path = hubsConfigPath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  let cfg: HubsFile = { hubs: {} };
  if (existsSync(path)) {
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8'));
      if (parsed && typeof parsed.hubs === 'object' && parsed.hubs !== null)
        cfg = parsed as HubsFile;
    } catch {
      /* malformed → start fresh rather than throw */
    }
  }
  // `codeModulesAllowed` is LOCAL consent and survives every re-save. A
  // sign-in response can change what the hub claims your role is; it must not
  // be able to change what you agreed this hub may deliver.
  const priorConsent = cfg.hubs[normUrl]?.codeModulesAllowed;
  const priorDeletes = cfg.hubs[normUrl]?.unlimitedDeletes;
  cfg.hubs[normUrl] = {
    token,
    linkedAt: Date.now(),
    ...(role ? { role } : {}),
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt } : {}),
    ...(typeof priorConsent === 'boolean' ? { codeModulesAllowed: priorConsent } : {}),
    ...(typeof priorDeletes === 'boolean' ? { unlimitedDeletes: priorDeletes } : {}),
  };
  if (!Array.isArray(cfg.trusted)) cfg.trusted = [];
  if (!cfg.trusted.includes(normUrl)) cfg.trusted.push(normUrl);
  // F3 (2026-08-10 review) — atomic temp-then-rename. This write used to run
  // only when a human pressed Connect; silent renewal now fires it on a timer,
  // several times a minute under a rejection burst. A truncating in-place
  // writeFileSync that is interrupted (crash / kill / full disk) leaves a
  // half-written file — and since it holds EVERY hub credential on the machine,
  // that drops them all. rename(2) is atomic on POSIX: a reader sees the whole
  // old file or the whole new one, never a torn one.
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* windows / read-only fs — best effort */
  }
  renameSync(tmp, path);
}

/**
 * Forget the credential + per-machine trust for `normUrl` — the unlink half of
 * `saveHubCredential`. Idempotent (a missing entry is simply done), and atomic
 * for the same reason the save is: the file holds EVERY hub credential on the
 * machine, so a torn write drops them all.
 */
export function deleteHubCredential(normUrl: string): void {
  const path = hubsConfigPath();
  if (!existsSync(path)) return;
  let cfg: HubsFile;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    if (!parsed || typeof parsed.hubs !== 'object' || parsed.hubs === null) return;
    cfg = parsed as HubsFile;
  } catch {
    return; // malformed → nothing recoverable to forget
  }
  if (!(normUrl in cfg.hubs) && !cfg.trusted?.includes(normUrl)) return;
  delete cfg.hubs[normUrl];
  if (Array.isArray(cfg.trusted)) cfg.trusted = cfg.trusted.filter((u) => u !== normUrl);
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(cfg, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  try {
    chmodSync(tmp, 0o600);
  } catch {
    /* windows / read-only fs — best effort */
  }
  renameSync(tmp, path);
}

export const __testing = { probeHealth };
