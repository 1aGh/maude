// The ACP chat the reachability probe talks to (Phase 4 gate; contract
// apps/studio/client/v2/contracts/V2-4-gate-nothing-deleted.md). The desktop's chat panel speaks the dev
// server's bridge frames over `/_ws/acp` (client/panels/acp-runtime.js `onFrame`) — not raw ACP JSON-RPC; the
// server turns the adapter's JSON-RPC into these frames (acp/index.ts). The probe plays that server: a
// script per world, no agent, no `claude`. Pure data + one pure function, so scripts/test can pin it.
//
//   ACP_SCRIPTS[name] = { open: [frame…], warm: [frame…], prompt: [frame…], cancel: [frame…] }
//     open     sent when the socket opens (the server's onOpen: ready, then the replayed catalogue)
//     warm     sent on a `warm` frame (the adapter publishes its commands / caps)
//     prompt   sent on a `prompt` frame — one canned turn. It does NOT end with `turn-end` unless the script
//              says so: a turn left open keeps Stop on screen and the permission cards pending.
//   `$chat` in any string is the chat id the client addressed (a permission response must echo it).

const U = (update, extra = {}) => ({ t: 'update', update, ...extra });

export const READY = { t: 'ready', available: true };

export const COMMANDS = {
  t: 'commands',
  commands: [
    { name: 'design:edit', description: 'Apply feedback to the active canvas' },
    { name: 'design:new', description: 'Create a canvas' },
    { name: 'compact', description: 'Summarise the conversation so far' },
  ],
};

const modes = (currentModeId) => ({
  currentModeId,
  availableModes: [
    { id: 'default', name: 'Manual', description: 'Ask before every edit' },
    { id: 'acceptEdits', name: 'Accept Edits', description: 'Edits go through, the rest asks' },
    { id: 'plan', name: 'Plan Mode', description: 'Plan only, no edits' },
  ],
});
const select = (id, name, category, currentValue, options) => ({
  id,
  name,
  category,
  type: 'select',
  currentValue,
  options: options.map(([value, label]) => ({ value, name: label })),
});
export const caps = (mode = 'default') => ({
  t: 'caps',
  modes: modes(mode),
  configOptions: [
    select('model', 'Model', 'model', 'sonnet', [
      ['sonnet', 'Sonnet'],
      ['opus', 'Opus'],
    ]),
    select('effort', 'Effort', 'thought_level', 'medium', [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
    ]),
    select('fast', 'Fast mode', 'model_config', 'off', [
      ['off', 'Off'],
      ['on', 'On'],
    ]),
  ],
});

/** A context gauge, a cost and a rate-limit warning (ChatFootInfo's popover, RateLimitBanner). */
export const USAGE = {
  t: 'usage',
  usage: {
    used: 52_000,
    size: 200_000,
    cost: { amount: 0.42, currency: 'USD' },
    rateLimit: {
      status: 'allowed_warning',
      rateLimitType: 'five_hour',
      utilization: 91,
      resetsAt: '2030-01-01T20:00:00Z',
    },
  },
};
export const SESSION_INFO = {
  t: 'session-info',
  title: 'Tighten the hero',
  updatedAt: '2026-10-17T10:00:00Z',
};

const OPEN = [READY, COMMANDS, caps(), USAGE, SESSION_INFO];

const ALLOW = { optionId: 'allow', name: 'Allow once', kind: 'allow_once' };
const ALWAYS = { optionId: 'always', name: 'Always allow', kind: 'allow_always' };
const REJECT = { optionId: 'reject', name: 'Reject', kind: 'reject_once' };

/** Two reads in a row (a tool group), a thought, a reply, then an edit that waits on the person: a write the
 *  path gate refused (out of the project) and, queued behind it, an ordinary one. */
const TURN = [
  U({
    sessionUpdate: 'agent_thought_chunk',
    content: { type: 'text', text: 'Looking at the hero…' },
  }),
  U({
    sessionUpdate: 'tool_call',
    toolCallId: 't1',
    title: 'Read Home.tsx',
    kind: 'read',
    rawInput: { file_path: '.design/ui/Home.tsx' },
  }),
  U({ sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed', rawOutput: 'ok' }),
  U({
    sessionUpdate: 'tool_call',
    toolCallId: 't2',
    title: 'Read Home.meta.json',
    kind: 'read',
    rawInput: { file_path: '.design/ui/Home.meta.json' },
  }),
  U({ sessionUpdate: 'tool_call_update', toolCallId: 't2', status: 'completed', rawOutput: 'ok' }),
  U({
    sessionUpdate: 'agent_message_chunk',
    content: { type: 'text', text: 'I will tighten the headline and the spacing.' },
  }),
  U({
    sessionUpdate: 'tool_call',
    toolCallId: 't3',
    title: 'Write ../../.zshenv',
    kind: 'edit',
    rawInput: { file_path: '../../.zshenv' },
  }),
  {
    t: 'permission-request',
    id: 'perm-1',
    chat: '$chat',
    toolCall: {
      toolCallId: 't3',
      title: 'Write ../../.zshenv',
      rawInput: { file_path: '../../.zshenv' },
    },
    options: [ALLOW, REJECT],
    scope: {
      outOfProjectWrite: true,
      resolvedPaths: ['/Users/probe/.zshenv'],
      scopeRoot: '/Users/probe/project',
      reason: 'outside',
    },
  },
  {
    t: 'permission-request',
    id: 'perm-2',
    chat: '$chat',
    toolCall: {
      toolCallId: 't4',
      title: 'Edit Home.tsx',
      rawInput: { file_path: '.design/ui/Home.tsx' },
    },
    options: [ALLOW, ALWAYS, REJECT],
    scope: null,
  },
];

/** An AskUserQuestion-shaped form: a single choice with a typed alternative, a multi choice, and a free-text
 *  field that reads like a secret (the card warns). */
const ELICIT = {
  t: 'elicitation-request',
  id: 'elicit-1',
  chat: '$chat',
  mode: 'form',
  message: 'A few questions before I change the hero',
  requestedSchema: {
    type: 'object',
    properties: {
      question_0: {
        type: 'string',
        title: 'Which direction?',
        oneOf: [
          { const: 'Bold', title: 'Bold', description: 'Big type' },
          { const: 'Quiet', title: 'Quiet' },
        ],
      },
      question_0_custom: { type: 'string', title: 'Other' },
      question_1: {
        type: 'array',
        title: 'Which parts?',
        items: {
          anyOf: [
            { const: 'Title', title: 'Title' },
            { const: 'Body', title: 'Body' },
          ],
        },
      },
      question_2: {
        type: 'string',
        title: 'Paste your API key',
        description: 'The token for the font service',
      },
    },
  },
};

export const ACP_SCRIPTS = {
  // the whole panel: caps, a catalogue, a gauge + a warning, a turn with tools and two waiting permission cards
  chat: { open: OPEN, warm: [], prompt: TURN },
  // the session is still starting: the bridge is up (ready) and nothing else has arrived
  'chat-connecting': { open: [READY], warm: [], prompt: [] },
  // Plan mode blocks edits: the loud banner offers the hop out of it
  'chat-plan': { open: [READY, COMMANDS, caps('plan'), SESSION_INFO], warm: [], prompt: [] },
  // a form the agent asks the person to fill in
  'chat-elicit': { open: OPEN, warm: [], prompt: [ELICIT] },
  // the bridge fails mid-turn: the retry card
  'chat-error': {
    open: OPEN,
    warm: [],
    prompt: [{ t: 'error', message: 'The Claude bridge dropped the connection.' }],
  },
  // a finished turn: the reply stays, the turn ends
  'chat-done': {
    open: OPEN,
    warm: [],
    prompt: [
      U({
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: 'Done — the headline is tighter.' },
      }),
      { t: 'turn-end' },
    ],
  },
};

/** The frames the script answers one client frame with (`[]` for a frame it ignores). `chatId` fills `$chat`. */
export function acpReplies(scripts, name, frame, chatId = 'probe-chat') {
  const s = scripts[name];
  if (!s) throw new Error(`acp stub: no script "${name}"`);
  const pick =
    frame?.t === 'attach'
      ? [{ t: 'attached', chat: frame.chat ?? chatId, running: false }]
      : frame?.t === 'warm'
        ? s.warm
        : frame?.t === 'prompt'
          ? s.prompt
          : frame?.t === 'cancel'
            ? (s.cancel ?? [{ t: 'turn-end' }])
            : [];
  return JSON.parse(JSON.stringify(pick).replaceAll('$chat', chatId));
}

/** The frames sent as soon as the socket opens. */
export function acpOpenFrames(scripts, name) {
  const s = scripts[name];
  if (!s) throw new Error(`acp stub: no script "${name}"`);
  return s.open;
}
