// B7 (plan feature-universal-acp-and-codex, DDR-252 § BYOK, amends DDR-123) — own API key for the
// chat agents. The store (generation/keys.ts `chat` scope, 0600, never echoed), the injection (a key
// reaches ONLY the agent it was stored for, after the scrub), Codex's shell env policy (the key never
// reaches a command Codex runs), and Claude's opt-in (off = byte-identical spawn). Fake keys only.
//
// The bun preload pins XDG_CONFIG_HOME to a throwaway dir; every test here points the store at its
// own file through MAUDE_GEN_KEYS_PATH and puts it back.

import { afterAll, afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CLAUDE, CODEX, GEMINI, OPENCODE } from '../acp/agents/catalog.ts';
import { acceptsChatKey, chatKeyEnvFor, chatKeyEnvName } from '../acp/agents/chat-key.ts';
import type { AgentDescriptor, PolicyCtx } from '../acp/agents/descriptor.ts';
import { agentSpawn } from '../acp/agents/spawn.ts';
import { scrubAgentEnv } from '../acp/env.ts';
import { credentialPathsFor } from '../acp/may-scope.ts';
import { CODEX_SHELL_ENV_POLICY, codexConfig } from '../acp/policy/launch-codex.ts';
import {
  chatKeyStatus,
  claudeApiKeyOptedIn,
  clearChatKey,
  clearClaudeApiKey,
  configuredProviders,
  currentProfileId,
  getChatKey,
  getProviderKey,
  normalizeChatKey,
  setChatKey,
  setClaudeApiKey,
  setProviderKey,
} from '../generation/keys.ts';

const root = mkdtempSync(join(tmpdir(), 'acp-chat-keys-'));
afterAll(() => rmSync(root, { recursive: true, force: true }));

const FAKE_OPENAI = 'sk-test-FAKE-openai-0000-ABCD';
const FAKE_ANTHROPIC = 'sk-ant-test-FAKE-0000-WXYZ';
const FAKE_GEMINI = 'AIza-test-FAKE-gemini-9876';

let n = 0;
let keysPath = '';
const saved = {
  path: process.env.MAUDE_GEN_KEYS_PATH,
  profile: process.env.MAUDE_PROFILE_ID,
};
beforeEach(() => {
  keysPath = join(root, `k${++n}`, 'keys.json');
  process.env.MAUDE_GEN_KEYS_PATH = keysPath;
  delete process.env.MAUDE_PROFILE_ID;
});
afterEach(() => {
  if (saved.path === undefined) delete process.env.MAUDE_GEN_KEYS_PATH;
  else process.env.MAUDE_GEN_KEYS_PATH = saved.path;
  if (saved.profile === undefined) delete process.env.MAUDE_PROFILE_ID;
  else process.env.MAUDE_PROFILE_ID = saved.profile;
});

const ctx = (): PolicyCtx => ({
  scopeRoot: '/p',
  readRoots: ['/p'],
  writeRoots: ['/p'],
  credentialPaths: { dirs: [], files: [] },
  may: { assets: true, web: false },
  designRoots: ['/p/.design'],
  agentBin: '/opt/agent',
  // A scratch HOME: the person's real ~/.codex or ~/.opencode must never decide this test (an
  // opencode plugin on the developer's Mac makes Maude refuse opencode, correctly).
  hostEnv: { HOME: join(root, 'home'), XDG_CONFIG_HOME: join(root, 'home', '.config') },
});

function spawnOf(
  d: AgentDescriptor,
  inherited: Record<string, string> = {},
  chatKeyEnv?: Record<string, string>
) {
  return agentSpawn({
    descriptor: d,
    scrubbed: scrubAgentEnv({ PATH: '/bin', ...inherited }, d.envAllow),
    agentBin: '/opt/agent',
    adapterEntry: '/adapter.js',
    runtime: { bin: '/bun', bunBeBun: false },
    policyCtx: ctx(),
    actor: { sessionRoot: '/p', readRoots: ['/p'] },
    teams: false,
    chatId: 'c1',
    delimiter: ':',
    ...(chatKeyEnv ? { chatKeyEnv } : {}),
  });
}

const leaks = (env: Record<string, string>, ...keys: string[]) =>
  Object.entries(env).filter(([, v]) => keys.some((k) => v.includes(k)));

// ---------------------------------------------------------------- store

describe('the chat scope of the 0600 key store', () => {
  test('a stored key is 0600, written atomically, and only presence + last four come back', () => {
    const status = setChatKey('codex', `  ${FAKE_OPENAI}  `);
    expect(status).toEqual({ set: true, last4: 'ABCD' });
    expect(JSON.stringify(status)).not.toContain(FAKE_OPENAI);
    expect(statSync(keysPath).mode & 0o777).toBe(0o600);
    // atomic: no temp file left beside it
    expect(readdirSync(dirname(keysPath))).toEqual(['keys.json']);
    expect(chatKeyStatus('codex')).toEqual({ set: true, last4: 'ABCD' });
    expect(getChatKey('codex')).toBe(FAKE_OPENAI);
    clearChatKey('codex');
    expect(chatKeyStatus('codex')).toEqual({ set: false, last4: null });
    expect(getChatKey('codex')).toBeNull();
  });

  test('media-generation keys are untouched by chat keys, and never become chat keys', async () => {
    setProviderKey('fal', 'fal-test-FAKE');
    setChatKey('codex', FAKE_OPENAI);
    expect(await getProviderKey('fal')).toBe('fal-test-FAKE');
    expect(configuredProviders()).toEqual(['fal']);
    expect(getChatKey('fal')).toBeNull();
    clearChatKey('codex');
    expect(await getProviderKey('fal')).toBe('fal-test-FAKE');
  });

  test('a key is trimmed; empty, multi-line, control-char or >512-char keys are refused', () => {
    expect(normalizeChatKey(' a ')).toBe('a');
    for (const bad of ['', '   ', 'a\nb', 'a\rb', 'a b', 'a\u0000b', 'x'.repeat(513), 42, null]) {
      expect(normalizeChatKey(bad)).toBeNull();
    }
    expect(normalizeChatKey('x'.repeat(512))).toHaveLength(512);
    expect(() => setChatKey('codex', 'a\nb')).toThrow('invalid key');
    expect(() => setChatKey('../x', FAKE_OPENAI)).toThrow('invalid agent id');
    expect(existsSync(keysPath)).toBe(false);
  });

  test("Claude's key needs the opt-in, lives per profile, and setChatKey can never store one", () => {
    expect(() => setChatKey('claude', FAKE_ANTHROPIC)).toThrow('invalid agent id');
    expect(() => setClaudeApiKey(FAKE_ANTHROPIC, false)).toThrow('opt-in required');
    expect(() => setClaudeApiKey(FAKE_ANTHROPIC, 'yes')).toThrow('opt-in required');
    expect(claudeApiKeyOptedIn()).toBe(false);
    expect(setClaudeApiKey(FAKE_ANTHROPIC, true)).toEqual({ set: true, last4: 'WXYZ' });
    expect(claudeApiKeyOptedIn()).toBe(true);
    expect(chatKeyStatus('claude')).toEqual({ set: true, last4: 'WXYZ' });
    // another profile did not opt in
    process.env.MAUDE_PROFILE_ID = 'work';
    expect(currentProfileId()).toBe('work');
    expect(claudeApiKeyOptedIn()).toBe(false);
    expect(getChatKey('claude')).toBeNull();
    delete process.env.MAUDE_PROFILE_ID;
    // a hand-written record without optIn is not an opt-in
    const file = JSON.parse(readFileSync(keysPath, 'utf8'));
    file.claudeApiKey.default.optIn = false;
    writeFileSync(keysPath, JSON.stringify(file));
    expect(claudeApiKeyOptedIn()).toBe(false);
    setClaudeApiKey(FAKE_ANTHROPIC, true);
    clearClaudeApiKey();
    expect(claudeApiKeyOptedIn()).toBe(false);
    expect(readFileSync(keysPath, 'utf8')).not.toContain(FAKE_ANTHROPIC);
  });

  test('a garbage profile id falls back to default', () => {
    expect(currentProfileId({ MAUDE_PROFILE_ID: '../etc' })).toBe('default');
    expect(currentProfileId({})).toBe('default');
  });

  test('the key store stays Read-denied to every agent, a custom path included', () => {
    const xdg = join(root, 'xdg');
    const paths = credentialPathsFor(
      { HOME: '/Users/x', XDG_CONFIG_HOME: xdg },
      '/Users/x',
      'darwin'
    );
    expect(paths.dirs).toContain('/Users/x/.config/maude');
    expect(paths.dirs).toContain(join(xdg, 'maude'));
    const custom = credentialPathsFor(
      { HOME: '/Users/x', MAUDE_GEN_KEYS_PATH: '/srv/k/keys.json' },
      '/Users/x',
      'darwin'
    );
    expect(custom.files).toContain('/srv/k/keys.json');
  });
});

// ---------------------------------------------------------------- injection

describe('a key reaches only the agent it belongs to', () => {
  test('env names: Codex OPENAI_API_KEY, Gemini GEMINI_API_KEY, Claude ANTHROPIC_API_KEY, opencode none', () => {
    expect(chatKeyEnvName(CODEX)).toBe('OPENAI_API_KEY');
    expect(chatKeyEnvName(GEMINI)).toBe('GEMINI_API_KEY');
    expect(chatKeyEnvName(CLAUDE)).toBe('ANTHROPIC_API_KEY');
    expect(chatKeyEnvName(OPENCODE)).toBeNull();
    expect(acceptsChatKey(OPENCODE)).toBe(false);
    // a descriptor cannot turn its key into PATH, a Maude secret or an Anthropic var
    for (const name of ['PATH', 'MAUDE_SHELL_TOKEN', 'ANTHROPIC_API_KEY', 'NODE_OPTIONS']) {
      const d = { ...CODEX, auth: { ...CODEX.auth, apiKeyEnv: [name] } };
      expect(chatKeyEnvName(d)).toBeNull();
      expect(chatKeyEnvFor(d, () => FAKE_OPENAI)).toEqual({});
    }
  });

  test('the lookup is by the agent own id; an unreadable store is no key', () => {
    const asked: string[] = [];
    chatKeyEnvFor(CODEX, (id) => {
      asked.push(id);
      return null;
    });
    chatKeyEnvFor(GEMINI, (id) => {
      asked.push(id);
      return null;
    });
    expect(asked).toEqual(['codex', 'gemini']);
    expect(
      chatKeyEnvFor(CODEX, () => {
        throw new Error('EACCES');
      })
    ).toEqual({});
  });

  test('stored Codex + Gemini + Claude keys: each spawn carries its own and no other', () => {
    setChatKey('codex', FAKE_OPENAI);
    setChatKey('gemini', FAKE_GEMINI);
    setChatKey('opencode', 'oc-test-FAKE-key'); // stored, but opencode takes no injected key
    setClaudeApiKey(FAKE_ANTHROPIC, true);

    const codex = spawnOf(CODEX).env;
    expect(codex.OPENAI_API_KEY).toBe(FAKE_OPENAI);
    expect(codex.DEFAULT_AUTH_REQUEST).toBe('{"methodId":"api-key"}');
    expect(leaks(codex, FAKE_ANTHROPIC, FAKE_GEMINI, 'oc-test-FAKE-key')).toEqual([]);

    const gemini = spawnOf(GEMINI).env;
    expect(gemini.GEMINI_API_KEY).toBe(FAKE_GEMINI);
    expect(leaks(gemini, FAKE_ANTHROPIC, FAKE_OPENAI, 'oc-test-FAKE-key')).toEqual([]);

    const claude = spawnOf(CLAUDE).env;
    expect(claude.ANTHROPIC_API_KEY).toBe(FAKE_ANTHROPIC);
    expect(claude.CLAUDE_CODE_SUBPROCESS_ENV_SCRUB).toBe('1');
    expect(leaks(claude, FAKE_OPENAI, FAKE_GEMINI, 'oc-test-FAKE-key')).toEqual([]);
    expect(claude.DEFAULT_AUTH_REQUEST).toBeUndefined();

    const opencode = spawnOf(OPENCODE).env;
    expect(leaks(opencode, FAKE_OPENAI, FAKE_GEMINI, FAKE_ANTHROPIC, 'oc-test-FAKE-key')).toEqual(
      []
    );
  });

  test('an inherited vendor key never stands in for a stored one', () => {
    const inherited = { OPENAI_API_KEY: 'sk-inherited', ANTHROPIC_API_KEY: 'sk-ant-inherited' };
    const codex = spawnOf(CODEX, inherited).env;
    expect(codex.OPENAI_API_KEY).toBeUndefined();
    expect(codex.DEFAULT_AUTH_REQUEST).toBeUndefined();
    const claude = spawnOf(CLAUDE, inherited).env;
    expect(claude.ANTHROPIC_API_KEY).toBeUndefined();
    // with the opt-in on, Claude gets the STORED key, never the inherited one
    setClaudeApiKey(FAKE_ANTHROPIC, true);
    expect(spawnOf(CLAUDE, inherited).env.ANTHROPIC_API_KEY).toBe(FAKE_ANTHROPIC);
  });

  test('Claude without the opt-in spawns byte-identical to a spawn with no key store at all', () => {
    setChatKey('codex', FAKE_OPENAI);
    setChatKey('gemini', FAKE_GEMINI);
    const fromStore = spawnOf(CLAUDE);
    const none = spawnOf(CLAUDE, {}, {});
    expect(fromStore).toEqual(none);
    expect(Object.keys(fromStore.env).some((k) => /^ANTHROPIC_|SUBPROCESS_ENV_SCRUB/.test(k))).toBe(
      false
    );
  });
});

// ---------------------------------------------------------------- Codex shell env policy

/** Codex's exclude matching: case-insensitive `*` globs over the whole name. */
const globMatch = (pattern: string, name: string) =>
  new RegExp(
    `^${pattern
      .split('*')
      .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
      .join('.*')}$`,
    'i'
  ).test(name);

describe("Codex's shell env policy keeps the key out of the commands it runs", () => {
  test('CODEX_CONFIG carries the policy: default excludes on, every key var excluded', () => {
    const cfg = codexConfig(ctx(), { platform: 'darwin', home: '/Users/x' });
    expect(cfg.shell_environment_policy).toEqual(CODEX_SHELL_ENV_POLICY);
    expect(CODEX_SHELL_ENV_POLICY.ignore_default_excludes).toBe(false);
    expect(CODEX_SHELL_ENV_POLICY.inherit).toBe('all');
    const injected = Object.keys(chatKeyEnvFor(CODEX, () => FAKE_OPENAI));
    expect(injected.sort()).toEqual(['DEFAULT_AUTH_REQUEST', 'OPENAI_API_KEY']);
    for (const name of [
      ...injected,
      'CODEX_API_KEY',
      'ANTHROPIC_API_KEY',
      'GEMINI_API_KEY',
      'openai_api_key',
    ]) {
      expect(CODEX_SHELL_ENV_POLICY.exclude.some((p) => globMatch(p, name))).toBe(true);
    }
    // the chat's own env a `maude design` verb needs still reaches the command
    for (const name of [
      'PATH',
      'MAUDE_SESSION_ROOT',
      'MAUDE_READ_ROOTS',
      'MAUDE_AGENT_ACTOR',
      'TMPDIR',
    ]) {
      expect(CODEX_SHELL_ENV_POLICY.exclude.some((p) => globMatch(p, name))).toBe(false);
    }
  });

  test('the policy rides the serialised CODEX_CONFIG the adapter receives', () => {
    setChatKey('codex', FAKE_OPENAI);
    const env = spawnOf(CODEX).env;
    const cfg = JSON.parse(env.CODEX_CONFIG ?? '{}');
    expect(cfg.shell_environment_policy.exclude).toContain('OPENAI_*');
    // the config itself never carries the key
    expect(env.CODEX_CONFIG).not.toContain(FAKE_OPENAI);
  });
});
