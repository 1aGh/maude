// S5.15 — "Made by AI" derived from `project:action` (cleared by the next person's change), and "Undo this chat"
// from Version history's AI row (disabled with the update line on an old team server, U22).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  if (typeof document === 'undefined') GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(async () => {
  if (GlobalRegistrator.isRegistered) await GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { CHAT_UNDO_WORDS, ChatUndoButton, undoChat } from '../client/v2/ai/ChatUndo.jsx';
import {
  createMadeByAiStore,
  EMPTY_MADE_BY_AI,
  isMadeByAi,
  madeByAiRings,
  reduceMadeByAi,
} from '../client/v2/ai/made-by-ai.js';

const C = 'ui/k.tsx';
const FILE = '.design/ui/k.tsx';
const ev = (o: Record<string, unknown>) => ({
  actor: 'you@x',
  mine: true,
  canvases: [C],
  artboards: {},
  ...o,
});

describe('Made by AI is derived from project:action (V2-1.5 decision 7)', () => {
  test('your AI marks what it changed; your next edit of an artboard clears only that one (U24)', () => {
    let s = reduceMadeByAi(
      EMPTY_MADE_BY_AI,
      ev({ actionId: 'a1', kind: 'ai', artboards: { [C]: ['p', 's'] } })
    );
    expect(isMadeByAi(s, FILE, 'p')).toBe(true);
    expect(isMadeByAi(s, FILE, 's')).toBe(true);
    s = reduceMadeByAi(s, ev({ actionId: 'a2', kind: 'edit', artboards: { [C]: ['p'] } }));
    expect(isMadeByAi(s, FILE, 'p')).toBe(false);
    expect(isMadeByAi(s, FILE, 's')).toBe(true);
    expect(madeByAiRings(s, FILE)).toEqual({
      s: { state: 'done', who: 'you', tag: 'Made by AI', waiting: 0 },
    });
  });

  test("a teammate's AI shows their face; their later edit clears it; a comment changes nothing", () => {
    let s = reduceMadeByAi(
      EMPTY_MADE_BY_AI,
      ev({ actionId: 'b1', kind: 'ai', actor: 'tereza@x', mine: false, artboards: { [C]: ['s'] } })
    );
    expect(madeByAiRings(s, FILE).s?.who).toBe('tereza@x');
    const same = reduceMadeByAi(
      s,
      ev({ actionId: 'b2', kind: 'comment', artboards: { [C]: ['s'] } })
    );
    expect(same).toBe(s);
    s = reduceMadeByAi(
      s,
      ev({
        actionId: 'b3',
        kind: 'edit',
        actor: 'tereza@x',
        mine: false,
        artboards: { [C]: ['s'] },
      })
    );
    expect(madeByAiRings(s, FILE)).toEqual({});
  });

  test('an undo of the run clears it (its own event names no artboards); ⇧⌘Z of that undo marks it again', () => {
    let s = reduceMadeByAi(
      EMPTY_MADE_BY_AI,
      ev({ actionId: 'r1', kind: 'ai', artboards: { [C]: ['p'] } })
    );
    s = reduceMadeByAi(s, ev({ actionId: 'u1', kind: 'undo', undoes: ['r1'] }));
    expect(isMadeByAi(s, FILE, 'p')).toBe(false);
    s = reduceMadeByAi(s, ev({ actionId: 'x1', kind: 'redo', undoes: 'u1' }));
    expect(isMadeByAi(s, FILE, 'p')).toBe(true);
  });

  test('a newer AI run on the artboard owns it: undoing the older one leaves it Made by AI', () => {
    let s = reduceMadeByAi(
      EMPTY_MADE_BY_AI,
      ev({ actionId: 'r1', kind: 'ai', artboards: { [C]: ['p'] } })
    );
    s = reduceMadeByAi(s, ev({ actionId: 'r2', kind: 'ai', artboards: { [C]: ['p'] } }));
    s = reduceMadeByAi(s, ev({ actionId: 'u1', kind: 'undo', undoes: ['r1'] }));
    expect(isMadeByAi(s, FILE, 'p')).toBe(true);
  });

  test('the ring relay sends Made by AI to the open canvas and takes it away on the next edit', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    const runs = createRunsStore({
      fetchImpl: (async () =>
        new Response(JSON.stringify({ seq: 1, mine: [], others: [] }))) as unknown as typeof fetch,
      target: new EventTarget() as unknown as Window,
    });
    const made = createMadeByAiStore();
    document.body.innerHTML = '';
    const iframe = document.createElement('iframe');
    iframe.setAttribute('data-testid', 'canvas-frame');
    // V2-8.9 L2: the relay posts to the frame's origin (a property, so happy-dom loads nothing)
    Object.defineProperty(iframe, 'src', { value: 'http://127.0.0.1:4401/_canvas-shell.html' });
    iframe.setAttribute('data-path', FILE);
    const sent: unknown[] = [];
    Object.defineProperty(iframe, 'contentWindow', {
      value: { postMessage: (m: unknown) => sent.push(m) },
    });
    document.body.append(iframe);
    const stop = createRingsLane({ store: runs, madeByAi: made, doc: document, win: window });
    made.note(ev({ actionId: 'a1', kind: 'ai', artboards: { [C]: ['p'] } }));
    expect(sent.at(-1)).toEqual({
      dgn: 'ai-runs',
      artboards: { p: { state: 'done', who: 'you', tag: 'Made by AI', waiting: 0 } },
    });
    made.note(ev({ actionId: 'a2', kind: 'edit', artboards: { [C]: ['p'] } }));
    expect(sent.at(-1)).toEqual({ dgn: 'ai-runs', artboards: {} });
    stop();
  });
});

describe('Undo this chat (V2-1.5 §5.3 chat.undo)', () => {
  const answer = (status: number, body: unknown) =>
    (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  test('one POST {chatId, via: panel}; the words say one new version; an old server answers its line', async () => {
    const asked: unknown[] = [];
    const ok = (async (_u: string, init: RequestInit) => {
      asked.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true, actionId: 'u1', undoes: ['a', 'b'] }));
    }) as unknown as typeof fetch;
    expect(await undoChat('c1', { fetchImpl: ok })).toMatchObject({
      ok: true,
      words: CHAT_UNDO_WORDS.done,
    });
    expect(asked).toEqual([{ chatId: 'c1', via: 'panel' }]);
    const line = 'Undo this chat needs the team server to be updated';
    expect(
      await undoChat('c1', {
        fetchImpl: answer(409, { ok: false, reason: 'needs-hub-update', line }),
      })
    ).toMatchObject({ ok: false, disabled: line, words: line });
    expect(
      (await undoChat('c1', { fetchImpl: answer(409, { ok: false, reason: 'nothing-to-undo' }) }))
        .words
    ).toBe(CHAT_UNDO_WORDS.nothing);
  });

  const vhRow = {
    id: 'a43',
    ref: 'r43',
    kind: 'ai',
    chatId: 'c1',
    who: { kind: 'ai', actor: 'ai:you', name: 'AI', you: true },
  };

  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(el);
      await new Promise((r) => setTimeout(r, 10));
    });
    return { host, root };
  }

  test('Version history: your AI row offers it; an old team server disables it with the line (U22)', async () => {
    const line = 'Undo this chat needs the team server to be updated';
    const old = (async () =>
      new Response(
        JSON.stringify({ ok: true, history: [], chatUndo: { ok: false, line } })
      )) as unknown as typeof fetch;
    const { host, root } = await mount(<ChatUndoButton row={vhRow} canEdit fetchImpl={old} />);
    const b = host.querySelector('[data-testid="vh-undo-chat"]') as HTMLButtonElement;
    expect(b.textContent).toBe('Undo this chat');
    expect(b.disabled).toBe(true);
    expect(host.querySelector('[data-testid="vh-undo-chat-line"]')?.textContent).toBe(line);
    await act(async () => root.unmount());
  });

  test('a click undoes the chat once and reports it; not for a teammate’s row or Can view', async () => {
    const posts: unknown[] = [];
    const toasts: unknown[] = [];
    const f = (async (_u: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        posts.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ ok: true, actionId: 'u1' }));
      }
      return new Response(JSON.stringify({ ok: true, history: [], chatUndo: { ok: true } }));
    }) as unknown as typeof fetch;
    let changed = 0;
    const { host, root } = await mount(
      <ChatUndoButton
        row={vhRow}
        canEdit
        fetchImpl={f}
        toast={(m: unknown, ok: unknown) => toasts.push([m, ok])}
        onDone={() => changed++}
      />
    );
    const b = host.querySelector('[data-testid="vh-undo-chat"]') as HTMLButtonElement;
    expect(b.disabled).toBe(false);
    await act(async () => {
      b.click();
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(posts).toEqual([{ chatId: 'c1', via: 'panel' }]);
    expect(toasts).toEqual([[CHAT_UNDO_WORDS.done, true]]);
    expect(changed).toBe(1);
    await act(async () => root.unmount());
    const theirs = await mount(
      <ChatUndoButton row={{ ...vhRow, who: { ...vhRow.who, you: false } }} canEdit fetchImpl={f} />
    );
    expect(theirs.host.querySelector('[data-testid="vh-undo-chat"]')).toBeNull();
    const viewer = await mount(<ChatUndoButton row={vhRow} canEdit={false} fetchImpl={f} />);
    expect(viewer.host.querySelector('[data-testid="vh-undo-chat"]')).toBeNull();
    await act(async () => {
      theirs.root.unmount();
      viewer.root.unmount();
    });
  });
});
