// Universal ACP B6 (plan feature-universal-acp-and-codex, Design Decisions 1–6): the Studio client for other AI
// agents — the offer line, the composer's agent chip, the Connect sheet's link, Settings › AI agents, the
// attribution of an agent's own words, generic modes. And the pin: a Claude-only person sees NOTHING new.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import {
  agentErrorModel,
  agentRows,
  agentsCardSummary,
  agentsCardVisible,
  attachAgentOf,
  normalizeAgents,
  offerModel,
  otherAgentLinkVisible,
  pickerVisible,
  readChatAgent,
  readLastAgent,
  refusedNotice,
  resolveNewChatAgent,
  writeChatAgent,
  writeLastAgent,
} from '../client/v2/ai/agents-model.js';
import { modeBanner, modeOptions } from '../client/v2/ai/advanced-model.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  // Let React's scheduled passive effects run while `window` still exists.
  await new Promise((r) => setTimeout(r, 0));
  GlobalRegistrator.unregister();
});

type Row = Record<string, unknown>;
const claude = (over: Row = {}): Row => ({
  id: 'claude',
  label: 'Claude',
  vendor: 'Anthropic',
  installed: true,
  policy: 'bridge-enforced',
  connected: true,
  state: 'connected',
  offer: false,
  ...over,
});
const codex = (over: Row = {}): Row => ({
  id: 'codex',
  label: 'Codex',
  vendor: 'OpenAI',
  installed: true,
  policy: 'bridge-enforced',
  connected: false,
  state: 'available',
  offer: true,
  connectNote: null,
  ...over,
});
const opencode = (over: Row = {}): Row => ({
  id: 'opencode',
  label: 'opencode',
  vendor: 'opencode',
  installed: true,
  policy: 'bridge-enforced',
  connected: false,
  state: 'available',
  offer: true,
  connectNote: 'opencode sends your project to its own hosted model unless you pick a provider.',
  ...over,
});
const goose = (over: Row = {}): Row => ({
  id: 'goose',
  label: 'Goose',
  vendor: 'Block',
  installed: true,
  policy: 'unrestricted',
  connected: false,
  state: 'available',
  offer: false,
  ...over,
});
const list = (agents: Row[], offerAgents: string[] = []) =>
  normalizeAgents({ agents, offerAgents });

/** A Claude-only Mac: Claude connected, the catalog's others not installed. */
const CLAUDE_ONLY = list([
  claude(),
  codex({ installed: false, offer: false, state: 'unavailable' }),
  opencode({ installed: false, offer: false, state: 'unavailable' }),
]);

function memStore() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

// ── Design Decision 1: the offer line ─────────────────────────────────────────────────────────────
describe('offerModel', () => {
  test('one line while Claude is connected and idle and the server offers an agent', () => {
    const l = list([claude(), codex()], ['codex']);
    expect(offerModel({ ...l, claudeConnected: true })?.text).toBe(
      'Codex is on this Mac. Use it in Maude too?'
    );
  });
  test('several agents share ONE line', () => {
    const l = list([claude(), codex(), opencode()], ['codex', 'opencode']);
    const m = offerModel({ ...l, claudeConnected: true });
    expect(m?.ids).toEqual(['codex', 'opencode']);
    expect(m?.text).toBe('Codex and opencode are on this Mac. Use them in Maude too?');
  });
  test('never while a turn runs, never without Claude, never with an empty list', () => {
    const l = list([claude(), codex()], ['codex']);
    expect(offerModel({ ...l, claudeConnected: true, running: true })).toBeNull();
    expect(offerModel({ ...l, claudeConnected: false })).toBeNull();
    expect(offerModel({ ...list([claude(), codex()], []), claudeConnected: true })).toBeNull();
  });
  test('an unrestricted or already connected agent is never offered, even if the server lists it', () => {
    const l = list([claude(), goose(), codex({ connected: true })], ['goose', 'codex']);
    expect(offerModel({ ...l, claudeConnected: true })).toBeNull();
  });
});

// ── Design Decisions 3 + 4: the link and the picker ───────────────────────────────────────────────
describe('visibility rules', () => {
  test('the picker needs two connected agents (Claude counts when it is connected)', () => {
    expect(pickerVisible(list([claude(), codex({ connected: true })]).agents)).toBe(true);
    expect(pickerVisible(list([claude(), codex()]).agents)).toBe(false);
    expect(
      pickerVisible(list([claude({ connected: false }), codex({ connected: true })]).agents)
    ).toBe(false);
  });
  test('the Connect sheet link: an offer, or an installed bridge-enforced agent; never Claude or unrestricted alone', () => {
    expect(otherAgentLinkVisible(list([claude(), codex()], ['codex']))).toBe(true);
    expect(otherAgentLinkVisible(list([claude(), codex({ offer: false })], []))).toBe(true);
    expect(otherAgentLinkVisible(list([claude(), goose()], []))).toBe(false);
    expect(otherAgentLinkVisible(CLAUDE_ONLY)).toBe(false);
  });
  test('a new chat uses the last agent used when it is still connected, else Claude', () => {
    const on = list([claude(), codex({ connected: true })]).agents;
    expect(resolveNewChatAgent(on, 'codex')).toBe('codex');
    expect(resolveNewChatAgent(list([claude(), codex()]).agents, 'codex')).toBe('claude');
    expect(
      resolveNewChatAgent(
        list([claude({ connected: false }), codex({ connected: true })]).agents,
        null
      )
    ).toBe('codex');
    // Claude rides the attach frame as nothing at all: its frame is unchanged
    expect(attachAgentOf('claude')).toBeUndefined();
    expect(attachAgentOf('codex')).toBe('codex');
  });
  test('the last-used agent is per profile, and a chat keeps the agent it started with', () => {
    const s = memStore();
    writeLastAgent('default', 'codex', s);
    writeLastAgent('work', 'claude', s);
    expect(readLastAgent('default', s)).toBe('codex');
    expect(readLastAgent('work', s)).toBe('claude');
    writeChatAgent('c1', 'codex', s);
    expect(readChatAgent('c1', s)).toBe('codex');
    expect(readChatAgent('never', s)).toBeNull();
    // a storage that throws (private mode) forgets, it never breaks
    const bad = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => writeLastAgent('default', 'codex', bad)).not.toThrow();
    expect(readLastAgent('default', bad)).toBeNull();
  });
});

// ── Design Decision 2: Settings rows ──────────────────────────────────────────────────────────────
describe('agentRows', () => {
  test('installed agents only, Claude never, unrestricted under Advanced, with the state words', () => {
    const { main, advanced } = agentRows(
      list([
        claude(),
        codex({ connected: true, state: 'connected' }),
        opencode({ state: 'sign-in' }),
        codex({ id: 'gemini', label: 'Gemini', state: 'untested' }),
        codex({ id: 'copilot', label: 'Copilot', state: 'unavailable' }),
        codex({ id: 'cursor', label: 'Cursor', installed: false }),
        goose(),
      ]).agents
    );
    expect(main.map((r) => [r.id, r.word, r.action])).toEqual([
      ['codex', 'Connected', 'disconnect'],
      ['opencode', 'Sign in', 'signin'],
      ['gemini', 'Untested version', null],
      ['copilot', 'Unavailable — check Copilot', null],
    ]);
    expect(advanced.map((r) => [r.id, r.word, r.action])).toEqual([
      ['goose', 'Available', 'connect'],
    ]);
    expect(main.find((r) => r.id === 'opencode')?.connectNote).toContain('hosted model');
  });
  test('the card is Settings’ reference list: drawn once the list loads, Claude-only included', () => {
    expect(agentsCardVisible([])).toBe(false);
    expect(agentsCardVisible(CLAUDE_ONLY.agents)).toBe(true);
    expect(agentsCardSummary(CLAUDE_ONLY.agents)).toBe('No other AI agents on this Mac');
    expect(agentsCardVisible(list([claude(), codex()]).agents)).toBe(true);
    expect(agentsCardSummary(list([claude(), codex({ connected: true })]).agents)).toBe(
      'Codex connected'
    );
  });
});

// ── Design Decision 5: attribution ────────────────────────────────────────────────────────────────
describe('attribution', () => {
  const agent = {
    id: 'codex',
    label: 'Codex',
    vendor: 'OpenAI',
    statusUrl: 'https://status.openai.com',
  };
  test('an agent error is its own words, with the status page', () => {
    const m = agentErrorModel({ message: 'Quota exceeded.', agent });
    expect(m?.text).toBe('Codex reported: Quota exceeded.');
    expect(m?.statusUrl).toBe('https://status.openai.com');
  });
  test('policy-violated says the agent was stopped; consent asks; Claude and agent-less errors are not touched', () => {
    expect(agentErrorModel({ message: 'x', code: 'agent-policy-violated', agent })?.text).toBe(
      'Codex was stopped: it did not stay inside Maude’s limits.'
    );
    expect(agentErrorModel({ message: 'x', code: 'agent-needs-consent', agent })?.kind).toBe(
      'consent'
    );
    expect(agentErrorModel({ message: 'x', agent: { id: 'claude', label: 'Claude' } })).toBeNull();
    expect(agentErrorModel({ message: 'x' })).toBeNull();
    // a status page that is not https is never linked
    expect(
      agentErrorModel({ message: 'x', agent: { ...agent, statusUrl: 'javascript:alert(1)' } })
        ?.statusUrl
    ).toBeUndefined();
  });
  test('a refused turn-end is a quiet notice', () => {
    expect(
      refusedNotice({
        t: 'turn-end',
        reason: 'refused',
        notice: 'Codex stopped: Maude refused a write outside the project.',
      })
    ).toBe('Codex stopped: Maude refused a write outside the project.');
    expect(refusedNotice({ t: 'turn-end', reason: 'end_turn' })).toBeNull();
  });
});

// ── Design Decision 6: generic modes ──────────────────────────────────────────────────────────────
describe('modes', () => {
  const codexModes = {
    currentModeId: 'workspace-write',
    availableModes: [
      { id: 'read-only', name: 'Read only', description: 'Reads only.' },
      { id: 'workspace-write', name: 'Workspace', description: 'Writes in the project.' },
      { id: 'agent', name: 'Agent', description: 'Auto review.' },
    ],
  };
  test("another agent's modes keep their own names, order, and the server's allowed list", () => {
    const opts = modeOptions(codexModes, {
      agent: { id: 'codex' },
      allowed: ['read-only', 'workspace-write'],
    });
    expect(opts.map((o) => [o.id, o.label])).toEqual([
      ['read-only', 'Read only'],
      ['workspace-write', 'Workspace'],
    ]);
  });
  test("Claude's ids keep Maude's plain words (Claude unchanged)", () => {
    const opts = modeOptions({
      currentModeId: 'default',
      availableModes: [
        { id: 'plan', name: 'Plan' },
        { id: 'default', name: 'Default' },
      ],
    });
    expect(opts.map((o) => o.label)).toEqual(['Ask before every change', 'Suggest only']);
    // a `plan` mode of another agent is not Claude's suggest-only mode
    expect(modeBanner({ currentModeId: 'plan', availableModes: [{ id: 'plan' }] })).not.toBeNull();
    expect(
      modeBanner({ currentModeId: 'plan', availableModes: [{ id: 'plan' }] }, { id: 'opencode' })
    ).toBeNull();
  });
});

// ── React surfaces ────────────────────────────────────────────────────────────────────────────────
async function mount(node: unknown) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node as never));
  return {
    host,
    q: (id: string) => host.querySelector(`[data-testid="${id}"]`) as HTMLElement | null,
    act,
    unmount: () => act(async () => root.unmount()),
  };
}
const idle = {
  phase: 'idle',
  busyId: null,
  error: null,
  errorId: null,
  connect: () => {},
  cancel: () => {},
};

afterEach(() => {
  document.body.innerHTML = '';
});

describe('AgentOfferLine', () => {
  test('Connect and Not now; Not now dismisses every agent the line names', async () => {
    const { AgentOfferLine } = await import('../client/v2/ai/AgentOffer.jsx');
    const l = list([claude(), codex(), opencode()], ['codex', 'opencode']);
    const dismissed: string[][] = [];
    const opened: number[] = [];
    const m = await mount(
      <AgentOfferLine
        {...l}
        claudeConnected
        conn={idle}
        onDismiss={(ids: string[]) => dismissed.push(ids)}
        onOpenSettings={() => opened.push(1)}
      />
    );
    expect(m.q('ai-agent-offer')?.textContent).toContain('Codex and opencode are on this Mac.');
    await m.act(async () => m.q('ai-agent-offer-dismiss')?.click());
    expect(dismissed).toEqual([['codex', 'opencode']]);
    // two agents: Connect opens Settings › AI agents (the person picks there)
    await m.act(async () => m.q('ai-agent-offer-connect')?.click());
    expect(opened).toEqual([1]);
  });
  test('one agent without a note connects right here, with its progress and Cancel', async () => {
    const { AgentOfferLine } = await import('../client/v2/ai/AgentOffer.jsx');
    const l = list([claude(), codex()], ['codex']);
    const connected: string[] = [];
    const m = await mount(
      <AgentOfferLine
        {...l}
        claudeConnected
        conn={{ ...idle, connect: (r: Row) => connected.push(String(r.id)) }}
      />
    );
    await m.act(async () => m.q('ai-agent-offer-connect')?.click());
    expect(connected).toEqual(['codex']);
    const w = await mount(
      <AgentOfferLine
        {...l}
        claudeConnected
        conn={{ ...idle, phase: 'waiting', busyId: 'codex' }}
      />
    );
    expect(w.q('ai-agent-offer')?.textContent).toContain('Sign in to Codex in your browser…');
    expect(w.q('ai-agent-offer-cancel')).not.toBeNull();
  });
  test('nothing while running', async () => {
    const { AgentOfferLine } = await import('../client/v2/ai/AgentOffer.jsx');
    const m = await mount(
      <AgentOfferLine
        {...list([claude(), codex()], ['codex'])}
        claudeConnected
        running
        conn={idle}
      />
    );
    expect(m.q('ai-agent-offer')).toBeNull();
  });
});

describe('agents-store', () => {
  test('Not now posts dismiss-offer for each agent, then reads the list again', async () => {
    const { dismissAgentOffers } = await import('../client/v2/ai/agents-store.js');
    const calls: string[] = [];
    const fetchImpl = async (url: string, init?: { method?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      return new Response(JSON.stringify({ ok: true, agents: [], offerAgents: [] }));
    };
    await dismissAgentOffers(['codex', 'opencode'], { fetchImpl });
    expect(calls).toEqual([
      'POST /_api/agents/codex/dismiss-offer',
      'POST /_api/agents/opencode/dismiss-offer',
      'GET /_api/agents',
    ]);
  });
  test('connect: a vendor that needs a sign-in signs in, then connects again', async () => {
    const { connectAgentFlow } = await import('../client/v2/ai/agents-store.js');
    const calls: string[] = [];
    let polls = 0;
    const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
      if (url.endsWith('/connect'))
        return Response.json(
          calls.filter((c) => c.includes('/connect')).length === 1
            ? { ok: false, needsSignin: true }
            : { ok: true }
        );
      if (url.endsWith('/signin')) return Response.json({ ok: true });
      if (url.endsWith('/signin-status'))
        return Response.json({ auth: ++polls > 1 ? 'signed-in' : 'signed-out', inFlight: true });
      return Response.json({ agents: [], offerAgents: [] });
    };
    const phases: string[] = [];
    const r = await connectAgentFlow({
      id: 'codex',
      fetchImpl,
      sleep: async () => {},
      onPhase: (p: string) => phases.push(p),
    });
    expect(r).toEqual({ ok: true });
    expect(phases).toEqual(['connecting', 'waiting', 'connecting']);
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([
      'POST /_api/agents/codex/connect',
      'POST /_api/agents/codex/signin',
      'POST /_api/agents/codex/connect',
    ]);
  });
  test('an unrestricted agent connects with consent in the body; Cancel withdraws the sign-in', async () => {
    const { connectAgentFlow } = await import('../client/v2/ai/agents-store.js');
    const calls: string[] = [];
    const ctl = new AbortController();
    const fetchImpl = async (url: string, init?: { method?: string; body?: string }) => {
      calls.push(`${init?.method ?? 'GET'} ${url}${init?.body ? ` ${init.body}` : ''}`);
      if (url.endsWith('/connect')) return Response.json({ ok: false, needsSignin: true });
      if (url.endsWith('/signin')) {
        ctl.abort();
        return Response.json({ ok: true });
      }
      return Response.json({ agents: [], offerAgents: [] });
    };
    const r = await connectAgentFlow({
      id: 'goose',
      consent: true,
      fetchImpl,
      signal: ctl.signal,
      sleep: async () => {},
    });
    expect(r.reason).toBe('cancelled');
    expect(calls[0]).toBe('POST /_api/agents/goose/connect {"consent":true}');
    expect(calls).toContain('POST /_api/agents/goose/signin-cancel');
  });
});

describe('AgentPickerChip', () => {
  test('hidden with one connected agent; a select with two; read-only once the chat started', async () => {
    const { AgentPickerChip } = await import('../client/v2/ai/AgentPicker.jsx');
    const one = await mount(
      <AgentPickerChip agents={list([claude(), codex()]).agents} value="claude" />
    );
    expect(one.q('ai-agent-picker')).toBeNull();
    const two = list([claude(), codex({ connected: true })]).agents;
    const picks: string[] = [];
    const m = await mount(
      <AgentPickerChip agents={two} value="claude" onPick={(v: string) => picks.push(v)} />
    );
    const sel = m.q('ai-agent-picker') as HTMLSelectElement;
    expect(sel.tagName).toBe('SELECT');
    expect([...sel.options].map((o) => o.textContent)).toEqual(['Claude', 'Codex']);
    const locked = await mount(<AgentPickerChip agents={two} value="codex" locked />);
    const chip = locked.q('ai-agent-picker') as HTMLElement;
    expect(chip.tagName).toBe('SPAN');
    expect(chip.textContent).toBe('Codex');
    expect(chip.getAttribute('data-agent')).toBe('codex');
  });
});

describe('the attach frame', () => {
  test('a chosen agent rides attach; Claude leaves the frame exactly as before; a change re-attaches', async () => {
    const sent: string[] = [];
    class FakeWS {
      static OPEN = 1;
      static CONNECTING = 0;
      readyState = 0;
      onopen: (() => void) | null = null;
      onmessage: ((e: { data: string }) => void) | null = null;
      onclose: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor() {
        setTimeout(() => {
          this.readyState = 1;
          this.onopen?.();
        }, 0);
      }
      send(s: string) {
        sent.push(s);
      }
      close() {}
    }
    const real = globalThis.WebSocket;
    (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeWS;
    try {
      const { createAcpConnection } = await import('../client/panels/acp-runtime.js');
      const a = createAcpConnection();
      a.bindChat('c-claude', 3);
      a.setAgent('claude');
      await a.warm?.();
      await new Promise((r) => setTimeout(r, 5));
      expect(JSON.parse(sent[0])).toEqual({ t: 'attach', chat: 'c-claude', seq: 3 });
      sent.length = 0;
      const b = createAcpConnection();
      b.bindChat('c-codex', 0);
      b.setAgent('codex');
      await b.warm?.();
      await new Promise((r) => setTimeout(r, 5));
      expect(JSON.parse(sent[0])).toEqual({ t: 'attach', chat: 'c-codex', seq: 0, agent: 'codex' });
      sent.length = 0;
      b.setAgent('codex', { consent: true });
      expect(JSON.parse(sent[0])).toEqual({
        t: 'attach',
        chat: 'c-codex',
        seq: 0,
        agent: 'codex',
        consent: true,
      });
    } finally {
      (globalThis as unknown as { WebSocket: unknown }).WebSocket = real;
    }
  });
});

describe('Settings › Connections › AI agents', () => {
  test('rows with their states, the note before connecting, and Connect / Disconnect', async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const connects: Array<[string, Row]> = [];
    const disconnects: string[] = [];
    const l = list([claude(), codex({ connected: true, state: 'connected' }), opencode()]);
    const m = await mount(
      <AgentsCardView
        list={l}
        c={{ ...idle, connect: (r: Row, o: Row) => connects.push([String(r.id), o]) }}
        card={() => ({ open: true, onToggle: () => {} })}
        disconnect={async (id: string) => void disconnects.push(id)}
      />
    );
    expect(m.q('settings-agents-card')).not.toBeNull();
    expect(m.q('settings-agent-row-claude')).toBeNull();
    expect(m.q('settings-agent-row-codex')?.textContent).toContain('Connected');
    expect(m.q('settings-agent-note-opencode')?.textContent).toContain('hosted model');
    await m.act(async () => m.q('settings-agent-connect-opencode')?.click());
    expect(connects).toEqual([['opencode', { signinFirst: false }]]);
    await m.act(async () => m.q('settings-agent-disconnect-codex')?.click());
    expect(disconnects).toEqual(['codex']);
  });
  test('an unrestricted agent sits under Advanced and connects only after the consent card', async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const connects: Array<[string, Row]> = [];
    const m = await mount(
      <AgentsCardView
        list={list([claude(), codex(), goose()])}
        c={{ ...idle, connect: (r: Row, o: Row) => connects.push([String(r.id), o]) }}
        card={() => ({ open: true, onToggle: () => {} })}
      />
    );
    expect(m.q('settings-agent-row-goose')).toBeNull(); // folded
    await m.act(async () => m.q('fold-connections.agents-toggle')?.click());
    await m.act(async () => m.q('settings-agent-connect-goose')?.click());
    expect(connects).toEqual([]);
    expect(m.q('settings-agent-consent')?.textContent).toContain(
      'Goose runs without Maude’s file and network limits. Allow it for this project?'
    );
    await m.act(async () => m.q('settings-agent-consent-allow')?.click());
    expect(connects).toEqual([['goose', { consent: true }]]);
  });
});

describe('ConnectSheet and agent cards', () => {
  test('the Connect sheet gains "Use another agent…" only when asked to', async () => {
    const { ConnectSheet } = await import('../client/v2/ai/ConnectSheet.jsx');
    const plain = await mount(<ConnectSheet inline onConnect={() => {}} onCancel={() => {}} />);
    expect(plain.q('connect-other-agent-link')).toBeNull();
    const opened: number[] = [];
    const m = await mount(
      <ConnectSheet
        inline
        onConnect={() => {}}
        onCancel={() => {}}
        onOtherAgent={() => opened.push(1)}
      />
    );
    await m.act(async () => m.q('connect-other-agent-link')?.click());
    expect(opened).toEqual([1]);
  });
  test('an agent error card, the stopped card, and the consent card', async () => {
    const { AgentErrorCard } = await import('../client/v2/ai/AgentNotice.jsx');
    const agent = {
      id: 'codex',
      label: 'Codex',
      vendor: 'OpenAI',
      statusUrl: 'https://status.openai.com',
    };
    const opened: string[] = [];
    const m = await mount(
      <AgentErrorCard
        error={{ message: 'Rate limited.', agent }}
        open={(u: string) => opened.push(u)}
      />
    );
    expect(m.q('ai-agent-error-text')?.textContent).toBe('Codex reported: Rate limited.');
    await m.act(async () => m.q('ai-agent-error-status')?.click());
    expect(opened).toEqual(['https://status.openai.com']);
    const s = await mount(
      <AgentErrorCard error={{ message: 'x', code: 'agent-policy-violated', agent }} />
    );
    expect(s.q('ai-agent-error-text')?.textContent).toBe(
      'Codex was stopped: it did not stay inside Maude’s limits.'
    );
    const ok: string[] = [];
    const c = await mount(
      <AgentErrorCard
        error={{
          message: 'x',
          code: 'agent-needs-consent',
          agent: { id: 'goose', label: 'Goose' },
        }}
        onConsent={(a: { id: string }) => ok.push(a.id)}
      />
    );
    await c.act(async () => c.q('ai-agent-consent-allow')?.click());
    expect(ok).toEqual(['goose']);
  });
});

// ── The pin: Claude-only users see ZERO visual change ─────────────────────────────────────────────
describe('Claude-only', () => {
  test('no offer line, no picker, no Connect-sheet link, no badge; Settings keeps its reference card', async () => {
    const { AgentOfferLine } = await import('../client/v2/ai/AgentOffer.jsx');
    const { AgentPickerChip } = await import('../client/v2/ai/AgentPicker.jsx');
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const { agentBadge } = await import('../client/v2/ai/agents-model.js');
    const m = await mount(
      <>
        <AgentOfferLine {...CLAUDE_ONLY} claudeConnected conn={idle} />
        <AgentPickerChip agents={CLAUDE_ONLY.agents} value="claude" />
      </>
    );
    // the AI panel: nothing at all
    expect(m.host.innerHTML).toBe('');
    // Settings: the always-present reference card, so Claude's own API key option is reachable
    const s = await mount(
      <AgentsCardView
        list={CLAUDE_ONLY}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
      />
    );
    expect(s.q('settings-agents-card')).not.toBeNull();
    expect(s.host.textContent).toContain('No other AI agents on this Mac');
    expect(otherAgentLinkVisible(CLAUDE_ONLY)).toBe(false);
    // the empty chat, wired to the shared list: the hint alone with Claude only, the line once Codex is offered
    const { setAgentsForTest } = await import('../client/v2/ai/agents-store.js');
    const { ChatEmpty } = await import('../client/v2/ai/Suggest.jsx');
    setAgentsForTest({ agents: CLAUDE_ONLY.agents, offerAgents: [] });
    const e = await mount(<ChatEmpty claudeConnected />);
    expect(e.q('ai-hint')).not.toBeNull();
    expect(e.q('ai-agent-offer')).toBeNull();
    await e.act(async () =>
      setAgentsForTest({ agents: [claude(), codex()], offerAgents: ['codex'] })
    );
    expect(e.q('ai-agent-offer')).not.toBeNull();
    setAgentsForTest();
    expect(agentBadge({ id: 'claude', label: 'Claude', vendor: 'Anthropic' })).toBeNull();
    // an older server (or a cell) answers no list at all: the same nothing
    expect(normalizeAgents(null)).toEqual({ agents: [], offerAgents: [] });
  });
});

describe('vendor status page (DDR-054: no general opener on desktop)', () => {
  test('desktop copies the link and opens nothing', async () => {
    const { openStatusPage } = await import('../client/v2/ai/AgentNotice.jsx');
    const copied: string[] = [];
    let opened = 0;
    const r = await openStatusPage('https://status.openai.com', {
      desktop: true,
      copy: async (t: string) => {
        copied.push(t);
      },
      windowOpen: () => {
        opened++;
        return null;
      },
    });
    expect(r).toBe('copied');
    expect(copied).toEqual(['https://status.openai.com']);
    expect(opened).toBe(0);
  });

  test('the browser opens a new tab with noopener', async () => {
    const { openStatusPage } = await import('../client/v2/ai/AgentNotice.jsx');
    const calls: unknown[][] = [];
    const r = await openStatusPage('https://status.openai.com', {
      desktop: false,
      windowOpen: (...a: unknown[]) => {
        calls.push(a);
        return null;
      },
    });
    expect(r).toBe('ok');
    expect(calls[0]).toEqual(['https://status.openai.com', '_blank', 'noopener,noreferrer']);
  });
});
