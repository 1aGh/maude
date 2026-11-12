// The ACP conformance probe (acp/agents/conformance.ts, contract F6) against scripted fake agents:
// one that obeys its launch policy must pass every check, one that violates it must fail the probe
// on exactly the checks it breaks. Offline, no real agent binary (the real runs are local only:
// scripts/acp-conformance-local.ts).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  conversationOf,
  createConnectConformance,
  OPENCODE_PROFILE,
  type ProbeProfile,
  runConformance,
} from '../acp/agents/conformance.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';

const FAKE = join(import.meta.dir, 'fixtures', 'acp-conformance', 'fake-agent.mjs');
const base = mkdtempSync(join(tmpdir(), 'acp-conformance-test-'));
const SLASH_TMP = process.platform === 'darwin' ? '/private/tmp' : '/tmp';
/** The probe's temp-folder plants (S1) that exist right now. */
const tmpPlants = () =>
  new Set([
    ...readdirSync(SLASH_TMP)
      .filter((f) => f.startsWith('maude-conformance-'))
      .map((f) => join(SLASH_TMP, f)),
    ...readdirSync(tmpdir())
      .filter((f) => /^maude-conformance-(chat|sibling)-/.test(f))
      .map((f) => join(tmpdir(), f)),
  ]);
const plantsBefore = tmpPlants();
afterAll(() => rmSync(base, { recursive: true, force: true }));

function fakeDescriptor(
  mode: 'obey' | 'violate',
  leak: { mcp?: boolean; hooks?: boolean } = {}
): AgentDescriptor {
  return {
    id: 'custom:fake',
    label: 'Fake',
    vendor: 'test',
    detect: {
      bins: [],
      versionArgs: [],
      versionRe: /(\d+\.\d+\.\d+)/,
      minVersion: '0.0.0',
      testedMax: '0.0.0',
    },
    launch: { kind: 'native-acp', args: [FAKE] },
    auth: { gate: 'none' },
    envAllow: [],
    policy: 'unrestricted',
    plugins: 'none',
    enforcement: {
      launchPolicy: (ctx) => ({
        env: {
          FAKE_MODE: mode,
          FAKE_POLICY: JSON.stringify({
            readRoots: ctx.readRoots,
            writeRoots: ctx.writeRoots,
            mcp: mode === 'obey' && !leak.mcp ? 'off' : 'on',
            hooks: mode === 'obey' && !leak.hooks ? 'off' : 'on',
          }),
        },
      }),
      readGate: 'agent-permission-engine',
      shellGate: 'command-text',
      rejectEndsTurn: false,
      targetKeys: ['filePath', 'path'],
    },
  };
}

const FAKE_PROFILE: ProbeProfile = {
  ...OPENCODE_PROFILE,
  injectModel(env, baseUrl) {
    env.FAKE_MODEL_URL = baseUrl;
  },
  plantUserConfig(w, _baseUrl, command) {
    mkdirSync(join(w.home, '.fake-agent'), { recursive: true });
    writeFileSync(join(w.home, '.fake-agent', 'mcp.json'), JSON.stringify({ canary: { command } }));
    writeFileSync(
      join(w.home, '.fake-agent', 'hooks.json'),
      JSON.stringify([['/bin/sh', '-c', `touch '${w.hookMarker}-fake'`]])
    );
  },
  refusals: undefined,
};

const run = (mode: 'obey' | 'violate', leak: { mcp?: boolean; hooks?: boolean } = {}) =>
  runConformance(fakeDescriptor(mode, leak), process.execPath, {
    profile: FAKE_PROFILE,
    scratchBase: base,
    agentVersion: '1.0.0',
    timeoutMs: 45_000,
  });

describe('runConformance against fake agents', () => {
  test('an agent that obeys its launch policy passes every check', async () => {
    const r = await run('obey');
    const failed = r.checks.filter((c) => !c.ok);
    expect(failed).toEqual([]);
    expect(r.pass).toBe(true);
    expect(r.agentVersion).toBe('1.0.0');
    const names = r.checks.map((c) => c.name);
    for (const n of [
      'session',
      'secret-read',
      'project-read',
      'project-write',
      'outside-write',
      'runtime-state-write',
      'protected-write',
      'symlink-read',
      'tmp-read',
      'scratch-write',
      'curl-egress',
      'subagent-secret-read',
      'web-tool-absent',
      'user-mcp-ignored',
      'user-hooks-ignored',
      'auth-read',
      'no-client-fs-terminal',
      'tripwire-silent',
    ]) {
      expect(names).toContain(n);
    }
    // S1 — the protected writes reached the gate as cards (declined), never the disk
    expect(r.checks.find((c) => c.name === 'protected-write')?.detail).toContain('none written');
    expect(r.checks.find((c) => c.name === 'protected-write')?.detail).toContain('card declined');
    // a profile that does not exercise a check says so
    expect(r.checks.find((c) => c.name === 'scratch-write')?.detail).toBe(
      'not exercised for this agent'
    );
    // The person's card was declined for the shell call, never auto-approved.
    expect(r.checks.find((c) => c.name === 'curl-egress')?.detail).toContain('card declined');
  }, 60_000);

  test('an agent that violates its launch policy fails the probe on what it broke', async () => {
    const r = await run('violate');
    expect(r.pass).toBe(false);
    const failed = new Set(r.checks.filter((c) => !c.ok).map((c) => c.name));
    for (const n of [
      'secret-read',
      'outside-write',
      'runtime-state-write',
      'protected-write',
      'tmp-read',
      'curl-egress',
      'subagent-secret-read',
      'web-tool-absent',
      'user-mcp-ignored',
      'user-hooks-ignored',
      'auth-read',
    ]) {
      expect(failed.has(n as never)).toBe(true);
    }
    // What it did not break stays green: the probe is not failing everything wholesale.
    expect(failed.has('project-read')).toBe(false);
    expect(failed.has('project-write')).toBe(false);
    // S3 — an agent-permission-engine agent never starts with the link there: it cannot read
    // through it, so symlink-read passes by the refusal, not by the agent's own restraint.
    const link = r.checks.find((c) => c.name === 'symlink-read');
    expect(link?.ok).toBe(true);
    expect(link?.detail).toContain('agent-unsafe-link');
  }, 60_000);

  test('S3: an os-sandbox agent is not refused; reading through the link fails symlink-read', async () => {
    const d = fakeDescriptor('violate');
    const sandboxed: AgentDescriptor = {
      ...d,
      enforcement: {
        ...(d.enforcement as NonNullable<AgentDescriptor['enforcement']>),
        readGate: 'os-sandbox',
      },
    };
    const r = await runConformance(sandboxed, process.execPath, {
      profile: FAKE_PROFILE,
      scratchBase: base,
      agentVersion: '1.0.0',
      timeoutMs: 45_000,
    });
    const link = r.checks.find((c) => c.name === 'symlink-read');
    expect(link?.ok).toBe(false);
    expect(link?.detail).not.toContain('agent-unsafe-link');
  }, 60_000);

  // F6b — an agent that obeys every boundary but starts the person's own MCP server (or runs their
  // hook) fails the probe on exactly that check.
  test('an obeying agent that starts a user MCP server fails user-mcp-ignored only', async () => {
    const r = await run('obey', { mcp: true });
    expect(r.pass).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['user-mcp-ignored']);
  }, 60_000);

  test('an obeying agent that runs a user hook fails user-hooks-ignored only', async () => {
    const r = await run('obey', { hooks: true });
    expect(r.pass).toBe(false);
    expect(r.checks.filter((c) => !c.ok).map((c) => c.name)).toEqual(['user-hooks-ignored']);
  }, 60_000);

  test('a refusal the launch policy does not make fails user-hooks-ignored', async () => {
    const d = fakeDescriptor('obey');
    const r = await runConformance(d, process.execPath, {
      profile: {
        ...FAKE_PROFILE,
        refusals: [{ name: 'a planted plugin', plant: () => () => {} }],
      },
      scratchBase: base,
      agentVersion: '1.0.0',
      timeoutMs: 45_000,
    });
    const hooks = r.checks.find((c) => c.name === 'user-hooks-ignored');
    expect(hooks?.ok).toBe(false);
    expect(hooks?.detail).toContain('did NOT refuse: a planted plugin');
  }, 60_000);

  test('the scratch world is removed afterwards, the temp-folder plants with it', () => {
    expect(readdirSync(base)).toEqual([]);
    expect([...tmpPlants()].filter((p) => !plantsBefore.has(p))).toEqual([]);
  });

  // Defender warning — a stored chat key never reaches a probe run.
  test('the probe spawns with no chat key, whatever the store holds', () => {
    const src = readFileSync(
      join(import.meta.dir, '..', 'acp', 'agents', 'conformance.ts'),
      'utf8'
    );
    expect(src).toMatch(/chatKeyEnv: \{\}/);
    expect(src).toMatch(/chatKeyStored: false/);
  });

  test('an agent with no launch policy is never judged conformant', async () => {
    const d = { ...fakeDescriptor('obey'), enforcement: undefined };
    const r = await runConformance(d, process.execPath, {
      profile: FAKE_PROFILE,
      scratchBase: base,
    });
    expect(r.pass).toBe(false);
    expect(r.checks[0]?.detail).toContain('no launch policy');
  });
});

describe('conversationOf', () => {
  test('reads user turns and tool outputs from both wires', () => {
    expect(
      conversationOf({
        input: [
          { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
          { type: 'function_call', name: 'x' },
          { type: 'function_call_output', call_id: 'c', output: 'out' },
        ],
      })
    ).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'tool', text: 'out' },
    ]);
    expect(
      conversationOf({
        messages: [
          { role: 'system', content: 's' },
          { role: 'user', content: 'hi' },
          { role: 'tool', content: [{ type: 'text', text: 'out' }] },
        ],
      })
    ).toEqual([
      { kind: 'user', text: 'hi' },
      { kind: 'tool', text: 'out' },
    ]);
  });
});

describe('createConnectConformance (Settings › Connect, F6b)', () => {
  const ok = { pass: true, checks: [], agentVersion: '1.0.0' };
  const bad = {
    pass: false,
    checks: [
      { name: 'secret-read' as const, ok: false, detail: '' },
      { name: 'project-read' as const, ok: true, detail: '' },
    ],
    agentVersion: '1.0.0',
  };
  const enforced = { ...fakeDescriptor('obey'), policy: 'bridge-enforced' as const };

  test('runs the probe once per binary and caches only a pass', async () => {
    let calls = 0;
    let answer: typeof ok | typeof bad = bad;
    const check = createConnectConformance(async () => {
      calls++;
      return answer;
    });
    const r1 = await check(enforced, process.execPath);
    expect(r1.pass).toBe(false);
    expect(r1.detail).toContain('secret-read');
    expect(r1.detail).not.toContain('project-read');
    answer = ok;
    expect((await check(enforced, process.execPath)).pass).toBe(true);
    expect((await check(enforced, process.execPath)).pass).toBe(true);
    expect(calls).toBe(2);
  });

  test('never passes an agent that is not bridge-enforced, and never probes it', async () => {
    let calls = 0;
    const check = createConnectConformance(async () => {
      calls++;
      return ok;
    });
    expect((await check(fakeDescriptor('obey'), process.execPath)).pass).toBe(false);
    expect(calls).toBe(0);
  });

  test("opencode is refused up front when the person's config has a plugin", async () => {
    const home = join(base, 'person-home');
    mkdirSync(join(home, '.config', 'opencode', 'plugins'), { recursive: true });
    writeFileSync(join(home, '.config', 'opencode', 'plugins', 'x.ts'), 'export {}');
    let calls = 0;
    const check = createConnectConformance(
      async () => {
        calls++;
        return ok;
      },
      { HOME: home }
    );
    const r = await check({ ...enforced, id: 'opencode' }, process.execPath);
    rmSync(home, { recursive: true, force: true });
    expect(r.pass).toBe(false);
    expect(r.detail).toContain('plugin');
    expect(calls).toBe(0);
  });

  test('a binary that is not there does not pass', async () => {
    const check = createConnectConformance(async () => ok);
    expect((await check(enforced, join(base, 'no-such-bin'))).pass).toBe(false);
  });
});
