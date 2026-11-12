// B7 (plan feature-universal-acp-and-codex, DDR-252 § BYOK) — which env a stored chat key becomes,
// for ONE agent. spawn.ts applies it AFTER the shared scrub, so a key reaches only the agent it was
// stored for: a Codex key never lands in Claude's or opencode's env, and the inherited env never
// supplies one (the scrub drops OPENAI_* / GEMINI_* / ANTHROPIC_* first).
//
//   codex   OPENAI_API_KEY (its descriptor's auth.apiKeyEnv[0]) + DEFAULT_AUTH_REQUEST {methodId:
//           "api-key"}: codex-acp 2.5 reads the key only when the api-key auth method runs, and runs
//           the default request only when Codex has no sign-in of its own (a ChatGPT sign-in wins).
//           Codex's launch policy keeps the var out of every command it runs (shell_environment_policy,
//           acp/policy/launch-codex.ts).
//   gemini  GEMINI_API_KEY (catalog auth.apiKeyEnv).
//   opencode none: opencode takes a key per provider (OPENAI_API_KEY, ANTHROPIC_API_KEY, …) with no
//           one name to inject, so its keys stay with opencode's own `opencode auth login`.
//   claude  ANTHROPIC_API_KEY, ONLY when this profile turned on the Advanced opt-in (DDR-252 amends
//           DDR-123), plus CLAUDE_CODE_SUBPROCESS_ENV_SCRUB=1 so Claude Code strips it from the
//           commands, hooks and MCP servers it starts. Off (the default) → nothing, and the Claude
//           spawn stays byte-identical (test/acp-agent-spawn.test.ts).

import { getChatKey } from '../../generation/keys.ts';
import { isAgentSecretKey } from '../env.ts';
import type { AgentDescriptor } from './descriptor.ts';

/** The env name Claude's opted-in key rides in (Anthropic auth precedence #3). */
export const CLAUDE_API_KEY_ENV = 'ANTHROPIC_API_KEY';

/** codex-acp's "log in with the api-key method when Codex needs a login" switch. */
const CODEX_DEFAULT_AUTH = JSON.stringify({ methodId: 'api-key' });

/** The env name a chat key for `d` is injected as, or null when the agent takes none. */
export function chatKeyEnvName(d: AgentDescriptor): string | null {
  if (d.id === 'claude') return d.policy === 'claude-meta' ? CLAUDE_API_KEY_ENV : null;
  const name = d.auth.apiKeyEnv?.[0];
  // Only a vendor credential name (the ones the shared scrub drops) — never ANTHROPIC_*, never one
  // of Maude's own secrets, never PATH: a descriptor cannot turn a key into anything else.
  return name && isAgentSecretKey(name) ? name : null;
}

/**
 * The env to add for `d`'s stored chat key (empty when none). `lookup` defaults to the 0600 store
 * (generation/keys.ts); tests hand it a fake. Read at each spawn, never cached — a key removed in
 * Settings is gone from the next session.
 */
export function chatKeyEnvFor(
  d: AgentDescriptor,
  lookup: (agentId: string) => string | null = getChatKey
): Record<string, string> {
  const name = chatKeyEnvName(d);
  if (!name) return {};
  let key: string | null = null;
  try {
    key = lookup(d.id);
  } catch {
    key = null; // an unreadable store is "no key", never a crash of the spawn
  }
  if (!key) return {};
  if (d.id === 'claude') return { [name]: key, CLAUDE_CODE_SUBPROCESS_ENV_SCRUB: '1' };
  if (d.id === 'codex') return { [name]: key, DEFAULT_AUTH_REQUEST: CODEX_DEFAULT_AUTH };
  return { [name]: key };
}

/** Whether `d` can take a chat key at all (Settings shows the "Use an API key" row only then). */
export function acceptsChatKey(d: AgentDescriptor): boolean {
  return chatKeyEnvName(d) !== null;
}
