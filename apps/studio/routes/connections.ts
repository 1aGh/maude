// S11.14 — Settings › Connections › "your team's own server" › Advanced (06 ad-edge-hub).
//
// `GET /_api/connections/hub` answers what that fold draws about the hub THIS folder syncs with:
//
//   { ok: true, hub: { url, credentialed, tokenLast4, healthy, version } | null }
//
// The token itself never leaves this module: the answer carries its LAST FOUR characters, and only
// for a token long enough that four characters are a small part of it (a short pasted value gets
// `null`, so the fold reads "•••• •••• ••••"). Replace… writes through the existing credential route
// (`POST /_api/hub/link`, sync/hub-link.ts) — nothing here writes.
//
// The hub version is a TOKENLESS `GET <hub>/health` (the same probe `/_api/hub/link` makes, attacker
// finding A2: the credential is never delivered to an address a repo named), made only when a stored
// credential corroborates the link — `config.json` is committed and attacker-authorable (B2), so an
// uncredentialed `linkedHub` is never probed at all. Only a short version string is reflected.
//
// MAIN ORIGIN ONLY (`origin: 'main'`): it reads the per-profile credential store, which the untrusted
// canvas origin (DDR-054) must never reach. `guardTableRoute` adds the CSRF (`sameOriginRead`) and
// DNS-rebind (`isTrustedRequestHost`) gates. A cell never serves it (apps/hub/src/studio-manifest.mjs:
// REFUSED) — a cell has no hub credential of its own to describe.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { probeHubHealth } from '../sync/hub-link.ts';
import { getHubRecord, normalizeUrl, safeAccount } from '../sync/hubs-config.ts';
import type { RouteSpec } from './table.ts';

/** A token shorter than this shows no characters at all. */
export const TOKEN_HINT_MIN_LENGTH = 16;

export interface HubDetails {
  url: string;
  credentialed: boolean;
  tokenLast4: string | null;
  healthy: boolean | null;
  version: string | null;
  /** P8-T G1b-3 — "Signed in as": the account the sign-in recorded; null on an older credential. */
  account: string | null;
}

export interface ConnectionsRouteDeps {
  designRoot: string;
  /** The profile's hubs.json; absent = this process's (`hubsConfigPath()`). */
  hubsPath?: () => string | undefined;
  /** Injected for tests; the default is sync/hub-link.ts's tokenless `/health` probe. */
  probe?: (url: string) => Promise<{ ok: boolean; version?: string }>;
}

/** The last four characters of a long enough token, else null. Never more than four. */
export function tokenLast4(token: unknown): string | null {
  if (typeof token !== 'string') return null;
  const t = token.trim();
  return t.length >= TOKEN_HINT_MIN_LENGTH ? t.slice(-4) : null;
}

/** A version string safe to draw: short, printable, nothing that reads as markup. */
export function safeVersion(v: unknown): string | null {
  return typeof v === 'string' && /^[\w .+-]{1,40}$/.test(v) ? v : null;
}

function readLinkedUrl(designRoot: string): string | null {
  try {
    const cfg = JSON.parse(readFileSync(join(designRoot, 'config.json'), 'utf8'));
    const url = cfg?.linkedHub?.url;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}

export async function hubDetails(deps: ConnectionsRouteDeps): Promise<HubDetails | null> {
  const url = readLinkedUrl(deps.designRoot);
  if (!url) return null;
  let norm: string;
  try {
    norm = normalizeUrl(url);
  } catch {
    return {
      url,
      credentialed: false,
      tokenLast4: null,
      healthy: null,
      version: null,
      account: null,
    };
  }
  const record = getHubRecord(norm, deps.hubsPath?.());
  if (!record)
    return {
      url,
      credentialed: false,
      tokenLast4: null,
      healthy: null,
      version: null,
      account: null,
    };
  const probe = deps.probe ?? probeHubHealth;
  let healthy: boolean | null = null;
  let version: string | null = null;
  try {
    const p = await probe(norm);
    healthy = !!p.ok;
    version = safeVersion(p.version);
  } catch {
    healthy = false;
  }
  return {
    url,
    credentialed: true,
    tokenLast4: tokenLast4(record.token),
    healthy,
    version,
    account: safeAccount(record.account),
  };
}

export function createConnectionsRoutes(deps: ConnectionsRouteDeps): RouteSpec[] {
  return [
    {
      method: 'GET',
      path: '/_api/connections/hub',
      origin: 'main',
      readOnly: 'allowed',
      async handle() {
        return Response.json(
          { ok: true, hub: await hubDetails(deps) },
          { headers: { 'Cache-Control': 'no-store' } }
        );
      },
    },
  ];
}
