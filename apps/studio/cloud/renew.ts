// Silent hub-credential renewal — the missing half of the cell-token model.
//
// The cell session token dies with the 12 h project token that minted it
// (Phase 23 B2 — deliberate: that cap IS the revocation window, and it stays).
// The account/device token next to it never expires. Nothing connected the
// two: the desktop held a forever credential and a 12 h credential side by
// side, and when the short one died the user was told to press Connect again —
// or, worse, told nothing (the alligators incident: 73 canvases permanently
// `connecting…`).
//
// This module replays the attach lane's credential tail WITHOUT the ceremony:
//   GET  /api/projects            (account token)  → which project owns this hub
//   POST /projects/open           (account token)  → fresh 12 h project token
//   POST <cell>/auth/login        (project token)  → fresh cell session
//   saveHubCredential(…)                           → hubs.json, role preserved
//
// It deliberately does NOT touch `.design/config.json` (the link is already
// recorded; renewal is not a re-link) and does NOT cycle the sync runtime (the
// caller swaps the token in place). A renewal fails only on a REAL event —
// signed out, token revoked on the Account page, removed from the project —
// and that failure, not a clock, is what should reach the user.
//
// Trust posture: every hop talks only to the CONFIGURED cloud address or to
// the workspace URL the cloud's own /api/projects listing names for the
// matched project — never to an address read from repo-committed state.

import { existsSync, readFileSync } from 'node:fs';
import { saveHubCredential } from '../sync/hub-link.ts';
import { getHubRecord, isEditRole, normalizeUrl } from '../sync/hubs-config.ts';
import { boundCloudToken, cloudConfigPath } from './config-path.ts';

export interface RenewedCredential {
  token: string;
  expiresAt: number | null;
}

export type RenewFailureReason =
  | 'not-signed-in'
  | 'account-revoked'
  | 'no-matching-project'
  | 'open-refused'
  | 'cell-refused'
  | 'save-failed'
  | 'unreachable';

export type RenewResult =
  | ({ ok: true } & RenewedCredential)
  | { ok: false; reason: RenewFailureReason };

/** Mirrors cloud/endpoints.ts — resolved per call so tests/desktop can set it late. */
function cloudUrl(): string {
  return (process.env.MAUDE_CLOUD_URL ?? 'https://cloud.maude.sh').replace(/\/+$/, '');
}

/** The account credential, or null when this machine is signed out. */
function readAccountToken(): string | null {
  const p = cloudConfigPath();
  if (!existsSync(p)) return null;
  try {
    // W4: only for the control plane that issued it.
    return boundCloudToken(JSON.parse(readFileSync(p, 'utf8')), cloudUrl());
  } catch {
    return null;
  }
}

const FETCH_TIMEOUT_MS = 15_000;

async function jsonFetch(
  doFetch: typeof fetch,
  url: string,
  init: RequestInit = {}
): Promise<{ status: number; body: Record<string, unknown> }> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await doFetch(url, { ...init, signal: ctl.signal });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { status: res.status, body };
  } catch {
    return { status: 0, body: {} };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Mint a fresh cell session for `hubUrl` from the signed-in Maude account.
 *
 * Single network path, no interaction. Callers treat any `ok:false` as "keep
 * the old behaviour" — the stored (possibly dead) credential stays in place so
 * a failed renewal never makes things worse than before it ran.
 */
export async function renewHubCredential(
  hubUrl: string,
  doFetch: typeof fetch = fetch
): Promise<RenewResult> {
  const account = readAccountToken();
  if (!account) return { ok: false, reason: 'not-signed-in' };

  let norm: string;
  try {
    norm = normalizeUrl(hubUrl);
  } catch {
    return { ok: false, reason: 'no-matching-project' };
  }

  // Which cloud project opens onto this hub? The listing is the only mapping
  // that exists (the hub URL is derived from the project id at open time), and
  // asking it fresh means a renamed/removed project fails here — the right
  // place — instead of minting for a project this account no longer has.
  const listed = await jsonFetch(doFetch, `${cloudUrl()}/api/projects`, {
    headers: { authorization: `Bearer ${account}` },
  });
  if (listed.status === 401) return { ok: false, reason: 'account-revoked' };
  if (listed.status !== 200) return { ok: false, reason: 'unreachable' };
  const projects = Array.isArray(listed.body.projects) ? listed.body.projects : [];
  const match = projects.find((p) => {
    const url = (p as { url?: unknown })?.url;
    if (typeof url !== 'string' || !url) return false;
    try {
      return normalizeUrl(url) === norm;
    } catch {
      return false;
    }
  }) as { id?: unknown; role?: unknown } | undefined;
  // A viewer's Connect is a different lane (share-view); renewing an editor
  // credential for one would mint capability the panel never offered. Fail closed: any role a
  // hub names that is not an editing role (observer, guest, a new one) is treated like a viewer
  // — the `=== 'viewer'` comparison failed open (V2-4 gate, V2-1.7 R1). No role = an older hub.
  if (
    !match ||
    typeof match.id !== 'string' ||
    (match.role !== undefined && !isEditRole(match.role))
  ) {
    return { ok: false, reason: 'no-matching-project' };
  }

  const opened = await jsonFetch(doFetch, `${cloudUrl()}/projects/open`, {
    method: 'POST',
    headers: { authorization: `Bearer ${account}`, 'content-type': 'application/json' },
    body: JSON.stringify({ project: match.id }),
  });
  if (opened.status === 0) return { ok: false, reason: 'unreachable' };
  if (opened.status !== 200 || typeof opened.body.token !== 'string' || !opened.body.token) {
    // This is where a removed member's renewal dies — exactly where it should.
    return { ok: false, reason: 'open-refused' };
  }

  const cellLogin = await jsonFetch(doFetch, `${norm}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token: opened.body.token }),
  });
  if (cellLogin.status === 0) return { ok: false, reason: 'unreachable' };
  if (
    cellLogin.status !== 200 ||
    typeof cellLogin.body.token !== 'string' ||
    !cellLogin.body.token
  ) {
    return { ok: false, reason: 'cell-refused' };
  }
  const expiresAt =
    typeof cellLogin.body.expiresAt === 'number' && Number.isFinite(cellLogin.body.expiresAt)
      ? cellLogin.body.expiresAt
      : null;

  // The upsert replaces the whole record, so the role must be re-supplied. F5:
  // prefer the role the cell JUST vouched (its /auth/login echoes `user.role`)
  // over the stored one — this is the one moment the code learns the current
  // role, and carrying the stale value forward would discard exactly that.
  // Fall back to the prior role only when the cell didn't say (older cell).
  const freshRoleRaw = (cellLogin.body.user as { role?: unknown } | undefined)?.role;
  const freshRole = typeof freshRoleRaw === 'string' && freshRoleRaw ? freshRoleRaw : undefined;
  const role = freshRole ?? getHubRecord(norm)?.role;
  try {
    saveHubCredential(norm, cellLogin.body.token, role, expiresAt ?? undefined);
  } catch {
    return { ok: false, reason: 'save-failed' };
  }

  return { ok: true, token: cellLogin.body.token, expiresAt };
}
