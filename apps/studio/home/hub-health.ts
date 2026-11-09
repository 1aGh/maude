// home/hub-health.ts — 2.1.1 B4: is a saved team-server sign-in still accepted, or does the server not
// answer at all? Home's accounts row and every project row's connection badge read this.
//
//   ok           the server took the token
//   rejected     the server answered 401: the sign-in stopped working (the person signs in again)
//   unreachable  no answer, or a 5xx: the server's side, not the person's
//   unknown      the question could not be asked (an address that may not carry a token, an old server
//                without the route, a refusal that says nothing about the token) — never drawn as broken
//
// One authenticated `GET /api/documents` per server — the listing the sync client itself uses, so it
// answers exactly what sync would. Cheap by construction: a result is kept per (address, token) for
// `ttlMs`, and concurrent asks for the same pair share one request. The token goes only to the address
// it was saved against (https, or http on loopback), with no redirect followed and no ambient
// credentials, and is never part of any answer.

import { createHash } from 'node:crypto';

import { hubAddress } from './hub.ts';

export type HubState = 'ok' | 'rejected' | 'unreachable' | 'unknown';

export interface HubHealth {
  state(url: string, token: string): Promise<HubState>;
}

const TTL_MS = 60_000;
const TIMEOUT_MS = 4000;
const MAX_ENTRIES = 200;

export function createHubHealth(
  opts: { fetchImpl?: typeof fetch; now?: () => number; ttlMs?: number } = {}
): HubHealth {
  const doFetch = opts.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = opts.now ?? Date.now;
  const ttl = opts.ttlMs ?? TTL_MS;
  const done = new Map<string, { at: number; value: HubState }>();
  const flying = new Map<string, Promise<HubState>>();

  async function ask(base: string, token: string): Promise<HubState> {
    try {
      const res = await doFetch(`${base}/api/documents`, {
        method: 'GET',
        headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: 'error',
        credentials: 'omit',
      });
      if (res.status === 200) return 'ok';
      if (res.status === 401) return 'rejected';
      if (res.status >= 500) return 'unreachable';
      return 'unknown';
    } catch {
      return 'unreachable';
    }
  }

  return {
    async state(url, token) {
      const a = hubAddress(url);
      if (!a.ok || !token) return 'unknown';
      const key = createHash('sha256').update(`${a.url}\n${token}`).digest('hex');
      const hit = done.get(key);
      if (hit && now() - hit.at < ttl) return hit.value;
      const live = flying.get(key);
      if (live) return live;
      const p = ask(a.url, token).then((value) => {
        flying.delete(key);
        if (done.size >= MAX_ENTRIES) done.delete(done.keys().next().value as string);
        done.set(key, { at: now(), value });
        return value;
      });
      flying.set(key, p);
      return p;
    },
  };
}
