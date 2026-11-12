// client/v2/settings/agent-keys.js — B7 (DDR-252 § BYOK): own API keys for the chat agents, the model and
// the two writes behind Settings › AI agents › Advanced. The server never sends a key back: a row carries
// `acceptsKey`, `keySet` and `keyLast4` only (routes/agents.ts), and this file never keeps one past the
// save call. Pure of React so the tests drive it with a scripted fetch.

import { loadAgents } from '../ai/agents-store.js';

const CLAUDE_ID = 'claude';
const enc = (id) => encodeURIComponent(id);

/** The rows that take an own key: installed agents the server says accept one, Claude last. */
export function agentKeyRows(agents = []) {
  const rows = agents
    .filter((a) => a && a.installed === true && a.acceptsKey === true)
    .map((a) => ({
      id: a.id,
      label: typeof a.label === 'string' && a.label ? a.label : a.id,
      keySet: a.keySet === true,
      last4: a.keySet === true && typeof a.keyLast4 === 'string' ? a.keyLast4.slice(-4) : null,
    }));
  return {
    keys: rows.filter((r) => r.id !== CLAUDE_ID),
    claude: rows.find((r) => r.id === CLAUDE_ID) ?? null,
  };
}

/** "••••1234" for a stored key, "" when none. */
export const maskedKey = (last4) => (last4 ? `••••${last4}` : '');

/** The confirm card's words for Claude's opt-in (DDR-252: the billing switch is explicit). */
export const CLAUDE_OPTIN_WORDS =
  'Claude will use this Anthropic API key instead of your Claude account. Every message is billed to that API account, per token, not to your Claude plan. Only for this profile; turn it off to go back to your account.';

/** A key as typed is worth sending: non-empty, one line, at most 512 characters. */
export function keyLooksValid(value) {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  return v.length > 0 && v.length <= 512 && !/\s/.test(v);
}

/** A refused save, in words. */
export function keyErrorWords(r) {
  switch (r?.reason) {
    case 'invalid-key':
      return 'That does not look like an API key. Paste it again, on one line.';
    case 'opt-in-required':
      return 'Turn on the Anthropic API key first.';
    case 'no-api-key':
      return 'This agent takes no API key from Maude. Sign in to it instead.';
    default:
      return 'Could not save the key. Try again.';
  }
}

async function post(fetchImpl, url, body) {
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      ...(body
        ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
        : {}),
    });
    return (await res.json().catch(() => null)) ?? { ok: false };
  } catch {
    return { ok: false };
  }
}

/** Save an agent's key (Claude's needs `optIn: true`, from the confirm card). Reloads the list. */
export async function saveAgentKey(
  id,
  key,
  { optIn = false, fetchImpl = (...a) => fetch(...a) } = {}
) {
  const r = await post(fetchImpl, `/_api/agents/${enc(id)}/key`, {
    key,
    ...(optIn ? { optIn: true } : {}),
  });
  await loadAgents({ force: false, fetchImpl });
  return r;
}

/** Remove an agent's key (for Claude: the opt-in goes with it). Reloads the list. */
export async function removeAgentKey(id, { fetchImpl = (...a) => fetch(...a) } = {}) {
  const r = await post(fetchImpl, `/_api/agents/${enc(id)}/key-remove`);
  await loadAgents({ force: false, fetchImpl });
  return r;
}
