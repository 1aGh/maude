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
 * V2-3.6 M4 — the desktop shell's per-spawn secrets, one prefix each, so a new var under a
 * prefix is scrubbed without a code change:
 *   • `MAUDE_TOKEN_*` — the GitHub token bridge's loopback endpoint + access key (sidecar.rs).
 *     Only the dev-server's github/token.ts talks to the bridge; an agent holding the key could
 *     ask it for the profile's GitHub OAuth token.
 *   • `MAUDE_SHELL_*` — the shell probe token + its info-file path (V2-3.4, V2-1.1 decision 8),
 *     and `MAUDE_SHELL_SIDECAR` (not a secret: the app-port-range marker, port.ts — an agent's own
 *     `maude design serve` must stay off the app's 46399–46408).
 *   • `MAUDE_HOME_*` — the Home server's internal bearer, its page secret (V2-3.6 H1) and its
 *     state dir. A project server never receives them; scrubbed anyway, so no spawn path can
 *     hand them on.
 * This is the ONE place these are stripped — bridge.ts, probe.ts and login-state.ts all spawn
 * through scrubAgentEnv (acp-env.test.ts pins that none strips locally).
 *
 * Accepted residual: the secrets still sit in the PARENT process's environment, and macOS
 * `ps -Eww -p <pid>` shows another process's original env to any same-user process — so an
 * agent that gets a `ps` approved can read them there. The agent runs as the same OS user and
 * could read any app-owned file as well; fd/pipe delivery was not taken in V2-3.6.
 */
const SHELL_SECRET_RE = /^MAUDE_(TOKEN|SHELL|HOME)_/i;

/** V2-8.9 M2 — the profile's credential-file pointers (sidecar::profile_env), never the agent's. */
const PROFILE_POINTER_KEYS: ReadonlySet<string> = new Set([
  'MAUDE_CLOUD_CONFIG',
  'HUBS_CONFIG_PATH',
]);

/**
 * V2-1.15 §5.4 — the per-chat run binding. `MAUDE_CHAT_ID` names the chat whose `claude` this
 * is; `maude design hook` sends it as `chat`, so the hook's run is that chat's run. An inherited
 * value (a studio started from inside another chat's terminal) would bind this process's agents
 * to a chat that is not theirs, so the scrub always drops it — and `MAUDE_AGENT_ACTOR` with it —
 * and only the bridge sets them again, for its own chat (`chatSpawnEnv`).
 */
// gate-b-sec2: MAUDE_SESSION_ROOT too (the project a chat's maude verbs are held to, set by the bridge)
const RUN_BINDING_KEYS: ReadonlySet<string> = new Set([
  'MAUDE_CHAT_ID',
  'MAUDE_AGENT_ACTOR',
  'MAUDE_SESSION_ROOT',
  // V2-8.9 H2 — the chat's read boundary for the source-reading verbs; only the bridge sets them.
  'MAUDE_READ_ROOTS',
  'MAUDE_GRANTS_FILE',
  // V2-8.9 re-check 2 H-a — the ports the browser helpers may open; only the bridge sets them.
  'MAUDE_OWN_PORTS',
]);
/** A chat id as `acp/index.ts` keys its files (`sanitizeChatId`): what MAUDE_CHAT_ID may carry. */
export const SPAWN_CHAT_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * `env` plus `MAUDE_CHAT_ID=<chatId>` for the adapter the bridge spawns for one chat. A chat id
 * that is not plain (or none) adds nothing: the hook then binds by session alone. Pure.
 */
export function chatSpawnEnv(
  env: Record<string, string>,
  chatId: string | null | undefined
): Record<string, string> {
  const { MAUDE_CHAT_ID: _stale, ...out } = env;
  if (typeof chatId === 'string' && SPAWN_CHAT_ID_RE.test(chatId)) out.MAUDE_CHAT_ID = chatId;
  return out;
}

/**
 * S11.13 — Settings › Advanced › "AI reviews argue it out (teams)" (`prefs.json experimentalTeams`):
 * agent teams on for the adapter this bridge spawns (the debate relay tier, DDR-130). Off adds
 * nothing — a CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS the person exported themselves stays. Pure.
 */
export function teamsSpawnEnv(
  env: Record<string, string>,
  prefs: { experimentalTeams?: boolean }
): Record<string, string> {
  return prefs.experimentalTeams === true
    ? { ...env, CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' }
    : { ...env };
}

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
    // V2-3.4 / V2-3.6 M4 — the desktop shell's per-spawn secrets belong to this server alone.
    if (SHELL_SECRET_RE.test(key)) continue;
    // V2-8.9 M2 — the profile's credential-file POINTERS stay with the server: the agent has no
    // business reading cloud.json / hubs.json (their folders are Read-denied too, may-scope.ts).
    // MAUDE_PROFILE_ID / MAUDE_PROFILE_LABEL pass — a tab's agent runs as the tab, and the one
    // verb that resolves hubs.json from the agent (`maude doctor`, cli/lib/hubs-config.mjs) finds
    // the profile's file from the id.
    if (PROFILE_POINTER_KEYS.has(key)) continue;
    // V2-1.15 §5.4 — a run binding is the bridge's to set, per chat (chatSpawnEnv)
    if (RUN_BINDING_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}
