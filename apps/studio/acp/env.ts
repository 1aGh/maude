// DDR-123 guardrail #1 — keep the spawned Claude Code adapter on the user's
// Pro/Max SUBSCRIPTION, never metered API billing.
//
// Anthropic's auth precedence puts `ANTHROPIC_API_KEY` (#3, API billing) ABOVE
// the subscription OAuth from `/login` (#6, the Pro/Max default). A stray global
// key in the inherited environment would therefore silently switch the user to
// API billing the moment the adapter spawns `claude -p`. We delete it (and the
// equivalent auth-token override) from the child env before spawning. This is
// the single load-bearing detail that makes the whole panel subscription-correct
// — the guarantee lives here, at the bottom of the stack, independent of the UI.

/**
 * Env var names that flip Claude Code off the subscription and onto metered API
 * billing (or a non-subscription auth token). The two precedence-relevant keys.
 */
export const SUBSCRIPTION_SCRUBBED_ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
] as const;

/**
 * Scrub the WHOLE provider/billing namespace, not just the two known keys —
 * any `ANTHROPIC_*` (API key, auth token, custom `ANTHROPIC_BASE_URL`, Bedrock/
 * Vertex base URLs, future billing vars) plus the cloud-provider toggles. This
 * closes the denylist gap (security review F1): a stray base-URL or a NEW billing
 * env var can't silently redirect the spawned `claude` off the user's
 * subscription or exfiltrate prompts to an attacker endpoint. `ANTHROPIC_MODEL`
 * is in this set too — the bridge re-adds it AFTER the scrub, from a validated
 * allowlist value, so the parent's value never leaks through.
 */
const PROVIDER_REDIRECT_RE = /^(ANTHROPIC_|CLAUDE_CODE_USE_|AWS_BEARER_TOKEN_BEDROCK)/i;

/**
 * feature-ai-media-generation (DDR-164) — the BYOK generation key-custody env
 * vars. The ACP `claude` subprocess NEVER needs these: the dev-server (a separate
 * process, with its own unscrubbed env) resolves provider keys; the agent only
 * TRIGGERS generation through `maude design generate`. So scrub them from the
 * child:
 *   • `MAUDE_GEN_KEY_ENDPOINT` / `MAUDE_GEN_KEY_KEY` — the Phase-5.1 native
 *     keychain-bridge loopback endpoint + its access key. Inheriting these would
 *     let a prompt-injected agent query the bridge for every provider key. This
 *     is DDR-164 **F3**, brought forward from Phase 5.1 so the tripwire is armed
 *     BEFORE the bridge is wired, never after.
 *   • `MAUDE_GEN_KEYS_PATH` — a custom key-file location. Scrubbing it removes the
 *     signpost to a non-default `keys.json` from the child (defense-in-depth).
 * NOTE this does NOT make the key unreachable to a compromised same-UID agent —
 * it can still read the DEFAULT `~/.config/maude/keys.json` (0600, owner = the
 * agent's own user) off disk. That residual is the pre-existing full-tool-agent
 * trifecta (documented in the `ai-generation` skill + DDR-164), not something an
 * env-scrub can close. This pattern's job is narrower: never HAND the child an
 * env pointer/credential it doesn't need.
 */
const GENERATION_KEY_CUSTODY_RE = /^MAUDE_GEN_KEY/i;

/**
 * Return a copy of `source` with the billing/provider-redirect keys removed and
 * any `undefined` values dropped (Bun.spawn's `env` wants Record<string,string>).
 * Pure — never mutates the input, so `process.env` stays intact for the parent.
 */
export function scrubAgentEnv(
  source: Record<string, string | undefined> = process.env
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value === undefined) continue;
    if (PROVIDER_REDIRECT_RE.test(key)) continue;
    if (GENERATION_KEY_CUSTODY_RE.test(key)) continue;
    // The cell materializer's loopback credential is the studio's alone — an
    // agent it spawns has no business filling the cache (Phase 1 review L3).
    if (key === 'MAUDE_MATERIALIZE_TOKEN') continue;
    out[key] = value;
  }
  return out;
}
