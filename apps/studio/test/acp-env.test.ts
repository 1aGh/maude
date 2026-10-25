// DDR-123 guardrail #1 — the single load-bearing detail that keeps the chat
// panel on the user's Pro/Max subscription instead of metered API billing.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { chatSpawnEnv, SUBSCRIPTION_SCRUBBED_ENV_KEYS, scrubAgentEnv } from '../acp/env.ts';

describe('scrubAgentEnv — subscription guardrail', () => {
  test('strips the billing-switching keys, keeps everything else', () => {
    const out = scrubAgentEnv({
      PATH: '/usr/bin',
      HOME: '/Users/x',
      ANTHROPIC_API_KEY: 'sk-live-xxx',
      ANTHROPIC_AUTH_TOKEN: 'tok-xxx',
      UNDEFINED_VAR: undefined,
    });
    expect(out.PATH).toBe('/usr/bin');
    expect(out.HOME).toBe('/Users/x');
    expect('ANTHROPIC_API_KEY' in out).toBe(false);
    expect('ANTHROPIC_AUTH_TOKEN' in out).toBe(false);
    // undefined values are dropped (Bun.spawn env wants Record<string,string>)
    expect('UNDEFINED_VAR' in out).toBe(false);
  });

  test('pins exactly the two precedence-relevant keys', () => {
    expect([...SUBSCRIPTION_SCRUBBED_ENV_KEYS].sort()).toEqual([
      'ANTHROPIC_API_KEY',
      'ANTHROPIC_AUTH_TOKEN',
    ]);
  });

  test('scrubs the whole provider/billing namespace, not just the two keys (F1)', () => {
    const out = scrubAgentEnv({
      PATH: '/usr/bin',
      ANTHROPIC_BASE_URL: 'https://evil.example/v1',
      ANTHROPIC_MODEL: 'attacker-pinned',
      ANTHROPIC_BEDROCK_BASE_URL: 'https://evil',
      CLAUDE_CODE_USE_BEDROCK: '1',
      CLAUDE_CODE_USE_VERTEX: '1',
      AWS_BEARER_TOKEN_BEDROCK: 'tok',
      claude_session: 'keep-me', // not a provider redirect → kept
    });
    expect(out.PATH).toBe('/usr/bin');
    expect('ANTHROPIC_BASE_URL' in out).toBe(false);
    expect('ANTHROPIC_MODEL' in out).toBe(false); // re-added by the bridge from a validated value
    expect('ANTHROPIC_BEDROCK_BASE_URL' in out).toBe(false);
    expect('CLAUDE_CODE_USE_BEDROCK' in out).toBe(false);
    expect('CLAUDE_CODE_USE_VERTEX' in out).toBe(false);
    expect('AWS_BEARER_TOKEN_BEDROCK' in out).toBe(false);
    expect(out.claude_session).toBe('keep-me');
  });

  test('never mutates the source (process.env stays intact for the parent)', () => {
    const src: Record<string, string | undefined> = { ANTHROPIC_API_KEY: 'sk', PATH: '/bin' };
    const out = scrubAgentEnv(src);
    expect(src.ANTHROPIC_API_KEY).toBe('sk');
    expect(out).not.toBe(src);
  });

  test('defaults to process.env when called with no argument', () => {
    // Smoke: doesn't throw, returns a string map without the scrubbed keys.
    const out = scrubAgentEnv();
    expect('ANTHROPIC_API_KEY' in out).toBe(false);
  });

  // feature-ai-media-generation Phase 1 (Task 1.4) + DDR-164 F3 — the ACP chat
  // panel can TRIGGER generation because the BYOK provider key is resolved
  // SERVER-SIDE (the dev-server, a separate process, reads the 0600 file /
  // keychain via keys.ts). The ACP `claude` subprocess never needs a generation
  // key-custody env var, so we SCRUB them: the Phase-5.1 keychain-bridge endpoint
  // + key (`MAUDE_GEN_KEY_*` — F3, brought forward so the tripwire is armed before
  // the bridge is wired) AND a custom key-file path (`MAUDE_GEN_KEYS_PATH`). This
  // does NOT make the key unreachable to a compromised same-UID agent (it can
  // still read the default keys.json off disk — the pre-existing full-tool-agent
  // trifecta, documented, not closable by an env-scrub); it only ensures the child
  // is never HANDED a pointer/credential it doesn't need. Meanwhile the `maude`
  // CLI on PATH still resolves, so generation keeps working through the scrub.
  test('scrubs the generation key-custody env vars, keeps CLI PATH (Task 1.4 / DDR-164 F3)', () => {
    const out = scrubAgentEnv({
      PATH: '/usr/local/bin:/usr/bin',
      MAUDE_GEN_KEYS_PATH: '/Users/x/.config/maude/keys.json',
      MAUDE_GEN_KEY_ENDPOINT: 'http://127.0.0.1:9/keychain', // Phase-5.1 bridge — MUST be scrubbed (F3)
      MAUDE_GEN_KEY_KEY: 'per-launch-bridge-secret',
      ANTHROPIC_API_KEY: 'sk-should-be-scrubbed',
    });
    // The generate CLI stays reachable (the sidecar, not this child, holds the key).
    expect(out.PATH).toBe('/usr/local/bin:/usr/bin');
    // Every generation key-custody var is stripped from the agent env.
    expect('MAUDE_GEN_KEYS_PATH' in out).toBe(false);
    expect('MAUDE_GEN_KEY_ENDPOINT' in out).toBe(false);
    expect('MAUDE_GEN_KEY_KEY' in out).toBe(false);
    // The subscription guardrail still fires.
    expect('ANTHROPIC_API_KEY' in out).toBe(false);
  });

  // V2-3.4 — a tab's AI session runs as that tab's account profile (so `maude design link` lands
  // there), but the shell's probe token is the studio's alone: an agent holding it could answer
  // the shell's "is AI running?" for the server it was spawned by.
  // V2-8.9 M2 — the id + label stay; the credential-file pointers go (acp-credential-deny.test.ts).
  test('keeps the profile id + label, scrubs the pointers and the shell probe token', () => {
    const out = scrubAgentEnv({
      MAUDE_PROFILE_ID: 'work',
      MAUDE_PROFILE_LABEL: 'Work',
      MAUDE_CLOUD_CONFIG: '/Users/x/.config/maude/profiles/work/cloud.json',
      HUBS_CONFIG_PATH: '/Users/x/.config/maude/profiles/work/hubs.json',
      MAUDE_SHELL_TOKEN: 'per-spawn-shell-token',
      MAUDE_SHELL_INFO_FILE: '/Users/x/Library/Application Support/maude/shell/p-1.json',
    });
    expect(out.MAUDE_PROFILE_ID).toBe('work');
    expect(out.MAUDE_PROFILE_LABEL).toBe('Work');
    expect('MAUDE_CLOUD_CONFIG' in out).toBe(false);
    expect('HUBS_CONFIG_PATH' in out).toBe(false);
    expect('MAUDE_SHELL_TOKEN' in out).toBe(false);
    expect('MAUDE_SHELL_INFO_FILE' in out).toBe(false);
  });

  // V2-3.6 M4 — every per-spawn shell secret, in ONE scrub. The probe and login-state spawns of
  // `claude` used only scrubAgentEnv(), and only the bridge deleted MAUDE_TOKEN_*, so a probe child
  // still held the GitHub token bridge's key. A future var under the same prefixes is caught too.
  test('scrubs every per-spawn shell secret (M4) and keeps the agent env it needs', () => {
    const SECRETS = [
      'MAUDE_TOKEN_ENDPOINT', // GitHub token bridge (sidecar.rs)
      'MAUDE_TOKEN_KEY',
      'MAUDE_TOKEN_SOMETHING_NEW',
      'MAUDE_SHELL_TOKEN', // shell probe token (V2-3.4)
      'MAUDE_SHELL_INFO_FILE',
      'MAUDE_SHELL_SOMETHING_NEW',
      'MAUDE_HOME_TOKEN', // Home internal bearer (home.rs)
      'MAUDE_HOME_PAGE_SECRET', // Home page secret (V2-3.6 H1)
      'MAUDE_HOME_STATE_DIR',
      'MAUDE_MATERIALIZE_TOKEN',
      'MAUDE_GEN_KEY_ENDPOINT',
      'MAUDE_GEN_KEY_KEY',
      'maude_token_key', // case-insensitive
    ];
    const KEPT = {
      PATH: '/usr/bin',
      MAUDE_PROFILE_ID: 'work',
      // V2-8.9 M2 — MAUDE_CLOUD_CONFIG / HUBS_CONFIG_PATH no longer pass (acp-credential-deny.test.ts)
      MAUDE_INDEX_DIR: '/x/index',
      MAUDE_TOKENISER: 'not-a-prefix-match', // MAUDE_TOKEN_ needs the underscore
    };
    const out = scrubAgentEnv({
      ...KEPT,
      ...Object.fromEntries(SECRETS.map((k) => [k, 'secret'])),
    });
    for (const k of SECRETS) expect([k, k in out]).toEqual([k, false]);
    expect(out).toEqual(KEPT);
  });

  test('bridge, probe and login-state all spawn through scrubAgentEnv, with no local strips', () => {
    const src = (f: string) => readFileSync(join(import.meta.dir, '..', 'acp', f), 'utf8');
    for (const f of ['bridge.ts', 'probe.ts', 'login-state.ts']) {
      expect([f, /scrubAgentEnv\(/.test(src(f))]).toEqual([f, true]);
      expect([f, /delete env\.MAUDE_/.test(src(f))]).toEqual([f, false]);
    }
  });
});

// S5.4 (V2-1.15 §5.4) — MAUDE_CHAT_ID binds a chat's hooks to that chat's run. The bridge sets it
// per chat; an inherited value would bind this studio's agents to a chat that is not theirs.
describe('the run binding — MAUDE_CHAT_ID / MAUDE_AGENT_ACTOR', () => {
  test('scrubAgentEnv drops an inherited binding (the probe and login-state never carry one)', () => {
    const out = scrubAgentEnv({
      PATH: '/usr/bin',
      MAUDE_CHAT_ID: 'someone-elses-chat',
      MAUDE_AGENT_ACTOR: 'maude-chat',
      MAUDE_PROFILE_ID: 'work',
    });
    expect(out).toEqual({ PATH: '/usr/bin', MAUDE_PROFILE_ID: 'work' });
  });

  test('chatSpawnEnv sets the chat id when it is a plain chat id, else nothing', () => {
    expect(chatSpawnEnv({ PATH: '/usr/bin' }, 'c_1-a')).toEqual({
      PATH: '/usr/bin',
      MAUDE_CHAT_ID: 'c_1-a',
    });
    for (const bad of ['', '../x', 'a b', 'x'.repeat(65), null, undefined])
      expect(chatSpawnEnv({ PATH: '/usr/bin', MAUDE_CHAT_ID: 'stale' }, bad)).toEqual({
        PATH: '/usr/bin',
      });
    const src = { PATH: '/usr/bin' };
    chatSpawnEnv(src, 'c1');
    expect(src).toEqual({ PATH: '/usr/bin' }); // pure
  });
});
