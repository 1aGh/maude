// S6.3 — `maude:ai-send`: a sentence from outside goes into a NEW chat and is sent through the composer.
// The relay is exercised on a stand-in panel that behaves like ChatPanel (New chat mounts a fresh field, the send
// button wakes on input); the island test mounts the real AiChatIsland and checks it hears the event.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register({ url: 'http://localhost:4399/' });
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
afterEach(() => {
  document.body.innerHTML = '';
  (globalThis as Record<string, unknown>).__maudeAiSendPending = undefined;
});

const CANVAS = '.design/ui/Landing page.tsx';
const SENTENCE = 'A calm landing page for a Brno architecture studio';

type Opts = { folded?: boolean; frame?: string | null; draft?: string; frameAfterMs?: number };

/** A panel shaped like ChatPanel's: header New chat, one field per chat (others hidden), a send that wakes on input. */
function stage(o: Opts = {}) {
  const sent: Array<{ chat: number; text: string }> = [];
  const island = document.createElement('aside');
  island.className = 'ai-island';
  if (o.folded) island.style.display = 'none';
  let chats = 0;
  const addChat = () => {
    for (const p of island.querySelectorAll<HTMLElement>('.chat-panel')) p.style.display = 'none';
    const n = ++chats;
    const panel = document.createElement('div');
    panel.className = 'chat-panel';
    const ta = document.createElement('textarea');
    ta.className = 'chat-input';
    if (n === 1 && o.draft) ta.value = o.draft;
    const send = document.createElement('button');
    send.className = 'chat-send';
    send.disabled = !ta.value.trim();
    ta.addEventListener('input', () => {
      send.disabled = !ta.value.trim();
    });
    send.addEventListener('click', () => {
      sent.push({ chat: n, text: ta.value });
      ta.value = '';
      send.disabled = true;
    });
    panel.append(ta, send);
    island.append(panel);
  };
  const header = document.createElement('div');
  const newBtn = document.createElement('button');
  newBtn.dataset.testid = 'ai-chat-new';
  newBtn.addEventListener('click', addChat);
  header.append(newBtn);
  island.append(header);
  addChat();
  document.body.append(island);
  if (o.frame !== null) {
    const showFrame = () => {
      const f = document.createElement('iframe');
      f.dataset.testid = 'canvas-frame';
      f.setAttribute('data-path', o.frame ?? CANVAS);
      document.body.append(f);
    };
    if (o.frameAfterMs) setTimeout(showFrame, o.frameAfterMs);
    else showFrame();
  }
  let opened = 0;
  const onOpen = () => {
    opened++;
    island.style.display = '';
  };
  window.addEventListener('maude:open-ai', onOpen);
  return {
    island,
    sent,
    opened: () => opened,
    stop: () => window.removeEventListener('maude:open-ai', onOpen),
  };
}

describe('S6.3 parseAiSend / sendToAi — the detail is untrusted', () => {
  test('a clean detail passes; the canvas must look like a canvas path', async () => {
    const { parseAiSend } = await import('../client/v2/ai/ai-send.js');
    expect(
      parseAiSend({ prompt: ` ${SENTENCE} `, scope: { canvas: CANVAS }, newChat: true })
    ).toEqual({
      prompt: SENTENCE,
      canvas: CANVAS,
      newChat: true,
    });
    expect(parseAiSend({ prompt: 'hi' })).toEqual({ prompt: 'hi', canvas: null, newChat: false });
    for (const canvas of [
      '',
      '../x.tsx',
      '.design/../../etc/passwd.tsx',
      'notes.txt',
      '/a\n.tsx',
      7,
      `${'a'.repeat(600)}.tsx`,
    ]) {
      expect(parseAiSend({ prompt: 'hi', scope: { canvas } })).toBeNull();
    }
  });

  test('no prompt, a non-string prompt, or one over 4000 characters is refused', async () => {
    const { parseAiSend } = await import('../client/v2/ai/ai-send.js');
    for (const prompt of ['', '   ', 5, null, undefined, 'x'.repeat(4001)]) {
      expect(parseAiSend({ prompt })).toBeNull();
    }
    expect(parseAiSend({ prompt: 'x'.repeat(4000) })).not.toBeNull();
    expect(parseAiSend(null)).toBeNull();
    expect(parseAiSend('hello')).toBeNull();
  });

  test('sendToAi fires the event once with the clean detail and parks it for a panel that mounts later', async () => {
    const { sendToAi, takePendingAiSend, AI_SEND_EVENT } = await import(
      '../client/v2/ai/ai-send.js'
    );
    const heard: unknown[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail);
    window.addEventListener(AI_SEND_EVENT, on);
    expect(sendToAi({ prompt: ' hi ', newChat: true })).toBe(true);
    expect(sendToAi({ prompt: '' })).toBe(false);
    window.removeEventListener(AI_SEND_EVENT, on);
    expect(heard).toEqual([{ prompt: 'hi', canvas: null, newChat: true }]);
    expect(takePendingAiSend()).toEqual({ prompt: 'hi', canvas: null, newChat: true });
    expect(takePendingAiSend()).toBeNull();
  });
});

describe('S6.3 relayAiSend — the composer path', () => {
  test('New chat, the sentence typed in the fresh field, send pressed once — and nowhere else', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage({ draft: 'half a thought' });
    const out = await relayAiSend(s.island, { prompt: SENTENCE, canvas: CANVAS, newChat: true });
    expect(out).toEqual({ ok: true });
    expect(s.sent).toEqual([{ chat: 2, text: SENTENCE }]);
    // the first chat's draft was not touched
    expect((s.island.querySelector('.chat-panel textarea') as HTMLTextAreaElement).value).toBe(
      'half a thought'
    );
    s.stop();
  });

  test('a folded panel is opened first; waiting for the canvas that is not in front yet', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage({ folded: true, frameAfterMs: 60 });
    const t0 = Date.now();
    const out = await relayAiSend(s.island, { prompt: SENTENCE, canvas: CANVAS, newChat: true });
    expect(out).toEqual({ ok: true });
    expect(s.opened()).toBe(1);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
    expect(s.sent).toHaveLength(1);
    s.stop();
  });

  test('another canvas in front: the sentence is left in the field, UNSENT (the context would be wrong)', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage({ frame: '.design/ui/Other.tsx' });
    const out = await relayAiSend(
      s.island,
      { prompt: SENTENCE, canvas: CANVAS, newChat: true },
      { timeoutMs: 120 }
    );
    expect(out).toEqual({ ok: false, reason: 'canvas' });
    expect(s.sent).toEqual([]);
    const fields = [...s.island.querySelectorAll<HTMLTextAreaElement>('textarea')];
    expect(fields.at(-1)?.value).toBe(SENTENCE);
    s.stop();
  });

  test('without newChat a draft the person is typing is never overwritten', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage({ draft: 'my own words' });
    const out = await relayAiSend(s.island, { prompt: SENTENCE, canvas: null, newChat: false });
    expect(out).toEqual({ ok: false, reason: 'draft' });
    expect(s.sent).toEqual([]);
    expect((s.island.querySelector('textarea') as HTMLTextAreaElement).value).toBe('my own words');
    s.stop();
  });

  test('without newChat an empty open chat takes the sentence', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage();
    expect(await relayAiSend(s.island, { prompt: SENTENCE, canvas: null, newChat: false })).toEqual(
      { ok: true }
    );
    expect(s.sent).toEqual([{ chat: 1, text: SENTENCE }]);
    s.stop();
  });

  test('no panel, or a panel that never opens, is a named failure and sends nothing', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    expect(await relayAiSend(null, { prompt: 'hi', canvas: null, newChat: true })).toEqual({
      ok: false,
      reason: 'panel',
    });
    const s = stage({ folded: true });
    s.stop(); // nobody opens it
    const out = await relayAiSend(
      s.island,
      { prompt: 'hi', canvas: null, newChat: true },
      { timeoutMs: 80 }
    );
    expect(out).toEqual({ ok: false, reason: 'panel' });
    expect(s.sent).toEqual([]);
  });

  test('the sentence is data: markup in it is a string in the field, never parsed, and never a selector', async () => {
    const { relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage();
    const evil = '"><img src=x onerror=alert(1)>[data-testid="ai-chat-new"] {}';
    expect(await relayAiSend(s.island, { prompt: evil, canvas: CANVAS, newChat: true })).toEqual({
      ok: true,
    });
    expect(s.sent[0].text).toBe(evil);
    expect(document.querySelector('img')).toBeNull();
    s.stop();
  });

  test('two sends in the same tick take turns (queueAiSend): two chats, two sentences', async () => {
    const { queueAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage();
    const [a, b] = await Promise.all([
      queueAiSend(s.island, { prompt: 'one', canvas: CANVAS, newChat: true }, { timeoutMs: 800 }),
      queueAiSend(s.island, { prompt: 'two', canvas: CANVAS, newChat: true }, { timeoutMs: 800 }),
    ]);
    expect([a.ok, b.ok]).toEqual([true, true]);
    expect(s.sent).toEqual([
      { chat: 2, text: 'one' },
      { chat: 3, text: 'two' },
    ]);
    s.stop();
  });

  test('from the intent to the send click in under 1.5 s (a fake agent, 30 ms per round trip)', async () => {
    const { runIntent } = await import('../client/v2/create/take-intent.js');
    const { AI_SEND_EVENT, parseAiSend, relayAiSend } = await import('../client/v2/ai/ai-send.js');
    const s = stage({ frame: null });
    let clicked = 0;
    s.island.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList?.contains('chat-send')) clicked = performance.now();
    });
    // the island's job, as AiChatIsland does it
    const on = (e: Event) => {
      const d = parseAiSend((e as CustomEvent).detail);
      if (d) void relayAiSend(s.island, d);
    };
    window.addEventListener(AI_SEND_EVENT, on);
    const lag = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const t0 = performance.now();
    const out = await runIntent(
      { kind: 'create-canvas', prompt: SENTENCE },
      {
        canEdit: () => true,
        roleDenial: '',
        toast: () => {},
        runAction: () => {},
        fetchImpl: (async () => {
          await lag(30);
          return new Response(JSON.stringify({ ok: true, file: CANVAS }), { status: 200 });
        }) as unknown as typeof fetch,
        // the shell opens the tab: the active frame appears one render later
        open: (file: string) =>
          setTimeout(() => {
            const f = document.createElement('iframe');
            f.dataset.testid = 'canvas-frame';
            f.setAttribute('data-path', file);
            document.body.append(f);
          }, 30),
      }
    );
    expect(out.ok).toBe(true);
    await new Promise<void>((resolve) => {
      const t = setInterval(() => {
        if (s.sent.length) {
          clearInterval(t);
          resolve();
        }
      }, 5);
    });
    window.removeEventListener(AI_SEND_EVENT, on);
    expect(s.sent).toEqual([{ chat: 2, text: SENTENCE }]);
    expect(clicked - t0).toBeLessThan(1500);
    s.stop();
  });
});

describe('S6.3 AiChatIsland hears maude:ai-send', () => {
  test('the real island relays an event, and one parked before it mounted', async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AiChatIsland } = await import('../client/v2/ai/AiChatIsland.jsx');
    const { sendToAi } = await import('../client/v2/ai/ai-send.js');
    const sent: string[] = [];
    // a panel body that wires itself like ChatPanel: New chat adds a field, send reports it
    function Body() {
      const [n, setN] = React.useState(1);
      const [text, setText] = React.useState<Record<number, string>>({});
      return (
        <>
          <button type="button" data-testid="ai-chat-new" onClick={() => setN((v) => v + 1)}>
            new
          </button>
          {Array.from({ length: n }, (_, i) => i + 1).map((id) => (
            <div className="chat-panel" key={id} style={{ display: id === n ? undefined : 'none' }}>
              <textarea
                className="chat-input"
                value={text[id] ?? ''}
                onChange={(e) => setText((t) => ({ ...t, [id]: e.target.value }))}
              />
              <button
                type="button"
                className="chat-send"
                disabled={!(text[id] ?? '').trim()}
                onClick={() => sent.push(text[id])}
              >
                send
              </button>
            </div>
          ))}
        </>
      );
    }
    // the relay is real-time (polling); wait for it instead of guessing a delay
    const settled = (n: number) =>
      act(async () => {
        for (let i = 0; i < 200 && sent.length < n; i++)
          await new Promise((r) => setTimeout(r, 20));
      });
    document.body.innerHTML = '<div id="host"></div>';
    const iframe = document.createElement('iframe');
    iframe.dataset.testid = 'canvas-frame';
    iframe.setAttribute('data-path', CANVAS);
    document.body.append(iframe);
    // parked BEFORE the island mounts
    sendToAi({ prompt: 'parked sentence', scope: { canvas: CANVAS }, newChat: true });
    const root = createRoot(document.getElementById('host') as HTMLElement);
    await act(async () => {
      root.render(
        <AiChatIsland hidden={false}>
          <Body />
        </AiChatIsland>
      );
    });
    await settled(1);
    expect(sent).toEqual(['parked sentence']);
    // and a live event, on top of that
    await act(async () => {
      sendToAi({ prompt: 'live sentence', scope: { canvas: CANVAS }, newChat: true });
    });
    await settled(2);
    expect(sent).toEqual(['parked sentence', 'live sentence']);
    await act(async () => root.unmount());
  });
});
