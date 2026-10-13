// DDR-123 guardrail #1 — the single load-bearing detail that keeps the chat
// panel on the user's Pro/Max subscription instead of metered API billing.

import { describe, expect, test } from 'bun:test';

import { SUBSCRIPTION_SCRUBBED_ENV_KEYS, scrubAgentEnv } from '../acp/env.ts';

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
  test('keeps the profile env, scrubs the shell probe token', () => {
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
    expect(out.MAUDE_CLOUD_CONFIG).toContain('/profiles/work/');
    expect(out.HUBS_CONFIG_PATH).toContain('/profiles/work/');
    expect('MAUDE_SHELL_TOKEN' in out).toBe(false);
    expect('MAUDE_SHELL_INFO_FILE' in out).toBe(false);
  });
});
