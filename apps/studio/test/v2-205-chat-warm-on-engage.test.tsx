// 2.0.5 B - the chat panel started the claude adapter on EVERY load: a visible panel sent `warm` as it mounted, so each
// webview reload spawned another `claude` process (4 in 8 minutes). `warm` is for a person who engages: they focus the
// composer, start typing or send. Mounting the real ChatPanel against a stand-in socket, count the `warm` frames.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const frames: Array<Record<string, unknown>> = [];

class FakeSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string) {
    queueMicrotask(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(data: string) {
    frames.push(JSON.parse(data));
  }
  close() {
    this.readyState = 3;
  }
  addEventListener() {}
  removeEventListener() {}
}

const reply = (body: unknown) =>
  Promise.resolve(
    new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
  );

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  (globalThis as unknown as { WebSocket: unknown }).WebSocket = FakeSocket;
  (globalThis as unknown as { fetch: unknown }).fetch = (input: unknown) => {
    const url = String(input);
    if (url.includes('/_api/acp/status')) return reply({ available: true });
    if (url.includes('/_api/acp/chats')) return reply({ chats: [] });
    return reply({});
  };
});
afterAll(async () => {
  await new Promise((r) => setTimeout(r, 100)); // let React's last scheduled work drain before the DOM goes
  GlobalRegistrator.unregister();
});

const settle = async (act: (f: () => Promise<void>) => Promise<void>) => {
  for (let i = 0; i < 4; i++) await act(async () => new Promise((r) => setTimeout(r, 20)));
};

beforeEach(() => {
  frames.length = 0;
  document.body.innerHTML = '';
});

describe('the chat panel starts the AI adapter only when the person engages', () => {
  test('mounting the panel visible sends no warm; focusing the composer sends exactly one', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const ChatPanel = (await import('../client/panels/ChatPanel.jsx')).default;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ChatPanel activeCanvas={null} selected={[]} designRel=".design" hidden={false} />
      );
    });
    await settle(act);
    // the panel is up and its first chat is on screen ...
    const input = document.querySelector('textarea.chat-input') as HTMLTextAreaElement | null;
    expect(input).not.toBeNull();
    // ... and has not spawned anything, however many times it re-rendered
    expect(frames.filter((f) => f.t === 'warm')).toEqual([]);

    await act(async () => {
      input?.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));
      input?.dispatchEvent(new window.FocusEvent('focusin', { bubbles: true }));
    });
    await settle(act);
    expect(frames.filter((f) => f.t === 'warm')).toHaveLength(1);

    // focusing again, then typing, is still the one warm
    await act(async () => {
      input?.dispatchEvent(new window.FocusEvent('focus', { bubbles: true }));
      input?.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(act);
    expect(frames.filter((f) => f.t === 'warm')).toHaveLength(1);
    root.unmount();
  });

  test('starting to type (no focus event first) wakes it, once', async () => {
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const ChatPanel = (await import('../client/panels/ChatPanel.jsx')).default;
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <ChatPanel activeCanvas={null} selected={[]} designRel=".design" hidden={false} />
      );
    });
    await settle(act);
    expect(frames.filter((f) => f.t === 'warm')).toEqual([]);
    const input = document.querySelector('textarea.chat-input') as HTMLTextAreaElement;
    await act(async () => {
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
    await settle(act);
    expect(frames.filter((f) => f.t === 'warm')).toHaveLength(1);
    root.unmount();
  });
});
