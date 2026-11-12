// client/v2/ai/agents-model.js — universal ACP B6 (plan feature-universal-acp-and-codex, Design Decisions 1–6):
// the other AI agents as data. PURE (no DOM, no React, no fetch) so every visibility rule is tested alone.
//
// The rows come from `GET /_api/agents` (routes/agents.ts): `{ agents: [Row], offerAgents: [id] }`, Row =
// `{ id, label, vendor, installed, policy, offerable, connected, auth, offer, connectNote, state, … }`.
// Claude is a row too; it keeps its own Settings card and its own Connect sheet, so it is never a row here.
//
// The principle: awareness only from local evidence. With only Claude (nothing else installed) every
// function below answers "nothing to show": no offer line, no picker, no link, no Settings card.

export const CLAUDE_ID = 'claude';

/** The last agent a NEW chat used, per profile (localStorage, JSON `{ [profileId]: agentId }`). */
export const LAST_AGENT_KEY = 'maude-ai-last-agent-v1';
/** The agent each chat started with (localStorage, JSON `{ [chatId]: agentId }`). */
export const CHAT_AGENT_KEY = 'maude-ai-chat-agent-v1';
/** How many chats the map above remembers (oldest dropped first). */
export const CHAT_AGENT_CAP = 300;

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' ? v : '');

/** A `/_api/agents` answer, made safe to read: anything malformed reads as "no agents". */
export function normalizeAgents(body) {
  const agents = (Array.isArray(body?.agents) ? body.agents : [])
    .filter((a) => isObj(a) && typeof a.id === 'string' && a.id)
    .map((a) => ({
      ...a,
      label: str(a.label) || a.id,
      vendor: str(a.vendor),
      installed: a.installed === true,
      connected: a.connected === true,
    }));
  const known = new Set(agents.map((a) => a.id));
  const offerAgents = (Array.isArray(body?.offerAgents) ? body.offerAgents : []).filter(
    (id) => typeof id === 'string' && id !== CLAUDE_ID && known.has(id)
  );
  return { agents, offerAgents };
}

/** "Codex" · "Codex and opencode" · "Codex, Gemini and opencode". */
export function andList(words) {
  const w = (words ?? []).filter(Boolean);
  if (w.length <= 1) return w.join('');
  return `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
}

/**
 * Design Decision 1: the one shared offer line in the AI panel's EMPTY state, or null.
 * Shown only when Claude is connected and idle and the server named agents it may offer (installed,
 * bridge-enforced, tested version, not connected, never dismissed). Unrestricted agents are never offered.
 * @returns {{ ids: string[], rows: object[], text: string } | null}
 */
export function offerModel({
  agents = [],
  offerAgents = [],
  claudeConnected = false,
  running = false,
}) {
  if (!claudeConnected || running) return null;
  const byId = new Map(agents.map((a) => [a.id, a]));
  const rows = offerAgents
    .map((id) => byId.get(id))
    .filter((a) => a && a.id !== CLAUDE_ID && !a.connected && a.policy !== 'unrestricted');
  if (!rows.length) return null;
  const one = rows.length === 1;
  return {
    ids: rows.map((a) => a.id),
    rows,
    text: `${andList(rows.map((a) => a.label))} ${one ? 'is' : 'are'} on this Mac. Use ${one ? 'it' : 'them'} in Maude too?`,
  };
}

/** Every connected agent, Claude included when it is connected. */
export function connectedAgents(agents = []) {
  return agents.filter((a) => a.connected);
}

/** Design Decision 4: the composer's agent chip shows only with two or more connected agents. */
export function pickerVisible(agents = []) {
  return connectedAgents(agents).length >= 2;
}

/**
 * Design Decision 3: the Connect sheet's "Use another agent…" link — only when an offer is waiting, or a
 * non-Claude agent that Maude can hold to its limits (bridge-enforced) is installed.
 */
export function otherAgentLinkVisible({ agents = [], offerAgents = [] } = {}) {
  if (offerAgents.length > 0) return true;
  return agents.some((a) => a.id !== CLAUDE_ID && a.installed && a.policy === 'bridge-enforced');
}

/**
 * The agent a NEW chat starts with: the last one used (when it is still connected), else Claude when it is
 * connected, else the first connected agent, else null (the server's default, Claude).
 */
export function resolveNewChatAgent(agents = [], lastUsed = null) {
  const on = connectedAgents(agents);
  if (lastUsed && on.some((a) => a.id === lastUsed)) return lastUsed;
  if (on.some((a) => a.id === CLAUDE_ID)) return CLAUDE_ID;
  return on[0]?.id ?? null;
}

/** What the `attach` frame carries as `agent`: nothing for Claude (the server's default), else the id. */
export function attachAgentOf(agentId) {
  return agentId && agentId !== CLAUDE_ID ? agentId : undefined;
}

// ── Settings › Connections › AI agents (Design Decision 2) ─────────────────────────────────────────

const STATE_WORDS = {
  connected: 'Connected',
  'sign-in': 'Sign in',
  untested: 'Untested version',
  available: 'Available',
};

/** The status word of a row: Connected · Sign in · Untested version · Unavailable — check <label> · Available. */
export function agentStateLabel(row) {
  if (row?.state === 'unavailable') return `Unavailable — check ${row.label}`;
  return STATE_WORDS[row?.state] ?? 'Available';
}

/** The dot beside the word: ok for connected, warn for what needs the person, off for the rest. */
export function agentStateSw(state) {
  if (state === 'connected') return 'ok';
  if (state === 'sign-in' || state === 'untested') return 'warn';
  return 'off';
}

/** The one action of a row: connect · signin · disconnect · null (nothing Maude can do from here). */
export function agentRowAction(row) {
  if (!row) return null;
  if (row.state === 'sign-in') return 'signin';
  if (row.connected) return 'disconnect';
  if (row.state === 'available') return 'connect';
  return null;
}

/**
 * The card's rows: installed agents only, Claude left out (it has its own card). `main` are the agents
 * Maude holds to its limits; `advanced` are the unrestricted ones, behind the folded Advanced part.
 * @returns {{ main: object[], advanced: object[] }}
 */
export function agentRows(agents = []) {
  const rows = agents
    .filter((a) => a.id !== CLAUDE_ID && a.installed)
    .map((a) => ({
      id: a.id,
      label: a.label,
      vendor: a.vendor,
      state: a.state,
      connected: a.connected,
      unrestricted: a.policy === 'unrestricted',
      connectNote: typeof a.connectNote === 'string' && a.connectNote ? a.connectNote : null,
      word: agentStateLabel(a),
      sw: agentStateSw(a.state),
      action: agentRowAction(a),
    }));
  return {
    main: rows.filter((r) => !r.unrestricted),
    advanced: rows.filter((r) => r.unrestricted),
  };
}

/**
 * Is the AI agents card drawn at all? Settings' reference list is always there once the list has
 * loaded (plan Design Decision 2), so a Mac with only Claude still reaches the Advanced fold (an
 * own API key for Claude). Only the AI panel stays unchanged for Claude-only users.
 */
export function agentsCardVisible(agents = []) {
  return agents.length > 0;
}

/** The closed card's line: "Codex connected" · "Codex and opencode on this Mac". */
export function agentsCardSummary(agents = []) {
  const { main, advanced } = agentRows(agents);
  const all = [...main, ...advanced];
  const on = all.filter((r) => r.connected).map((r) => r.label);
  if (on.length) return `${andList(on)} connected`;
  if (!all.length) return 'No other AI agents on this Mac';
  return `${andList(all.map((r) => r.label))} on this Mac`;
}

/** The consent card's words for an unrestricted agent. */
export function consentWords(label) {
  return `${label} runs without Maude’s file and network limits. Allow it for this project?`;
}

/** A connect that did not go through, in words. */
export function connectFailWords(r, label = 'This agent') {
  switch (r?.reason) {
    case 'not-installed':
      return `${label} is not on this Mac any more.`;
    case 'version-too-old':
      return `This version of ${label} is too old. Update it, then try again.`;
    case 'untested-version':
      return `Maude has not tested this version of ${label} yet.`;
    case 'consent-required':
      return `${label} needs your yes before it can run.`;
    case 'conformance-failed':
      return r.detail || `${label} did not stay inside Maude’s limits, so it was not connected.`;
    case 'timeout':
      return `The sign-in to ${label} did not finish. Try again.`;
    case 'signin-failed':
      return r.detail || `Could not start the sign-in to ${label}.`;
    default:
      return r?.detail || `Could not connect ${label}. Try again.`;
  }
}

// ── which agent a chat is on ────────────────────────────────────────────────────────────────────────

function storage(store) {
  if (store !== undefined) return store;
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}
function readMap(key, store) {
  try {
    const v = JSON.parse(storage(store)?.getItem(key) ?? 'null');
    return isObj(v) ? v : {};
  } catch {
    return {};
  }
}
function writeMap(key, map, store) {
  try {
    storage(store)?.setItem(key, JSON.stringify(map));
  } catch {
    /* private mode, storage full: not remembered, nothing breaks */
  }
}

export function readLastAgent(profileId = 'default', store) {
  const v = readMap(LAST_AGENT_KEY, store)[profileId || 'default'];
  return typeof v === 'string' && v ? v : null;
}
export function writeLastAgent(profileId = 'default', agentId, store) {
  if (!agentId) return;
  writeMap(
    LAST_AGENT_KEY,
    { ...readMap(LAST_AGENT_KEY, store), [profileId || 'default']: agentId },
    store
  );
}

/** The agent a chat started with; a chat Maude never recorded is Claude's (every chat before B6 is). */
export function readChatAgent(chatId, store) {
  if (!chatId) return null;
  const v = readMap(CHAT_AGENT_KEY, store)[chatId];
  return typeof v === 'string' && v ? v : null;
}
export function writeChatAgent(chatId, agentId, store) {
  if (!chatId || !agentId) return;
  const map = readMap(CHAT_AGENT_KEY, store);
  delete map[chatId];
  map[chatId] = agentId;
  const keys = Object.keys(map);
  for (const k of keys.slice(0, Math.max(0, keys.length - CHAT_AGENT_CAP))) delete map[k];
  writeMap(CHAT_AGENT_KEY, map, store);
}

// ── attribution (Design Decision 5) ─────────────────────────────────────────────────────────────────

/** The `{ id, label, vendor, statusUrl? }` a frame carries, or null. */
export function frameAgent(v) {
  if (!isObj(v) || typeof v.id !== 'string' || !v.id) return null;
  return {
    id: v.id,
    label: str(v.label) || v.id,
    vendor: str(v.vendor),
    ...(typeof v.statusUrl === 'string' && /^https:\/\//.test(v.statusUrl)
      ? { statusUrl: v.statusUrl }
      : {}),
  };
}

/** The small vendor badge on a reply: only for an agent other than Claude. */
export function agentBadge(agent) {
  const a = frameAgent(agent);
  if (!a || a.id === CLAUDE_ID) return null;
  return {
    label: a.label,
    vendor: a.vendor,
    title: a.vendor ? `${a.label} by ${a.vendor}` : a.label,
  };
}

/**
 * A turn error that came from an agent other than Claude, in words (`error` = `{ message, code?, agent? }`).
 * null: not an agent's (the ordinary error card shows it).
 * @returns {{ kind: 'stopped'|'consent'|'reported', text: string, agent: object, statusUrl?: string } | null}
 */
export function agentErrorModel(error) {
  const agent = frameAgent(error?.agent);
  if (!agent) return null;
  if (error.code === 'agent-policy-violated')
    return {
      kind: 'stopped',
      agent,
      text: `${agent.label} was stopped: it did not stay inside Maude’s limits.`,
    };
  if (error.code === 'agent-needs-consent')
    return { kind: 'consent', agent, text: consentWords(agent.label) };
  // security review 2026-11-12 (M4) — Maude refused to start it: its own words, never "reported"
  if (error.code === 'agent-not-connected')
    return {
      kind: 'not-connected',
      agent,
      text: `${agent.label} isn’t connected at the version on this Mac. Connect it in Settings › Connections › AI agents.`,
    };
  if (agent.id === CLAUDE_ID) return null;
  const said = str(error.message).trim() || 'something went wrong.';
  return {
    kind: 'reported',
    agent,
    text: `${agent.label} reported: ${said}`,
    ...(agent.statusUrl ? { statusUrl: agent.statusUrl } : {}),
  };
}

/** A turn that ended `reason: 'refused'`: its notice as one quiet line (never an error card). */
export function refusedNotice(frame) {
  if (frame?.t !== 'turn-end' || frame.reason !== 'refused') return null;
  const agent = frameAgent(frame.agent);
  const notice = str(frame.notice).trim();
  if (notice) return notice;
  return agent ? `${agent.label} stopped: Maude refused what it asked to do.` : null;
}
