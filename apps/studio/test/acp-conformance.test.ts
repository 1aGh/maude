// The ACP conformance probe (acp/agents/conformance.ts, contract F6) against scripted fake agents:
// one that obeys its launch policy must pass every check, one that violates it must fail the probe
// on exactly the checks it breaks. Offline, no real agent binary (the real runs are local only:
// scripts/acp-conformance-local.ts).

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  conversationOf,
  OPENCODE_PROFILE,
  type ProbeProfile,
  runConformance,
} from '../acp/agents/conformance.ts';
import type { AgentDescriptor } from '../acp/agents/descriptor.ts';

const FAKE = join(import.meta.dir, 'fixtures', 'acp-conformance', 'fake-agent.mjs');
const base = mkdtempSync(join(tmpdir(), 'acp-conformance-test-'));
afterAll(() => rmSync(base, { recursive: true, force: true }));

function fakeDescriptor(mode: 'obey' | 'violate'): AgentDescriptor {
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
            mcp: mode === 'obey' ? 'off' : 'on',
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
  },
};

const run = (mode: 'obey' | 'violate') =>
  runConformance(fakeDescriptor(mode), process.execPath, {
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
      'curl-egress',
      'subagent-secret-read',
      'web-tool-absent',
      'user-mcp-ignored',
      'no-client-fs-terminal',
      'tripwire-silent',
    ]) {
      expect(names).toContain(n);
    }
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
      'curl-egress',
      'subagent-secret-read',
      'web-tool-absent',
      'user-mcp-ignored',
    ]) {
      expect(failed.has(n as never)).toBe(true);
    }
    // What it did not break stays green: the probe is not failing everything wholesale.
    expect(failed.has('project-read')).toBe(false);
    expect(failed.has('project-write')).toBe(false);
  }, 60_000);

  test('the scratch world is removed afterwards', () => {
    expect(readdirSync(base)).toEqual([]);
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
