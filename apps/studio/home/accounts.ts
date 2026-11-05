// home/accounts.ts — 2.0.5 W4b: the accounts each profile on this Mac is signed in with, for Home's
// avatar, and the per-account sign-outs it offers.
//
//   GET  /_home/accounts?profiles=a,b   → { ok, profiles: [{ id, hubs: [{ url, account }] }] }
//   POST /_home/hub/signout    { profile, url } → forget that profile's sign-in for that server
//   POST /_home/cloud/signout  { profile }      → forget that profile's Maude Cloud sign-in
//
// Public handles only: a server address and the account the server vouched for at sign-in
// (`hubs.json` `account`, display data) — never a token. A profile id is `[a-z0-9-]{1,32}`
// (`profileHubsPath` refuses anything else); a profile's files are named from its id the same way
// `profiles.rs` `paths_in` names them. A sign-out removes ONE credential from that profile's own
// file (atomic, 0600) — the project servers watch `hubs.json` and drop the link's sync themselves.
// Home serves every profile, so it never reads its own process-global path for a non-default one.

import { existsSync, unlinkSync } from 'node:fs';

import { deleteHubCredential } from '../sync/hub-link.ts';
import { loadHubsConfig, normalizeUrl, safeAccount } from '../sync/hubs-config.ts';
import { profileCloudPath, profileHubsPath } from './cloud.ts';
import type { HomeAnswer } from './signin.ts';

const MAX_PROFILES = 16;
const MAX_HUBS = 50;

export interface ProfileHubs {
  id: string;
  hubs: Array<{ url: string; account: string | null }>;
}

/** Each named profile's team-server sign-ins (no tokens). Unknown / invalid ids are skipped. */
export function profileAccounts(ids: string[]): ProfileHubs[] {
  const out: ProfileHubs[] = [];
  for (const id of [...new Set(ids)].slice(0, MAX_PROFILES)) {
    const file = profileHubsPath(id);
    if (!file) continue;
    let hubs: ProfileHubs['hubs'] = [];
    try {
      const cfg = loadHubsConfig(file);
      hubs = Object.entries(cfg.hubs ?? {})
        .filter(([, rec]) => rec && typeof rec.token === 'string' && rec.token)
        .slice(0, MAX_HUBS)
        .map(([url, rec]) => ({ url, account: safeAccount(rec.account) }));
    } catch {
      hubs = [];
    }
    out.push({ id, hubs });
  }
  return out;
}

const bad = (error: string): HomeAnswer => ({ status: 400, body: { ok: false, error } });

export function createHomeAccounts(deps: { forgetCloud?: (profile: string) => void } = {}) {
  return {
    list(param: string | null): HomeAnswer {
      const ids = (param ?? '').split(',').filter(Boolean);
      return { status: 200, body: { ok: true, profiles: profileAccounts(ids) } };
    },

    hubSignOut(b: Record<string, unknown>): HomeAnswer {
      const profile = typeof b.profile === 'string' ? b.profile : '';
      const file = profileHubsPath(profile);
      if (!file) return bad('That account isn’t on this Mac.');
      let url: string;
      try {
        url = normalizeUrl(String(b.url ?? ''));
      } catch {
        return bad('That server address isn’t valid.');
      }
      deleteHubCredential(url, file);
      return { status: 200, body: { ok: true } };
    },

    cloudSignOut(b: Record<string, unknown>): HomeAnswer {
      const profile = typeof b.profile === 'string' ? b.profile : '';
      const file = profileCloudPath(profile);
      if (!file) return bad('That account isn’t on this Mac.');
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        return { status: 500, body: { ok: false, error: 'Couldn’t sign out. Try again.' } };
      }
      deps.forgetCloud?.(profile);
      return { status: 200, body: { ok: true } };
    },
  };
}
