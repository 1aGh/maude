// The e2e-only model override (acp/agents/e2e-model.ts): `MAUDE_E2E_AGENT_MODEL_URL` points a
// non-Claude agent the REAL server spawns at a loopback scripted model, so the local end-to-end run
// (scripts/acp-e2e-local.ts) reaches the agent's real model path with no account and no network.
// A release build ignores it, a non-loopback URL is ignored, Claude is never touched, and the switch
// itself never reaches the agent's env.

import { afterAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { agentById, CLAUDE } from '../acp/agents/catalog.ts';
import {
  applyE2eAgentModel,
  E2E_AGENT_MODEL_SWITCH,
  e2eAgentModelUrl,
} from '../acp/agents/e2e-model.ts';

const tmp = mkdtempSync(join(tmpdir(), 'maude-e2e-model-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

const codex = agentById('codex');
const opencode = agentById('opencode');
if (!codex || !opencode) throw new Error('catalog lost codex/opencode');

const env = (url: string) => ({ [E2E_AGENT_MODEL_SWITCH]: url });

describe('e2eAgentModelUrl', () => {
  test('a loopback http URL is honoured outside a release build', () => {
    expect(e2eAgentModelUrl(env('http://127.0.0.1:4555'), false)).toBe('http://127.0.0.1:4555');
  });
  test('a release build ignores it', () => {
    expect(e2eAgentModelUrl(env('http://127.0.0.1:4555'), true)).toBeNull();
  });
  test('anything but http://127.0.0.1:<port> is ignored', () => {
    for (const u of [
      'http://example.com:4555',
      'https://127.0.0.1:4555',
      'http://localhost:4555',
      'http://127.0.0.1:4555/v1',
      'http://user@127.0.0.1:4555',
      'http://127.0.0.1',
      'not a url',
      '',
    ]) {
      expect(e2eAgentModelUrl(env(u), false)).toBeNull();
    }
    expect(e2eAgentModelUrl({}, false)).toBeNull();
  });
});

describe('applyE2eAgentModel', () => {
  test('codex: its model provider is the loopback model, and the switch is not passed on', () => {
    const codexHome = join(tmp, 'codex-home');
    const spawnEnv: Record<string, string> = {
      CODEX_HOME: codexHome,
      [E2E_AGENT_MODEL_SWITCH]: 'http://127.0.0.1:4555',
    };
    mkdirSync(codexHome, { recursive: true });
    expect(applyE2eAgentModel(codex, spawnEnv, env('http://127.0.0.1:4555'), false)).toBe(true);
    expect(spawnEnv.MODEL_PROVIDER).toBe('maude_probe');
    expect(spawnEnv.CODEX_CONFIG).toContain('http://127.0.0.1:4555/v1');
    expect(readFileSync(join(codexHome, 'config.toml'), 'utf8')).toContain(
      'base_url = "http://127.0.0.1:4555/v1"'
    );
    expect(spawnEnv[E2E_AGENT_MODEL_SWITCH]).toBeUndefined();
  });

  test('opencode: its provider is the loopback model', () => {
    const spawnEnv: Record<string, string> = { OPENCODE_CONFIG_CONTENT: '{"permission":{}}' };
    expect(applyE2eAgentModel(opencode, spawnEnv, env('http://127.0.0.1:4555'), false)).toBe(true);
    const cfg = JSON.parse(spawnEnv.OPENCODE_CONFIG_CONTENT);
    expect(cfg.provider.maude_probe.options.baseURL).toBe('http://127.0.0.1:4555/v1');
    expect(cfg.permission).toEqual({});
  });

  test('a release build leaves the spawn env alone (except dropping the switch)', () => {
    const spawnEnv: Record<string, string> = {
      OPENCODE_CONFIG_CONTENT: '{}',
      [E2E_AGENT_MODEL_SWITCH]: 'http://127.0.0.1:4555',
    };
    expect(applyE2eAgentModel(opencode, spawnEnv, env('http://127.0.0.1:4555'), true)).toBe(false);
    expect(spawnEnv).toEqual({ OPENCODE_CONFIG_CONTENT: '{}' });
  });

  test('Claude is never touched', () => {
    const spawnEnv: Record<string, string> = { A: '1' };
    expect(applyE2eAgentModel(CLAUDE, spawnEnv, env('http://127.0.0.1:4555'), false)).toBe(false);
    expect(spawnEnv).toEqual({ A: '1' });
  });
});

describe('the bridge applies it to every non-Claude spawn', () => {
  test('spawnPlan calls applyE2eAgentModel on the plan agentSpawn returns', () => {
    const src = readFileSync(join(import.meta.dir, '..', 'acp', 'bridge.ts'), 'utf8');
    expect(src).toMatch(/applyE2eAgentModel\(d, plan\.env\)/);
  });
});
