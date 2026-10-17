// Silent hub-credential renewal (cloud/renew.ts) — the lane that keeps a
// cloud link alive past the 12 h cell-session cap without a person pressing
// Connect again. Every network hop is injected; nothing here talks to a real
// host.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renewHubCredential } from '../cloud/renew.ts';

const HUB_URL = 'https://alligators.cloud.test';

let dir: string;
let envBackup: Record<string, string | undefined>;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'maude-renew-'));
  envBackup = {
    MAUDE_CLOUD_CONFIG: process.env.MAUDE_CLOUD_CONFIG,
    HUBS_CONFIG_PATH: process.env.HUBS_CONFIG_PATH,
    MAUDE_CLOUD_URL: process.env.MAUDE_CLOUD_URL,
  };
  process.env.MAUDE_CLOUD_CONFIG = join(dir, 'cloud.json');
  process.env.HUBS_CONFIG_PATH = join(dir, 'hubs.json');
  process.env.MAUDE_CLOUD_URL = 'https://cloud.test';
});

afterEach(() => {
  for (const [k, v] of Object.entries(envBackup)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

function signIn(token = 'mpt_account'): void {
  writeFileSync(
    join(dir, 'cloud.json'),
    JSON.stringify({ url: 'https://cloud.test', token, connectedAt: 1 })
  );
}

function writeHubRecord(record: Record<string, unknown>): void {
  writeFileSync(join(dir, 'hubs.json'), JSON.stringify({ hubs: { [HUB_URL]: record } }));
}

function readHubRecord(): Record<string, unknown> | undefined {
  try {
    return JSON.parse(readFileSync(join(dir, 'hubs.json'), 'utf8')).hubs[HUB_URL];
  } catch {
    return undefined;
  }
}

/** Route-keyed fetch stub; records every URL it was asked for. */
function fakeFetch(routes: Record<string, { status: number; body: unknown }>) {
  const calls: string[] = [];
  const doFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    for (const [prefix, r] of Object.entries(routes)) {
      if (url.startsWith(prefix)) {
        return new Response(JSON.stringify(r.body), { status: r.status });
      }
    }
    return new Response('{}', { status: 404 });
  }) as typeof fetch;
  return { doFetch, calls };
}

const HAPPY_ROUTES = {
  'https://cloud.test/api/projects': {
    status: 200,
    body: { projects: [{ id: 'alligators', url: HUB_URL, role: 'owner' }] },
  },
  'https://cloud.test/projects/open': {
    status: 200,
    body: { token: 'proj_tok', url: HUB_URL, role: 'owner', expiresAt: 111 },
  },
  [`${HUB_URL}/auth/login`]: {
    status: 200,
    body: { token: 'mau_new', expiresAt: 12345, user: { email: 'm@x.cz', role: 'member' } },
  },
};

describe('renewHubCredential', () => {
  test('signed out → not-signed-in, and no network is touched', async () => {
    const { doFetch, calls } = fakeFetch(HAPPY_ROUTES);
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'not-signed-in' });
    expect(calls).toHaveLength(0);
  });

  // V2-3.10 W4 — the account token goes only to the control plane recorded in cloud.json.
  test('a cloud.json issued by another control plane → not-signed-in, no network', async () => {
    writeFileSync(
      join(dir, 'cloud.json'),
      JSON.stringify({ url: 'https://other-plane.test', token: 'mpt_account', connectedAt: 1 })
    );
    const { doFetch, calls } = fakeFetch(HAPPY_ROUTES);
    expect(await renewHubCredential(HUB_URL, doFetch)).toEqual({
      ok: false,
      reason: 'not-signed-in',
    });
    expect(calls).toHaveLength(0);
  });

  test('happy path: projects → open → cell login → hubs.json updated, role preserved', async () => {
    signIn();
    writeHubRecord({ token: 'mau_stale', linkedAt: 1, role: 'member', expiresAt: 2 });
    const { doFetch, calls } = fakeFetch(HAPPY_ROUTES);

    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: true, token: 'mau_new', expiresAt: 12345 });

    const stored = readHubRecord();
    expect(stored?.token).toBe('mau_new');
    expect(stored?.expiresAt).toBe(12345);
    // The upsert replaces the record — the vouched role must survive renewal.
    expect(stored?.role).toBe('member');

    // The cell login went to the STORED hub address, not anything the cloud named.
    expect(calls[2]).toBe(`${HUB_URL}/auth/login`);
  });

  test('F5: the FRESH role from the cell login wins over the stale stored one', async () => {
    signIn();
    writeHubRecord({ token: 'mau_stale', linkedAt: 1, role: 'member' });
    const { doFetch } = fakeFetch({
      ...HAPPY_ROUTES,
      [`${HUB_URL}/auth/login`]: {
        status: 200,
        body: { token: 'mau_new', expiresAt: 12345, user: { email: 'm@x.cz', role: 'owner' } },
      },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r.ok).toBe(true);
    expect(readHubRecord()?.role).toBe('owner'); // not the stale 'member'
  });

  test('F5: an older cell that omits the role falls back to the stored one', async () => {
    signIn();
    writeHubRecord({ token: 'mau_stale', linkedAt: 1, role: 'member' });
    const { doFetch } = fakeFetch({
      ...HAPPY_ROUTES,
      [`${HUB_URL}/auth/login`]: { status: 200, body: { token: 'mau_new', expiresAt: 12345 } },
    });
    await renewHubCredential(HUB_URL, doFetch);
    expect(readHubRecord()?.role).toBe('member');
  });

  test('claim-a: an embedded-credential hubUrl is refused, no network touched', async () => {
    signIn();
    const { doFetch, calls } = fakeFetch(HAPPY_ROUTES);
    const r = await renewHubCredential('https://evil@alligators.cloud.test', doFetch);
    expect(r).toEqual({ ok: false, reason: 'no-matching-project' });
    expect(calls).toHaveLength(0);
  });

  test('account token revoked (401 on projects) → account-revoked, store untouched', async () => {
    signIn();
    writeHubRecord({ token: 'mau_stale', linkedAt: 1 });
    const { doFetch } = fakeFetch({
      'https://cloud.test/api/projects': { status: 401, body: {} },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'account-revoked' });
    expect(readHubRecord()?.token).toBe('mau_stale');
  });

  test('hub not among the account projects → no-matching-project', async () => {
    signIn();
    const { doFetch } = fakeFetch({
      'https://cloud.test/api/projects': {
        status: 200,
        body: { projects: [{ id: 'other', url: 'https://other.cloud.test', role: 'owner' }] },
      },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'no-matching-project' });
  });

  test('a viewer role never renews an editor credential', async () => {
    signIn();
    const { doFetch } = fakeFetch({
      'https://cloud.test/api/projects': {
        status: 200,
        body: { projects: [{ id: 'alligators', url: HUB_URL, role: 'viewer' }] },
      },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'no-matching-project' });
  });

  test('an unknown or read-only role (observer, guest, Viewer) never renews an editor credential', async () => {
    // V2-4 gate: the `=== 'viewer'` comparison failed open for every other non-editing role (V2-1.7 R1).
    for (const role of ['observer', 'guest', 'Viewer', 'commenter']) {
      signIn();
      const { doFetch } = fakeFetch({
        'https://cloud.test/api/projects': {
          status: 200,
          body: { projects: [{ id: 'alligators', url: HUB_URL, role }] },
        },
      });
      const r = await renewHubCredential(HUB_URL, doFetch);
      expect(r, role).toEqual({ ok: false, reason: 'no-matching-project' });
    }
  });

  test('removed member: /projects/open refuses → open-refused (the right place to die)', async () => {
    signIn();
    const { doFetch } = fakeFetch({
      'https://cloud.test/api/projects': HAPPY_ROUTES['https://cloud.test/api/projects'],
      'https://cloud.test/projects/open': { status: 404, body: {} },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'open-refused' });
  });

  test('cell refuses the exchange → cell-refused, store untouched', async () => {
    signIn();
    writeHubRecord({ token: 'mau_stale', linkedAt: 1 });
    const { doFetch } = fakeFetch({
      'https://cloud.test/api/projects': HAPPY_ROUTES['https://cloud.test/api/projects'],
      'https://cloud.test/projects/open': HAPPY_ROUTES['https://cloud.test/projects/open'],
      [`${HUB_URL}/auth/login`]: { status: 401, body: {} },
    });
    const r = await renewHubCredential(HUB_URL, doFetch);
    expect(r).toEqual({ ok: false, reason: 'cell-refused' });
    expect(readHubRecord()?.token).toBe('mau_stale');
  });
});
