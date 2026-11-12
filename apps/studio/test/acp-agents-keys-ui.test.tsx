// B7 (DDR-252 § BYOK) — Settings › AI agents › Advanced: "Use an API key" per agent that takes one, and
// Claude's opt-in behind the billing confirm card. Fake keys only; the writes are stubs.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

import { normalizeAgents } from '../client/v2/ai/agents-model.js';
import {
  agentKeyRows,
  keyLooksValid,
  maskedKey,
  saveAgentKey,
} from '../client/v2/settings/agent-keys.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});
afterEach(() => {
  document.body.innerHTML = '';
});

type Row = Record<string, unknown>;
const agent = (id: string, over: Row = {}): Row => ({
  id,
  label: id === 'claude' ? 'Claude' : id === 'codex' ? 'Codex' : id,
  vendor: 'v',
  installed: true,
  policy: 'bridge-enforced',
  connected: id === 'claude',
  state: id === 'claude' ? 'connected' : 'available',
  offer: false,
  acceptsKey: id !== 'opencode',
  keySet: false,
  keyLast4: null,
  ...over,
});
const list = (agents: Row[]) => normalizeAgents({ agents, offerAgents: [] });
const idle = {
  phase: 'idle',
  busyId: null,
  error: null,
  errorId: null,
  connect: () => {},
  cancel: () => {},
};

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
    type: async (id: string, value: string) => {
      const el = host.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      await act(async () => {
        set?.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      });
    },
  };
}

const FAKE = 'sk-test-FAKE-ui-key-5678';

/** Open the Advanced fold (its open state outlives a mount), never toggle it shut. */
async function openFold(m: Awaited<ReturnType<typeof mount>>) {
  const open = () =>
    m.host.querySelector(
      '[data-testid^="settings-agent-keyrow-"], [data-testid="settings-claude-apikey"]'
    );
  if (!open()) await m.act(async () => m.q('fold-connections.agents-toggle')?.click());
  expect(open()).not.toBeNull();
}

describe('agent key model', () => {
  test('rows: installed agents that accept a key; Claude apart; last four only', () => {
    const { keys, claude } = agentKeyRows(
      list([
        agent('claude'),
        agent('codex', { keySet: true, keyLast4: '5678' }),
        agent('opencode'),
        agent('gemini', { installed: false }),
      ]).agents
    );
    expect(keys).toEqual([{ id: 'codex', label: 'Codex', keySet: true, last4: '5678' }]);
    expect(claude).toEqual({ id: 'claude', label: 'Claude', keySet: false, last4: null });
    expect(maskedKey('5678')).toBe('••••5678');
    expect(keyLooksValid(' abc ')).toBe(true);
    for (const bad of ['', 'a b', 'a\nb', 'x'.repeat(513)]) expect(keyLooksValid(bad)).toBe(false);
  });

  test('saveAgentKey posts {key} (and optIn for Claude) and never keeps the key', async () => {
    const calls: Array<[string, unknown]> = [];
    const fetchImpl = async (url: string, init?: RequestInit) => {
      calls.push([url, init?.body ? JSON.parse(String(init.body)) : null]);
      return new Response(
        JSON.stringify(
          url.endsWith('/key') ? { ok: true, keySet: true, keyLast4: '5678' } : { agents: [] }
        )
      );
    };
    expect(await saveAgentKey('codex', FAKE, { fetchImpl: fetchImpl as never })).toEqual({
      ok: true,
      keySet: true,
      keyLast4: '5678',
    });
    await saveAgentKey('claude', FAKE, { optIn: true, fetchImpl: fetchImpl as never });
    expect(calls.filter(([u]) => u.endsWith('/key'))).toEqual([
      ['/_api/agents/codex/key', { key: FAKE }],
      ['/_api/agents/claude/key', { key: FAKE, optIn: true }],
    ]);
  });
});

describe('Settings › AI agents › Advanced: own API keys', () => {
  test('masked input + Save for Codex; ••••last4 + Remove once set; nothing for opencode', async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const saved: Array<[string, string, unknown]> = [];
    const removed: string[] = [];
    const m = await mount(
      <AgentsCardView
        list={list([agent('claude'), agent('codex'), agent('opencode')])}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
        saveKey={async (id: string, key: string, o: unknown) => {
          saved.push([id, key, o]);
          return { ok: true };
        }}
        removeKey={async (id: string) => {
          removed.push(id);
          return { ok: true };
        }}
      />
    );
    expect(m.q('settings-agent-key-codex')).toBeNull(); // folded
    await openFold(m);
    const input = m.q('settings-agent-key-codex') as HTMLInputElement;
    expect(input.type).toBe('password');
    expect(m.q('settings-agent-key-opencode')).toBeNull();
    expect((m.q('settings-agent-key-save-codex') as HTMLButtonElement).disabled).toBe(true);
    await m.type('settings-agent-key-codex', ` ${FAKE} `);
    await m.act(async () => m.q('settings-agent-key-save-codex')?.click());
    expect(saved).toEqual([['codex', FAKE, undefined]]);
    expect((m.q('settings-agent-key-codex') as HTMLInputElement).value).toBe('');
    expect(m.host.innerHTML).not.toContain(FAKE);

    const set = await mount(
      <AgentsCardView
        list={list([agent('claude'), agent('codex', { keySet: true, keyLast4: '5678' })])}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
        saveKey={async () => ({ ok: true })}
        removeKey={async (id: string) => {
          removed.push(id);
          return { ok: true };
        }}
      />
    );
    await openFold(set);
    expect(set.q('settings-agent-keystate-codex')?.textContent).toContain('••••5678');
    expect(set.q('settings-agent-key-codex')).toBeNull();
    await set.act(async () => set.q('settings-agent-key-remove-codex')?.click());
    expect(removed).toEqual(['codex']);
  });

  test('a refused save shows the reason in words', async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const m = await mount(
      <AgentsCardView
        list={list([agent('claude'), agent('codex')])}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
        saveKey={async () => ({ ok: false, reason: 'invalid-key' })}
      />
    );
    await openFold(m);
    await m.type('settings-agent-key-codex', 'abc');
    await m.act(async () => m.q('settings-agent-key-save-codex')?.click());
    expect(m.q('settings-agent-key-error-codex')?.textContent).toContain(
      'does not look like an API key'
    );
  });

  test("Claude's opt-in: off by default; the billing card first; then the key saves with optIn", async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const saved: Array<[string, string, unknown]> = [];
    const m = await mount(
      <AgentsCardView
        list={list([agent('claude'), agent('codex')])}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
        saveKey={async (id: string, key: string, o: unknown) => {
          saved.push([id, key, o]);
          return { ok: true };
        }}
      />
    );
    await openFold(m);
    const sw = m.q('settings-claude-apikey-optin') as HTMLInputElement;
    expect(sw.checked).toBe(false);
    expect(m.q('settings-agent-key-claude')).toBeNull();
    await m.act(async () => sw.click());
    expect(m.q('settings-claude-apikey-confirm')?.textContent).toContain(
      'billed to that API account'
    );
    expect(m.q('settings-agent-key-claude')).toBeNull(); // not before the yes
    // Cancel leaves it off
    await m.act(async () => m.q('settings-claude-apikey-cancel')?.click());
    expect(m.q('settings-claude-apikey-confirm')).toBeNull();
    expect((m.q('settings-claude-apikey-optin') as HTMLInputElement).checked).toBe(false);
    // the yes reveals the key input
    await m.act(async () => (m.q('settings-claude-apikey-optin') as HTMLInputElement).click());
    await m.act(async () => m.q('settings-claude-apikey-confirm-yes')?.click());
    await m.type('settings-agent-key-claude', FAKE);
    await m.act(async () => m.q('settings-agent-key-save-claude')?.click());
    expect(saved).toEqual([['claude', FAKE, { optIn: true }]]);
  });

  test('Claude opted in: switch on, ••••last4; turning it off removes the key', async () => {
    const { AgentsCardView } = await import('../client/v2/settings/agents-card.jsx');
    const removed: string[] = [];
    const m = await mount(
      <AgentsCardView
        list={list([agent('claude', { keySet: true, keyLast4: 'WXYZ' }), agent('codex')])}
        c={idle}
        card={() => ({ open: true, onToggle: () => {} })}
        removeKey={async (id: string) => {
          removed.push(id);
          return { ok: true };
        }}
      />
    );
    await openFold(m);
    expect((m.q('settings-claude-apikey-optin') as HTMLInputElement).checked).toBe(true);
    expect(m.q('settings-claude-apikey')?.textContent).toContain('••••WXYZ');
    await m.act(async () => (m.q('settings-claude-apikey-optin') as HTMLInputElement).click());
    expect(removed).toEqual(['claude']);
  });
});
