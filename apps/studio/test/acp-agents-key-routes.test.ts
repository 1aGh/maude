// B7 (DDR-252 § BYOK) — the own-API-key routes on /_api/agents: save / remove, the row fields
// (`acceptsKey`, `keySet`, `keyLast4`, Claude's `billing`), a stored key counting as signed in, the
// Claude opt-in gate, and the key never coming back in an answer or a log line. Fake keys only; the
// store is a throwaway file (MAUDE_GEN_KEYS_PATH).

import { afterAll, afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CATALOG } from '../acp/agents/catalog.ts';
import type { DiscoveredAgent } from '../acp/agents/discover.ts';
import { createAgentStateStore } from '../acp/agents/state.ts';
import { type AgentsRouteDeps, createAgentsRoutes } from '../routes/agents.ts';
import type { RouteSpec } from '../routes/table.ts';

const root = mkdtempSync(join(tmpdir(), 'acp-agents-key-routes-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FAKE_OPENAI = 'sk-test-FAKE-openai-route-1234';
const FAKE_ANTHROPIC = 'sk-ant-test-FAKE-route-9999';

let n = 0;
let keysPath = '';
const savedPath = process.env.MAUDE_GEN_KEYS_PATH;
const logged: string[] = [];
const spies: { mockRestore(): void }[] = [];
beforeEach(() => {
  keysPath = join(root, `k${++n}`, 'keys.json');
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  logged.length = 0;
  for (const m of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    spies.push(
      spyOn(console, m).mockImplementation((...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      })
    );
  }
});
afterEach(() => {
  for (const s of spies.splice(0)) s.mockRestore();
  if (savedPath === undefined) delete process.env.MAUDE_GEN_KEYS_PATH;
  else process.env.MAUDE_GEN_KEYS_PATH = savedPath;
});

const row = (id: string, extra: Partial<DiscoveredAgent> = {}): DiscoveredAgent =>
  ({
    id,
    label: id,
    vendor: id,
    installed: true,
    realBin: `/opt/${id}`,
    version: '1.0.0',
    fit: 'ok',
    policy: 'bridge-enforced',
    offerable: false,
    ...extra,
  }) as DiscoveredAgent;

function routes(deps: Partial<AgentsRouteDeps> = {}): RouteSpec[] {
  return createAgentsRoutes({
    discover: async () => [row('claude'), row('codex'), row('opencode'), row('gemini')],
    catalog: CATALOG,
    store: createAgentStateStore(join(root, `state-${n}`)),
    authStatus: async () => 'signed-out',
    health: () => 'ok',
    conformance: async () => ({ pass: true }),
    claude: {
      available: async () => ({ available: false }),
      authLoggedIn: async () => false,
      startSignin: () => ({ ok: true }),
      cancelSignin: () => {},
      signinInFlight: () => false,
    },
    ...deps,
  });
}

async function call(
  specs: RouteSpec[],
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  person = true
): Promise<{ status: number; text: string; body: any }> {
  const url = `http://localhost:4399${path}`;
  const req = new Request(url, {
    method,
    // the studio page sends Origin on a write (personRequest, security review M5); a helper does not
    headers: {
      'content-type': 'application/json',
      ...(person ? { origin: 'http://localhost:4399', host: 'localhost:4399' } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const pathname = new URL(url).pathname;
  const re = (p: string) => new RegExp(`^${p.replace(/:[A-Za-z_]+/g, '([^/]+)')}$`);
  const spec = specs.find((s) => s.method === method && re(s.path).test(pathname));
  if (!spec) throw new Error(`no route ${method} ${path}`);
  const names = [...spec.path.matchAll(/:([A-Za-z_]+)/g)].map((m) => m[1] as string);
  const vals = re(spec.path).exec(pathname)!.slice(1).map(decodeURIComponent);
  const res = await spec.handle(
    req,
    Object.fromEntries(names.map((k, i) => [k, vals[i] as string]))
  );
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) };
}

const agentRow = (body: any, id: string) => body.agents.find((a: any) => a.id === id);

describe('own API key routes', () => {
  test('save → presence + last four only; GET rows reflect it and the agent reads signed in', async () => {
    const specs = routes();
    const before = await call(specs, 'GET', '/_api/agents');
    expect(agentRow(before.body, 'codex')).toMatchObject({
      acceptsKey: true,
      keySet: false,
      keyLast4: null,
      auth: 'signed-out',
      state: 'sign-in',
    });
    expect(agentRow(before.body, 'opencode').acceptsKey).toBe(false);
    expect(agentRow(before.body, 'gemini').acceptsKey).toBe(true);

    const put = await call(specs, 'POST', '/_api/agents/codex/key', { key: FAKE_OPENAI });
    expect(put.status).toBe(200);
    expect(put.body).toEqual({ ok: true, keySet: true, keyLast4: '1234' });
    expect(put.text).not.toContain(FAKE_OPENAI);

    const after = await call(specs, 'GET', '/_api/agents');
    expect(after.text).not.toContain(FAKE_OPENAI);
    expect(agentRow(after.body, 'codex')).toMatchObject({
      keySet: true,
      keyLast4: '1234',
      auth: 'signed-in',
    });
    // a key for Codex is not a key for anyone else
    expect(agentRow(after.body, 'gemini').keySet).toBe(false);
    expect(agentRow(after.body, 'claude').keySet).toBe(false);

    const rm = await call(specs, 'POST', '/_api/agents/codex/key-remove');
    expect(rm.body).toEqual({ ok: true, keySet: false, keyLast4: null });
    expect(readFileSync(keysPath, 'utf8')).not.toContain(FAKE_OPENAI);
    expect(logged.join('\n')).not.toContain(FAKE_OPENAI);
  });

  test('connect skips the sign-in step when a key is stored', async () => {
    const specs = routes();
    const without = await call(specs, 'POST', '/_api/agents/codex/connect', { consent: true });
    expect(without.body).toEqual({ ok: false, needsSignin: true });
    await call(specs, 'POST', '/_api/agents/codex/key', { key: FAKE_OPENAI });
    const withKey = await call(specs, 'POST', '/_api/agents/codex/connect', { consent: true });
    expect(withKey.body.ok).toBe(true);
  });

  test('bad keys, unknown agents and keyless agents are refused', async () => {
    const specs = routes();
    for (const key of ['', 'a\nb', 'x'.repeat(513), 12]) {
      const r = await call(specs, 'POST', '/_api/agents/codex/key', { key });
      expect(r.status).toBe(400);
      expect(r.body.reason).toBe('invalid-key');
    }
    expect((await call(specs, 'POST', '/_api/agents/nope/key', { key: 'k' })).status).toBe(404);
    const oc = await call(specs, 'POST', '/_api/agents/opencode/key', { key: 'k' });
    expect([oc.status, oc.body.reason]).toEqual([409, 'no-api-key']);
    expect((await call(specs, 'POST', '/_api/agents/opencode/key-remove')).status).toBe(409);
  });

  test("Claude's key needs optIn:true; then billing reads api-key from the probe", async () => {
    let optedIn = false;
    const specs = routes({
      claude: {
        available: async () =>
          optedIn ? { available: true, billing: 'api-key' } : { available: false },
        authLoggedIn: async () => false,
        startSignin: () => ({ ok: true }),
        cancelSignin: () => {},
        signinInFlight: () => false,
      },
    });
    const refused = await call(specs, 'POST', '/_api/agents/claude/key', { key: FAKE_ANTHROPIC });
    expect([refused.status, refused.body.reason]).toEqual([409, 'opt-in-required']);
    const truthy = await call(specs, 'POST', '/_api/agents/claude/key', {
      key: FAKE_ANTHROPIC,
      optIn: 'true',
    });
    expect(truthy.status).toBe(409);

    const ok = await call(specs, 'POST', '/_api/agents/claude/key', {
      key: FAKE_ANTHROPIC,
      optIn: true,
    });
    expect(ok.body).toEqual({ ok: true, keySet: true, keyLast4: '9999' });
    expect(ok.text).not.toContain(FAKE_ANTHROPIC);
    optedIn = true;
    const list = await call(specs, 'GET', '/_api/agents');
    expect(agentRow(list.body, 'claude')).toMatchObject({
      keySet: true,
      keyLast4: '9999',
      billing: 'api-key',
      auth: 'signed-in',
      connected: true,
    });
    expect(list.text).not.toContain(FAKE_ANTHROPIC);

    await call(specs, 'POST', '/_api/agents/claude/key-remove');
    optedIn = false;
    const off = await call(specs, 'GET', '/_api/agents');
    expect(agentRow(off.body, 'claude')).toMatchObject({ keySet: false, billing: null });
    expect(logged.join('\n')).not.toContain(FAKE_ANTHROPIC);
  });

  // Security review 2026-11-12 (defender M5): a loopback caller with no browser Origin (a helper,
  // a key holder) is not the person.
  test('key, key-remove, the Claude opt-in and connect are the person’s acts only', async () => {
    const specs = routes();
    for (const [path, body] of [
      ['/_api/agents/codex/key', { key: FAKE_OPENAI }],
      ['/_api/agents/claude/key', { key: FAKE_ANTHROPIC, optIn: true }],
      ['/_api/agents/codex/key-remove', undefined],
      ['/_api/agents/codex/connect', { consent: true }],
    ] as const) {
      const r = await call(specs, 'POST', path, body, false);
      expect({ path, status: r.status, reason: r.body?.reason }).toEqual({
        path,
        status: 403,
        reason: 'person-only',
      });
    }
    const list = await call(specs, 'GET', '/_api/agents');
    expect(agentRow(list.body, 'codex').keySet).toBe(false);
    expect(agentRow(list.body, 'claude').keySet).toBe(false);
  });

  test('both key routes are main-origin writes refused in a read-only session', () => {
    for (const path of ['/_api/agents/:id/key', '/_api/agents/:id/key-remove']) {
      const spec = routes().find((s) => s.path === path)!;
      expect(spec).toMatchObject({ method: 'POST', origin: 'main', readOnly: 'refused' });
    }
  });
});
