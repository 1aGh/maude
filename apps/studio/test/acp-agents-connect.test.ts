// F7 (plan B5 auth half + B6 server half) — connect another agent: the per-profile state store, the
// per-agent sign-in, and the /_api/agents routes. Fake descriptors point at tmp shell scripts that
// stand in for a vendor CLI's `status` / `login`; nothing here signs in anywhere or reads a real
// credential store. Contract: .ai/plans/notes/universal-acp-contract.md · DDR-252.

import { afterAll, beforeEach, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  agentAuthStatus,
  agentSigninState,
  cancelAgentSignin,
  resetAgentSignins,
  startAgentSignin,
} from '../acp/agents/auth.ts';
import { CLAUDE, CODEX } from '../acp/agents/catalog.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';
import type { DiscoveredAgent } from '../acp/agents/discover.ts';
import { agentStateDir, agentStatePath, createAgentStateStore } from '../acp/agents/state.ts';
import { credentialPathsFor } from '../acp/may-scope.ts';
import { guardTableRoute } from '../http.ts';
import { type AgentsRouteDeps, createAgentsRoutes } from '../routes/agents.ts';
import type { RouteSpec } from '../routes/table.ts';

const root = mkdtempSync(join(tmpdir(), 'acp-agents-connect-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

// ---------------------------------------------------------------- fixtures

const SIGNED = join(root, 'signed');
const FAKE = join(root, 'fake-agent');
writeFileSync(
  FAKE,
  `#!/bin/sh
case "$1" in
  status)
    if [ -f "${SIGNED}" ]; then echo "Logged in using a test account"; exit 0; fi
    echo "Not logged in"; exit 1 ;;
  json-out) echo '{"loggedIn":false}'; exit 0 ;;
  crash) exit 7 ;;
  hang) sleep 10 ;;
  login-slow) sleep 30 ;;
  login) sleep 0.3; touch "${SIGNED}"; exit 0 ;;
esac
exit 2
`
);
chmodSync(FAKE, 0o755);

const base: AgentDescriptor = {
  ...CODEX,
  id: 'custom:fakecode',
  label: 'Fakecode',
  policy: 'bridge-enforced',
  auth: { gate: 'session-new', statusArgs: ['status'], loginArgs: ['login'] },
};
const risky: AgentDescriptor = {
  ...base,
  id: 'custom:risky',
  label: 'Risky',
  policy: 'unrestricted',
};
const open: AgentDescriptor = {
  ...base,
  id: 'custom:open',
  label: 'Open',
  auth: { gate: 'none', loginArgs: ['login'] },
  connectNote: 'Prompts go to a hosted model.',
};
const slow: AgentDescriptor = {
  ...base,
  id: 'custom:slow',
  auth: { ...base.auth, loginArgs: ['login-slow'] },
};
const CATALOG_UNDER_TEST: AgentDescriptor[] = [CLAUDE, base, risky, open, slow];

function row(d: AgentDescriptor, over: Partial<DiscoveredAgent> = {}): DiscoveredAgent {
  const offerable = d.policy === 'bridge-enforced' && d.id !== 'claude';
  return {
    id: d.id,
    label: d.label,
    vendor: d.vendor,
    installed: true,
    realBin: FAKE,
    version: '1.0.0',
    fit: 'ok',
    policy: d.policy,
    offerable,
    ...over,
  };
}

let rows: DiscoveredAgent[];
let store = createAgentStateStore(join(root, 'cfg0', 'agents.json'));
let n = 0;
const claudeFake = {
  available: async () => ({ available: true }),
  authLoggedIn: async () => true as boolean | null,
  startSignin: () => ({ ok: true }),
  cancelSignin: () => {},
  signinInFlight: () => false,
};

function routes(over: AgentsRouteDeps = {}): RouteSpec[] {
  return createAgentsRoutes({
    discover: async () => rows,
    catalog: CATALOG_UNDER_TEST,
    store,
    conformance: async () => ({ pass: true }),
    claude: claudeFake,
    ...over,
  });
}

async function call(
  specs: RouteSpec[],
  method: 'GET' | 'POST',
  path: string,
  body?: unknown
): Promise<{ status: number; body: any }> {
  const url = `http://localhost:4399${path}`;
  const req = new Request(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pathname = new URL(url).pathname;
  const spec = specs.find(
    (s) =>
      s.method === method &&
      new RegExp(`^${s.path.replace(/:[A-Za-z_]+/g, '([^/]+)')}$`).test(pathname)
  );
  if (!spec) throw new Error(`no route ${method} ${path}`);
  const names = [...spec.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1] as string);
  const vals = new RegExp(`^${spec.path.replace(/:[A-Za-z_]+/g, '([^/]+)')}$`)
    .exec(pathname)!
    .slice(1)
    .map(decodeURIComponent);
  const params = Object.fromEntries(names.map((k, i) => [k, vals[i] as string]));
  const res = await spec.handle(req, params);
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  resetAgentSignins();
  rmSync(SIGNED, { force: true });
  store = createAgentStateStore(join(root, `cfg${++n}`, 'agents.json'));
  rows = [
    row(CLAUDE, { offerable: false }),
    row(base),
    row(risky),
    row(open),
    row(slow, { offerable: false }),
  ];
});

// ---------------------------------------------------------------- auth status

describe('agentAuthStatus', () => {
  test('signed out → signed-out; after sign-in → signed-in (the real exit codes of `codex login status`)', async () => {
    expect(await agentAuthStatus(base, FAKE)).toBe('signed-out');
    writeFileSync(SIGNED, '');
    expect(await agentAuthStatus(base, FAKE)).toBe('signed-in');
  });

  test('gate none → not-needed; no status command → unknown; no binary → unknown', async () => {
    expect(await agentAuthStatus(open, FAKE)).toBe('not-needed');
    expect(await agentAuthStatus({ ...base, auth: { gate: 'session-new' } }, FAKE)).toBe('unknown');
    expect(await agentAuthStatus(base, join(root, 'does-not-exist'))).toBe('unknown');
  });

  test('an exit code that is neither 0 nor 1, and a hang, are unknown, not a claim', async () => {
    expect(
      await agentAuthStatus({ ...base, auth: { ...base.auth, statusArgs: ['crash'] } }, FAKE)
    ).toBe('unknown');
    const t0 = Date.now();
    expect(
      await agentAuthStatus({ ...base, auth: { ...base.auth, statusArgs: ['hang'] } }, FAKE, {
        timeoutMs: 300,
      })
    ).toBe('unknown');
    expect(Date.now() - t0).toBeLessThan(3000);
  });

  test('a JSON document with a boolean loggedIn outranks the exit code (Claude shape)', async () => {
    expect(
      await agentAuthStatus({ ...base, auth: { ...base.auth, statusArgs: ['json-out'] } }, FAKE)
    ).toBe('signed-out');
  });
});

// ---------------------------------------------------------------- sign-in child

describe('startAgentSignin / poll / cancel', () => {
  test('start runs the vendor login; the poll sees it finish and the status flips', async () => {
    expect(startAgentSignin(base, FAKE)).toEqual({ ok: true });
    expect(agentSigninState(base.id).inFlight).toBe(true);
    for (let i = 0; i < 40 && agentSigninState(base.id).inFlight; i++) await Bun.sleep(100);
    expect(agentSigninState(base.id)).toMatchObject({ inFlight: false, lastExit: 0 });
    expect(await agentAuthStatus(base, FAKE)).toBe('signed-in');
  });

  test('one at a time per agent; another agent is independent; cancel kills the child', async () => {
    expect(startAgentSignin(slow, FAKE)).toEqual({ ok: true });
    expect(startAgentSignin(slow, FAKE)).toEqual({ ok: false, reason: 'in-progress' });
    expect(startAgentSignin(base, FAKE)).toEqual({ ok: true });
    cancelAgentSignin(slow.id);
    expect(agentSigninState(slow.id).inFlight).toBe(false);
    expect(startAgentSignin(slow, FAKE)).toEqual({ ok: true }); // free again
    cancelAgentSignin(slow.id);
  });

  test('an agent with no login command cannot start one', () => {
    expect(startAgentSignin({ ...base, auth: { gate: 'session-new' } }, FAKE)).toEqual({
      ok: false,
      reason: 'no-signin',
    });
  });
});

// ---------------------------------------------------------------- the store

describe('agent state store', () => {
  test('the file is 0600 in a 0700 folder, atomic, and survives a reload', () => {
    const dir = join(root, 'fresh-profile');
    const s = createAgentStateStore(join(dir, 'agents.json'));
    s.markConnected('custom:fakecode', '1.2.3', 123);
    s.dismissOffer('opencode');
    expect(statSync(s.path).mode & 0o777).toBe(0o600);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(readdirSync(dir)).toEqual(['agents.json']); // no temp file left behind
    const again = createAgentStateStore(s.path).read();
    expect(again.connected['custom:fakecode']).toEqual({ at: 123, version: '1.2.3' });
    expect(again.offerDismissed).toEqual({ opencode: true });
    s.disconnect('custom:fakecode');
    expect(createAgentStateStore(s.path).read().connected).toEqual({});
  });

  test('a corrupt or hand-edited file reads as nothing connected', () => {
    const p = join(root, 'corrupt', 'agents.json');
    mkdirSync(join(root, 'corrupt'), { recursive: true });
    writeFileSync(p, '{not json');
    expect(createAgentStateStore(p).read()).toEqual({ connected: {}, offerDismissed: {} });
    writeFileSync(
      p,
      JSON.stringify({ connected: { 'bad id!': { at: 1 }, codex: { at: 'x' }, ok: { at: 5 } } })
    );
    expect(Object.keys(createAgentStateStore(p).read().connected)).toEqual(['ok']);
  });

  test('it lives in the profile folder the chat agent cannot read, never in a project', () => {
    const home = join(root, 'home');
    for (const env of [
      { HOME: home },
      { HOME: home, MAUDE_PROFILE_ID: 'work' },
      { HOME: home, XDG_CONFIG_HOME: join(root, 'xdg'), MAUDE_PROFILE_ID: 'work' },
      // a pointer into a folder the deny rules do not cover must not move the file there
      { HOME: home, MAUDE_CLOUD_CONFIG: join(root, 'elsewhere', 'cloud.json') },
    ]) {
      const p = agentStatePath(env, home);
      const denied = credentialPathsFor(env, home).dirs;
      expect(denied.some((d) => p.startsWith(`${d}/`))).toBe(true);
      expect(p.startsWith(join(root, 'elsewhere'))).toBe(false);
    }
    expect(agentStateDir({ HOME: home, MAUDE_PROFILE_ID: 'work' }, home)).toBe(
      join(home, '.config', 'maude', 'profiles', 'work')
    );
    // a profile id that is not [a-z0-9-] does not climb out of profiles/
    expect(agentStateDir({ HOME: home, MAUDE_PROFILE_ID: '../x' }, home)).toBe(
      join(home, '.config', 'maude')
    );
    expect(agentStatePath({ HOME: home }, home).startsWith(process.cwd())).toBe(false);
  });
});

// ---------------------------------------------------------------- GET /_api/agents

describe('GET /_api/agents', () => {
  test('the shape: per-row connect state, auth, health, connectNote, and one shared offer list', async () => {
    writeFileSync(SIGNED, '');
    const { status, body } = await call(routes(), 'GET', '/_api/agents');
    expect(status).toBe(200);
    const fake = body.agents.find((a: any) => a.id === 'custom:fakecode');
    expect(fake).toMatchObject({
      installed: true,
      version: '1.0.0',
      fit: 'ok',
      policy: 'bridge-enforced',
      offerable: true,
      connected: false,
      connectedAt: null,
      auth: 'signed-in',
      offerDismissed: false,
      offer: true,
      health: 'ok',
      connectNote: null,
      state: 'available',
    });
    const o = body.agents.find((a: any) => a.id === 'custom:open');
    expect(o).toMatchObject({ auth: 'not-needed', connectNote: 'Prompts go to a hosted model.' });
    expect(body.offerAgents).toEqual(['custom:fakecode', 'custom:open']);
  });

  test('never offers Claude, an unrestricted agent or an untested / too-old version', async () => {
    rows = [
      row(CLAUDE, { offerable: true }), // even if a row claimed it
      row(risky, { offerable: true }),
      row(base, { fit: 'untested', offerable: false }),
      row(open, { fit: 'too-old', offerable: false }),
    ];
    const { body } = await call(routes(), 'GET', '/_api/agents');
    expect(body.offerAgents.filter((id: string) => id !== 'custom:risky')).toEqual([]);
    expect(body.agents.find((a: any) => a.id === 'claude').offer).toBe(false);
    expect(body.agents.find((a: any) => a.id === 'custom:fakecode').state).toBe('untested');
    expect(body.agents.find((a: any) => a.id === 'custom:open').state).toBe('unavailable');
  });

  test('only Claude detected → no offer line', async () => {
    rows = [
      row(CLAUDE, { offerable: false }),
      row(base, { installed: false, realBin: null, version: null, fit: null, offerable: false }),
    ];
    const { body } = await call(routes(), 'GET', '/_api/agents');
    expect(body.offerAgents).toEqual([]);
    expect(body.agents.find((a: any) => a.id === 'custom:fakecode').state).toBe('unavailable');
  });

  test('a signed-out agent reads state sign-in; connected + dismissed leave the offer list', async () => {
    let r = await call(routes(), 'GET', '/_api/agents');
    expect(r.body.agents.find((a: any) => a.id === 'custom:fakecode')).toMatchObject({
      auth: 'signed-out',
      state: 'sign-in',
    });
    writeFileSync(SIGNED, '');
    store.markConnected('custom:fakecode', '1.0.0', 99);
    store.dismissOffer('custom:open');
    r = await call(routes(), 'GET', '/_api/agents');
    expect(r.body.offerAgents).toEqual([]);
    expect(r.body.agents.find((a: any) => a.id === 'custom:fakecode')).toMatchObject({
      connected: true,
      connectedAt: 99,
      state: 'connected',
      offer: false,
    });
  });

  test('Claude is reported from the readiness probe the chat panel uses', async () => {
    const get = (c: AgentsRouteDeps['claude']) =>
      call(routes({ claude: c }), 'GET', '/_api/agents');
    let r = await get(claudeFake);
    expect(r.body.agents[0]).toMatchObject({
      id: 'claude',
      connected: true,
      auth: 'signed-in',
      state: 'connected',
    });
    r = await get({
      ...claudeFake,
      available: async () => ({ available: false }),
      authLoggedIn: async () => false,
    });
    expect(r.body.agents[0]).toMatchObject({
      connected: false,
      auth: 'signed-out',
      state: 'sign-in',
    });
    r = await get({
      ...claudeFake,
      available: async () => ({ available: false }),
      authLoggedIn: async () => null,
    });
    expect(r.body.agents[0]).toMatchObject({ connected: false, auth: 'unknown' });
  });

  test('this module adds nothing under /_api/claude (Claude keeps its own routes)', () => {
    expect(routes().filter((s) => s.path.startsWith('/_api/claude'))).toEqual([]);
  });
});

// ---------------------------------------------------------------- connect

describe('POST /_api/agents/:id/connect', () => {
  test('signed out → needsSignin and nothing is recorded; after sign-in it connects', async () => {
    let r = await call(routes(), 'POST', '/_api/agents/custom:fakecode/connect', {});
    expect(r.body).toEqual({ ok: false, needsSignin: true });
    expect(store.read().connected).toEqual({});
    writeFileSync(SIGNED, '');
    r = await call(routes(), 'POST', '/_api/agents/custom:fakecode/connect', {});
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, connected: true, version: '1.0.0' });
    expect(store.read().connected['custom:fakecode']?.version).toBe('1.0.0');
  });

  test('gate none connects without a sign-in', async () => {
    const r = await call(routes(), 'POST', '/_api/agents/custom:open/connect', {});
    expect(r.body.ok).toBe(true);
  });

  test('the conformance probe decides: a fail (or a throw) records nothing', async () => {
    writeFileSync(SIGNED, '');
    let r = await call(
      routes({
        conformance: async () => ({ pass: false, detail: 'allowed a read outside the project' }),
      }),
      'POST',
      '/_api/agents/custom:fakecode/connect',
      {}
    );
    expect(r.body).toEqual({
      ok: false,
      reason: 'conformance-failed',
      detail: 'allowed a read outside the project',
    });
    r = await call(
      routes({
        conformance: async () => {
          throw new Error('boom');
        },
      }),
      'POST',
      '/_api/agents/custom:fakecode/connect',
      {}
    );
    expect(r.body).toMatchObject({ ok: false, reason: 'conformance-failed' });
    expect(store.read().connected).toEqual({});
  });

  test('the default conformance passes a bridge-enforced agent and fails anything else', async () => {
    writeFileSync(SIGNED, '');
    const specs = createAgentsRoutes({
      discover: async () => rows,
      catalog: CATALOG_UNDER_TEST,
      store,
      claude: claudeFake,
    });
    expect((await call(specs, 'POST', '/_api/agents/custom:fakecode/connect', {})).body.ok).toBe(
      true
    );
    const r = await call(specs, 'POST', '/_api/agents/custom:risky/connect', { consent: true });
    expect(r.body).toMatchObject({ ok: false, reason: 'conformance-failed' });
  });

  test('an unrestricted agent is refused without consent, and only with consent: true', async () => {
    writeFileSync(SIGNED, '');
    for (const body of [{}, { consent: 'yes' }, { consent: 1 }]) {
      const r = await call(routes(), 'POST', '/_api/agents/custom:risky/connect', body);
      expect(r).toMatchObject({ status: 409, body: { ok: false, reason: 'consent-required' } });
    }
    expect(store.read().connected).toEqual({});
    const r = await call(routes(), 'POST', '/_api/agents/custom:risky/connect', { consent: true });
    expect(r.body.ok).toBe(true);
  });

  test('not installed, too old, untested version, unknown id and Claude are refused', async () => {
    rows = [
      row(CLAUDE, { offerable: false }),
      row(base, { installed: false, realBin: null, version: null, fit: null }),
      row(open, { fit: 'too-old' }),
      row(slow, { fit: 'untested' }),
    ];
    const reason = async (id: string) =>
      (await call(routes(), 'POST', `/_api/agents/${id}/connect`, {})).body.reason;
    expect(await reason('custom:fakecode')).toBe('not-installed');
    expect(await reason('custom:open')).toBe('version-too-old');
    expect(await reason('custom:slow')).toBe('untested-version');
    expect(await reason('claude')).toBe('use-claude-routes');
    expect((await call(routes(), 'POST', '/_api/agents/nope/connect', {})).status).toBe(404);
    expect(store.read().connected).toEqual({});
  });
});

// ---------------------------------------------------------------- sign-in routes, disconnect, dismiss

describe('sign-in, disconnect and dismiss routes', () => {
  test('signin starts the vendor login, signin-status polls it, signin-cancel stops it', async () => {
    const specs = routes();
    let r = await call(specs, 'POST', '/_api/agents/custom:slow/signin');
    expect(r).toMatchObject({ status: 200, body: { ok: true } });
    r = await call(specs, 'POST', '/_api/agents/custom:slow/signin');
    expect(r).toMatchObject({ status: 409, body: { ok: false, reason: 'in-progress' } });
    r = await call(specs, 'GET', '/_api/agents/custom:slow/signin-status');
    expect(r.body).toMatchObject({ auth: 'signed-out', inFlight: true });
    expect(typeof r.body.startedAt).toBe('number');
    r = await call(specs, 'POST', '/_api/agents/custom:slow/signin-cancel');
    expect(r.body).toEqual({ ok: true });
    r = await call(specs, 'GET', '/_api/agents/custom:slow/signin-status');
    expect(r.body).toMatchObject({ inFlight: false });
  });

  test('a finished sign-in reads signed-in on the next poll', async () => {
    const specs = routes();
    await call(specs, 'POST', '/_api/agents/custom:fakecode/signin');
    let r = { body: { inFlight: true } as any };
    for (let i = 0; i < 40 && r.body.inFlight; i++) {
      await Bun.sleep(100);
      r = await call(specs, 'GET', '/_api/agents/custom:fakecode/signin-status');
    }
    expect(r.body).toMatchObject({ auth: 'signed-in', inFlight: false, lastExit: 0 });
  });

  test('signin of an agent that is not installed, or an unknown one, is refused', async () => {
    rows = [row(base, { installed: false, realBin: null, version: null, fit: null })];
    expect((await call(routes(), 'POST', '/_api/agents/custom:fakecode/signin')).body.reason).toBe(
      'not-installed'
    );
    expect((await call(routes(), 'POST', '/_api/agents/nope/signin')).status).toBe(404);
  });

  test('Claude’s sign-in verbs delegate to the functions its own routes call', async () => {
    const seen: string[] = [];
    const specs = routes({
      claude: {
        ...claudeFake,
        startSignin: () => {
          seen.push('start');
          return { ok: true };
        },
        cancelSignin: () => void seen.push('cancel'),
        signinInFlight: () => true,
        authLoggedIn: async () => false,
      },
    });
    expect((await call(specs, 'POST', '/_api/agents/claude/signin')).body).toEqual({ ok: true });
    expect((await call(specs, 'GET', '/_api/agents/claude/signin-status')).body).toMatchObject({
      auth: 'signed-out',
      inFlight: true,
    });
    await call(specs, 'POST', '/_api/agents/claude/signin-cancel');
    expect(seen).toEqual(['start', 'cancel']);
  });

  test('disconnect forgets a connection; dismiss-offer persists across a reload of the store', async () => {
    writeFileSync(SIGNED, '');
    await call(routes(), 'POST', '/_api/agents/custom:fakecode/connect', {});
    expect((await call(routes(), 'POST', '/_api/agents/custom:fakecode/disconnect')).body).toEqual({
      ok: true,
    });
    expect(createAgentStateStore(store.path).read().connected).toEqual({});

    expect((await call(routes(), 'POST', '/_api/agents/custom:open/dismiss-offer')).body).toEqual({
      ok: true,
    });
    const reloaded = createAgentStateStore(store.path);
    expect(reloaded.read().offerDismissed).toEqual({ 'custom:open': true });
    const r = await call(routes({ store: reloaded }), 'GET', '/_api/agents');
    expect(r.body.offerAgents).toEqual(['custom:fakecode']);
    // disconnecting afterwards does not bring the answered offer back
    await call(routes({ store: reloaded }), 'POST', '/_api/agents/custom:open/disconnect');
    expect(
      (await call(routes({ store: reloaded }), 'GET', '/_api/agents')).body.offerAgents
    ).toEqual(['custom:fakecode']);
  });

  test('disconnect / dismiss of Claude or an unknown id change nothing', async () => {
    expect((await call(routes(), 'POST', '/_api/agents/claude/disconnect')).status).toBe(409);
    expect((await call(routes(), 'POST', '/_api/agents/claude/dismiss-offer')).status).toBe(409);
    expect((await call(routes(), 'POST', '/_api/agents/nope/dismiss-offer')).status).toBe(404);
    expect(existsSync(store.path)).toBe(false);
  });
});

// ---------------------------------------------------------------- the table

describe('route table conventions', () => {
  test('every spec is main-origin, every write refused in a read-only session, behind the CSRF guard', async () => {
    const specs = routes();
    expect(specs.every((s) => s.origin === 'main')).toBe(true);
    for (const s of specs.filter((x) => x.method === 'POST')) expect(s.readOnly).toBe('refused');
    // a cross-origin write never reaches the handler
    const guarded = guardTableRoute(specs.find((s) => s.path === '/_api/agents/:id/connect')!);
    const res = await guarded.handle(
      new Request('http://localhost:4399/_api/agents/custom:fakecode/connect', {
        method: 'POST',
        headers: { origin: 'https://evil.example', host: 'localhost:4399' },
      }),
      { id: 'custom:fakecode' }
    );
    expect(res.status).toBe(403);
    expect(store.read().connected).toEqual({});
  });
});
