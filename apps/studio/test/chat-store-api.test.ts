// S5.7 — Open in terminal is the desktop app's: hidden AND refused anywhere else
// (decision v2-S5-open-in-terminal-native). The client door checks the registry's own predicate.

import { describe, expect, test } from 'bun:test';

import { ACTIONS_BY_ID } from '../actions/index.ts';
import { isVisible } from '../actions/resolve.ts';
import type { KeyCtx, Shell } from '../actions/types.ts';
import {
  canOpenInTerminal,
  fetchChats,
  openChatInTerminal,
  trashChat,
} from '../client/v2/ai/chat-store-api.js';

const ctx = (shell: Shell, native = false, role: KeyCtx['role'] = 'owner'): KeyCtx => ({
  role,
  shell,
  mode: 'edit',
  focus: 'chrome',
  selection: 'none',
  facts: new Set(native ? (['native'] as const) : []),
});

function tauriSpy() {
  const calls: Array<[string, unknown]> = [];
  return {
    calls,
    tauri: { core: { invoke: async (cmd: string, args: unknown) => void calls.push([cmd, args]) } },
  };
}
const session = (sessionId: unknown) => async () =>
  new Response(JSON.stringify({ sessionId }), { status: 200 });

describe('chat.open-in-terminal', () => {
  test('is a native action, human `native-window`, offered in the desktop app only', () => {
    const def = ACTIONS_BY_ID.get('chat.open-in-terminal');
    expect(def?.exec).toBe('native');
    expect(isVisible(def as never, ctx('desktop', true))).toBe(true);
    for (const shell of ['browser', 'cloud', 'viewer', 'embed', 'home'] as const)
      expect(isVisible(def as never, ctx(shell, shell === 'home'))).toBe(false);
    // a desktop shell with no Tauri bridge (a browser pointed at the desktop server) is not it either
    expect(isVisible(def as never, ctx('desktop', false))).toBe(false);
  });

  test('a browser shell is refused: nothing is fetched, nothing is invoked', async () => {
    const { tauri, calls } = tauriSpy();
    let fetched = 0;
    const r = await openChatInTerminal({
      ctx: ctx('browser'),
      chatId: 'c1',
      tauri,
      fetchImpl: async () => {
        fetched++;
        return session('s1')();
      },
    });
    expect(r).toEqual({ ok: false, reason: 'desktop-only' });
    expect(fetched).toBe(0);
    expect(calls).toEqual([]);
  });

  test('the desktop app with no Tauri bridge is refused too', async () => {
    const r = await openChatInTerminal({
      ctx: ctx('desktop', true),
      chatId: 'c1',
      tauri: null,
      fetchImpl: session('s1'),
    });
    expect(r).toEqual({ ok: false, reason: 'desktop-only' });
  });

  test("desktop: resumes the chat's own session through the Tauri command", async () => {
    const { tauri, calls } = tauriSpy();
    const r = await openChatInTerminal({
      ctx: ctx('desktop', true),
      chatId: 'c1',
      tauri,
      fetchImpl: session('sess-123'),
    });
    expect(r).toEqual({ ok: true });
    expect(calls).toEqual([['chat_open_in_terminal', { sessionId: 'sess-123' }]]);
  });

  test('a chat that never reached Claude has no session: nothing to resume', async () => {
    const { tauri, calls } = tauriSpy();
    const r = await openChatInTerminal({
      ctx: ctx('desktop', true),
      chatId: 'c1',
      tauri,
      fetchImpl: session(null),
    });
    expect(r).toEqual({ ok: false, reason: 'no-session' });
    expect(calls).toEqual([]);
  });

  test('canOpenInTerminal is the registry predicate', () => {
    expect(canOpenInTerminal(ctx('desktop', true))).toBe(true);
    expect(canOpenInTerminal(ctx('browser'))).toBe(false);
  });
});

describe('the list and trash doors', () => {
  test('fetchChats builds the query the legacy list key reads', async () => {
    const urls: string[] = [];
    const fetchImpl = async (u: string) => {
      urls.push(u);
      return new Response('[]');
    };
    await fetchChats({ fetchImpl });
    await fetchChats({ group: 'canvas', fetchImpl });
    await fetchChats({ trashed: true, fetchImpl });
    expect(urls).toEqual([
      '/_api/acp/chats',
      '/_api/acp/chats?group=canvas',
      '/_api/acp/chats?trashed=1',
    ]);
  });

  test('trashChat posts the id and hands back what was dropped', async () => {
    let seen: { url: string; body: unknown } | null = null;
    const r = await trashChat('c1', {
      fetchImpl: async (url: string, init: RequestInit) => {
        seen = { url, body: JSON.parse(String(init.body)) };
        return new Response(JSON.stringify({ ok: true, droppedPrompts: 1 }));
      },
    });
    expect(seen).toEqual({ url: '/_api/acp/chats/trash', body: { id: 'c1' } });
    expect(r.ok && r.body.droppedPrompts).toBe(1);
  });
});
