// fix/207 — the in-app answer to "may this hub deliver shared code (.ts/.js) to this Mac?".
//
// On Michal's desktop the StudyFi file plane held 1 783 rows "shared code not accepted on this Mac"
// and the only place to change the answer was the terminal's `maude design link` — which never asked
// again once a `false` was recorded. These pin the route that replaces it: it writes the PROFILE's
// hubs.json (never ~/.config/maude), only from the Maude window, only for a signed-in member of the
// hub the runtime dials, never from a canvas; revoke records `false`, and a recorded `false` wins
// over the Maude Cloud auto-accept.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { legacyClaim, resolveAccess } from '../access/scope.ts';
import { CANVAS_SAFE_API, guardTableRoute } from '../http.ts';
import { allSpecs } from '../routes/index.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import type { RouteSpec } from '../routes/table.ts';
import { createCodeConsentControl } from '../sync/code-module-consent.ts';
import { hubsConfigPath } from '../sync/hubs-config.ts';
import { stubDeps } from './_route-stubs.ts';

const HUB = 'https://studyfi.cloud.maude.sh';
const SET = '/_api/sync/code-consent/set';
const GET = '/_api/sync/code-consent';
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

const tmp = mkdtempSync(join(tmpdir(), 'code-consent-route-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

/** The profile's file — what the shell names in HUBS_CONFIG_PATH for a non-default profile. */
const profileFile = join(tmp, 'xdg', 'maude', 'profiles', 'work', 'hubs.json');
const defaultFile = join(tmp, 'xdg', 'maude', 'hubs.json');

function writeHubs(file: string, hubs: Record<string, unknown>) {
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, `${JSON.stringify({ hubs, trusted: Object.keys(hubs) }, null, 2)}\n`, {
    mode: 0o600,
  });
}
const readHubs = (file: string) => JSON.parse(readFileSync(file, 'utf8'));

async function withEnv(
  env: Record<string, string | undefined>,
  fn: () => Promise<void> | void
): Promise<void> {
  const prev: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    prev[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(prev)) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

let pulls = 0;
function harness(
  o: { role?: string; cell?: boolean; runtime?: boolean; env?: Record<string, string> } = {}
) {
  const consent = createCodeConsentControl({
    cellPairing: o.cell === true,
    hubUrl: HUB,
    env: o.env ?? {},
  });
  const runtime = {
    codeConsent: () => consent,
    pullRemoteNow: async () => {
      pulls += 1;
    },
  };
  const specs = createSyncRoutes({
    control: () => ({
      restart: async () => ({ syncing: false }),
      current: () => (o.runtime === false ? null : runtime),
    }),
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(legacyClaim(o.role ?? 'member')),
  }).map(guardTableRoute);
  const find = (method: string, path: string): RouteSpec => {
    const s = specs.find((x) => x.method === method && x.path === path);
    if (!s) throw new Error(`no ${method} ${path}`);
    return s;
  };
  const post = (body: unknown, headers: Record<string, string> = FROM_WINDOW) =>
    find('POST', SET).handle(
      new Request(`http://127.0.0.1:4399${SET}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', host: '127.0.0.1:4399', ...headers },
        body: JSON.stringify(body),
      }),
      {}
    );
  const get = () =>
    find('GET', GET).handle(
      new Request(`http://127.0.0.1:4399${GET}`, { headers: { host: '127.0.0.1:4399' } }),
      {}
    );
  return { consent, post, get };
}

beforeEach(() => {
  pulls = 0;
  rmSync(join(tmp, 'xdg'), { recursive: true, force: true });
  writeHubs(profileFile, { [HUB]: { token: 'tok', role: 'member', codeModulesAllowed: false } });
  writeHubs(defaultFile, { [HUB]: { token: 'other', role: 'member' } });
});

const PROFILE_ENV = { HUBS_CONFIG_PATH: profileFile, MAUDE_PROFILE_ID: 'work' };

describe('the answer is written to the profile’s hubs.json', () => {
  test('Allow records true in the PROFILE file, keeps every other field, and starts a pass', async () => {
    await withEnv(PROFILE_ENV, async () => {
      const h = harness();
      expect(h.consent.allowed()).toBe(false);
      const r = await h.post({ allow: true });
      expect(r.status).toBe(200);
      const body = await r.json();
      expect(body.consent).toMatchObject({
        host: 'studyfi.cloud.maude.sh',
        allowed: true,
        how: 'recorded',
        recorded: true,
      });
      const rec = readHubs(profileFile).hubs[HUB];
      expect(rec).toEqual({ token: 'tok', role: 'member', codeModulesAllowed: true });
      expect(readHubs(profileFile).trusted).toEqual([HUB]);
      // the default profile's file is not touched
      expect(readHubs(defaultFile).hubs[HUB].codeModulesAllowed).toBeUndefined();
      // live: the file plane's gate reads the new answer, and a pass starts now
      expect(h.consent.allowed()).toBe(true);
      expect(pulls).toBe(1);
    });
  });

  test('the profile id alone names the file (no HUBS_CONFIG_PATH): profiles/<id>/hubs.json', async () => {
    await withEnv(
      { HUBS_CONFIG_PATH: undefined, MAUDE_PROFILE_ID: 'work', XDG_CONFIG_HOME: join(tmp, 'xdg') },
      async () => {
        expect(hubsConfigPath()).toBe(profileFile);
        const r = await harness().post({ allow: true });
        expect(r.status).toBe(200);
        expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(true);
        expect(readHubs(defaultFile).hubs[HUB].codeModulesAllowed).toBeUndefined();
      }
    );
  });

  test('Stop allowing records false — and a recorded no beats the Maude Cloud auto-accept', async () => {
    await withEnv(PROFILE_ENV, async () => {
      // opened from Home: the cloud auto-accept applies while nothing is recorded
      writeHubs(profileFile, { [HUB]: { token: 'tok', role: 'member' } });
      const h = harness({ env: { MAUDE_APP_BOUND_HUB: HUB } });
      expect(h.consent.view()).toMatchObject({ allowed: true, how: 'cloud', recorded: null });
      const r = await h.post({ allow: false });
      expect(r.status).toBe(200);
      expect((await r.json()).consent).toMatchObject({
        allowed: false,
        how: null,
        recorded: false,
      });
      expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(false);
      expect(h.consent.allowed()).toBe(false);
      expect(pulls).toBe(0); // a revoke moves nothing
    });
  });

  test('GET names the host and the answer — never the token or the account', async () => {
    await withEnv(PROFILE_ENV, async () => {
      const r = await harness().get();
      expect(r.status).toBe(200);
      const text = await r.text();
      expect(JSON.parse(text).consent).toEqual({
        host: 'studyfi.cloud.maude.sh',
        allowed: false,
        how: null,
        recorded: false,
        changeable: true,
      });
      expect(text).not.toContain('tok');
    });
  });
});

describe('who may answer, and from where', () => {
  test('refused without the window’s own fetch (curl, an agent, a navigation) — nothing written', async () => {
    await withEnv(PROFILE_ENV, async () => {
      const h = harness();
      for (const headers of [{}, { 'sec-fetch-site': 'same-site' }, { 'sec-fetch-site': 'none' }]) {
        const r = await h.post({ allow: true }, headers);
        expect(r.status).toBe(403);
        expect((await r.json()).reason).toBe('window-only');
      }
      expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(false);
    });
  });

  test('refused cross-origin (CSRF) and from a canvas origin', async () => {
    await withEnv(PROFILE_ENV, async () => {
      const h = harness();
      for (const origin of ['https://evil.example', 'http://127.0.0.1:4400']) {
        const r = await h.post({ allow: true }, { ...FROM_WINDOW, origin });
        expect(r.status).toBe(403);
        expect((await r.json()).reason).toBe('cross-origin');
      }
      expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(false);
    });
  });

  test('a session that cannot edit (Can view) is refused', async () => {
    await withEnv(PROFILE_ENV, async () => {
      const r = await harness({ role: 'viewer' }).post({ allow: true });
      expect(r.status).toBe(403);
      expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(false);
    });
  });

  test('no signed-in record for the hub → 409, and no record is minted', async () => {
    await withEnv(PROFILE_ENV, async () => {
      writeHubs(profileFile, { 'https://other.example': { token: 't' } });
      const r = await harness().post({ allow: true });
      expect(r.status).toBe(409);
      expect((await r.json()).reason).toBe('not-signed-in');
      expect(readHubs(profileFile).hubs[HUB]).toBeUndefined();
    });
  });

  test('not syncing → 409 not-linked; a cell → 409 cell; a non-boolean answer → 400', async () => {
    await withEnv(PROFILE_ENV, async () => {
      expect((await harness({ runtime: false }).post({ allow: true })).status).toBe(409);
      const cell = await harness({ cell: true }).post({ allow: false });
      expect(cell.status).toBe(409);
      expect((await cell.json()).reason).toBe('cell');
      expect((await harness().post({ allow: 'yes' })).status).toBe(400);
      expect(readHubs(profileFile).hubs[HUB].codeModulesAllowed).toBe(false);
    });
  });

  test('main origin only: never canvas-safe (canvas-origin-parity holds the canvas map)', () => {
    for (const path of [GET, SET]) {
      expect(CANVAS_SAFE_API.has(path)).toBe(false);
      const spec = allSpecs(stubDeps()).find((s) => s.path === path);
      expect(spec?.origin).toBe('main');
    }
  });
});
