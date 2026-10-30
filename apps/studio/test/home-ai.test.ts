// S6.6 — Home's AI readiness + connect: a thin front over the existing Claude install/login module
// (acp/login-state.ts, DDR-166). Status never hands the page a filesystem path; connect takes one
// of three named steps and nothing else.

import { describe, expect, mock, test } from 'bun:test';

import { createHomeAi } from '../home/ai.ts';

function fakes(over: { available?: boolean; installed?: boolean } = {}) {
  const calls: string[] = [];
  const ai = createHomeAi({
    probe: async () => ({
      available: over.available ?? false,
      reason: over.available ? undefined : 'Claude Code is installed but not signed in.',
      adapterEntry: '/secret/adapter.js',
      claudePath: over.installed === false ? null : '/Users/someone/.local/bin/claude',
    }),
    installState: () => ({ phase: 'idle' }),
    signinInFlight: () => false,
    startInstall: mock(() => {
      calls.push('install');
      return { ok: true };
    }),
    startSignin: mock(() => {
      calls.push('signin');
      return { ok: true };
    }),
    cancelSignin: () => calls.push('cancel-signin'),
    cancelInstall: () => calls.push('cancel-install'),
  });
  return { ai, calls };
}

describe('/_home/ai/status', () => {
  test('readiness, install state and sign-in flight — no paths', async () => {
    const { ai } = fakes();
    const r = await ai.status();
    expect(r.status).toBe(200);
    expect(r.body).toEqual({
      ok: true,
      available: false,
      claudeInstalled: true,
      reason: 'Claude Code is installed but not signed in.',
      install: { phase: 'idle' },
      signinInFlight: false,
    });
    expect(JSON.stringify(r.body)).not.toContain('/');
  });
});

describe('/_home/ai/connect', () => {
  test('install / signin / cancel reach the module once each', async () => {
    const { ai, calls } = fakes();
    expect((await ai.connect({ step: 'install' })).status).toBe(200);
    expect((await ai.connect({ step: 'signin' })).status).toBe(200);
    expect((await ai.connect({ step: 'cancel' })).status).toBe(200);
    expect(calls).toEqual(['install', 'signin', 'cancel-signin', 'cancel-install']);
  });

  test('anything else is refused and starts nothing', async () => {
    const { ai, calls } = fakes();
    for (const body of [{}, { step: 'rm -rf' }, { step: ['install'] }, null, 'install'])
      expect((await ai.connect(body)).status).toBe(400);
    expect(calls).toEqual([]);
  });

  test('a refusal from the module is a 409 with its reason', async () => {
    const ai = createHomeAi({
      probe: async () => ({ available: false, adapterEntry: null, claudePath: null }),
      installState: () => ({ phase: 'running' }),
      signinInFlight: () => false,
      startInstall: () => ({ ok: false, reason: 'An install is already in progress.' }),
      startSignin: () => ({ ok: false, reason: 'Claude Code is not installed.' }),
      cancelSignin: () => {},
      cancelInstall: () => {},
    });
    const r = await ai.connect({ step: 'install' });
    expect(r).toEqual({
      status: 409,
      body: { ok: false, error: 'An install is already in progress.' },
    });
  });
});
