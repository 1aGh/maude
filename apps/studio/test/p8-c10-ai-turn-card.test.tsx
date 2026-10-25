// P8 c10 (03 `ai-long`): an EARLIER reply that changed the canvas draws its own result card — the Before / After pair,
// Undo · Compare and the "What AI did" fold — and not the "The canvas didn't change." note; the newest turn stays
// RunSurface's, and a reply with no run of its own draws nothing.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const T0 = new Date('2026-10-20T10:00:00Z').getTime();
const MIN = 60_000;

const run = (id: string, at: number, over: Record<string, unknown> = {}) => ({
  runId: id,
  chatId: 'c1',
  origin: 'maude-chat',
  state: 'ended',
  outcome: 'done',
  createdAt: at,
  startedAt: at,
  endedAt: at + 41_000,
  scope: { canvas: 'Combine.tsx', artboards: ['story'] },
  touched: { 'Combine.tsx': ['story'] },
  objects: [],
  ...over,
});

const edit = (n: number) => ({
  type: 'tool-call',
  toolCallId: `t${n}`,
  toolName: 'Edit',
  args: { file_path: `ui/Story${n}.tsx` },
  argsText: '{}',
  result: {},
});

describe('an earlier reply keeps its result card', () => {
  let realFetch: typeof fetch;
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string) => {
      if (String(url).startsWith('/_api/project/versions'))
        return Response.json({
          ok: true,
          rows: [
            { id: 'v2', runId: 'r_old', picture: { status: 'ready', url: '/after.png' } },
            { id: 'v1', runId: 'r_x', picture: { status: 'ready', url: '/before.png' } },
          ],
        });
      return Response.json({ ok: true });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    GlobalRegistrator.unregister();
  });

  async function mount(runs: unknown[], latestId: string | null) {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } = await import(
      '@assistant-ui/react'
    );
    const { AssistantMessage, ChatMediaContext, UserMessage } = await import(
      '../client/v2/ai/Feed.jsx'
    );
    const user = (text: string, at: number) => ({
      role: 'user' as const,
      content: [{ type: 'text' as const, text }],
      createdAt: new Date(at),
    });
    const bot = (text: string, ...tools: unknown[]) => ({
      role: 'assistant' as const,
      content: [{ type: 'text' as const, text }, ...tools],
      status: { type: 'complete' as const, reason: 'stop' as const },
    });
    const adapter = {
      async *run() {
        await new Promise(() => {});
      },
    };
    function Host() {
      const runtime = useLocalRuntime(adapter as never, {
        initialMessages: [
          user('Make a story', T0),
          bot('Done — Story is made.', edit(1), edit(2), edit(3), edit(4)),
          user('Which green?', T0 + 10 * MIN),
          bot('Club green.'),
          user('Check the poster', T0 + 20 * MIN),
          bot('Both fixes are in.', edit(5)),
        ] as never,
      });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatMediaContext.Provider
            value={{ designRel: '.design', chatRuns: { runs, latestId }, chipName: () => '' }}
          >
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ChatMediaContext.Provider>
        </AssistantRuntimeProvider>
      );
    }
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Host />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return { all: (sel: string) => [...document.querySelectorAll(sel)] };
  }

  test('the turn with a run draws Before / After, Undo · Compare and the fold; the newest turn does not (RunSurface owns it)', async () => {
    const { all } = await mount(
      [run('r_old', T0 + 2_000), run('r_new', T0 + 20 * MIN + 2_000)],
      'r_new'
    );
    const cards = all('[data-testid="ai-turn-result"]');
    expect(cards).toHaveLength(1);
    const card = cards[0] as HTMLElement;
    expect(card.dataset.run).toBe('r_old');
    expect(card.querySelector('[data-testid="ai-result-before-after"]')).not.toBeNull();
    expect(card.querySelector('[data-verb="Undo"]')).not.toBeNull();
    expect(card.querySelector('[data-verb="Compare"]')).not.toBeNull();
    expect(card.querySelector('[data-verb="Keep going"]')).toBeNull();
    expect(card.querySelector('[data-testid="ai-steps"]')?.textContent).toContain(
      'What AI did · 4 steps · 41 s'
    );
  });

  test('a reply that changed nothing and has no run keeps "The canvas didn’t change."; a changed one does not claim it', async () => {
    const { all } = await mount([run('r_old', T0 + 2_000)], null);
    // the first reply used Edit → no note, with a card; the second used no tool → note, no card
    expect(all('[data-testid="ai-turn-result"]')).toHaveLength(1);
    expect(all('[data-testid="ai-canvas-unchanged"]')).toHaveLength(1);
  });

  test('what an ask was sent with is drawn above its bubble (photo tile, PDF and folder cards)', async () => {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = await import('react');
    const { AssistantRuntimeProvider, ThreadPrimitive, useLocalRuntime } = await import(
      '@assistant-ui/react'
    );
    const { AssistantMessage, ChatMediaContext, UserMessage } = await import(
      '../client/v2/ai/Feed.jsx'
    );
    const adapter = {
      async *run() {
        await new Promise(() => {});
      },
    };
    function Host() {
      const runtime = useLocalRuntime(adapter as never, {
        initialMessages: [
          {
            role: 'user',
            content: [{ type: 'text', text: 'Check the poster against the brief' }],
            createdAt: new Date(T0),
            metadata: {
              custom: {
                attachments: [
                  {
                    kind: 'image',
                    name: 'a.jpg',
                    meta: '',
                    path: '/p/.design/_chat/attachments/0a1b2c3d.jpg',
                  },
                  {
                    kind: 'file',
                    name: 'Combine-brief-2026.pdf',
                    meta: 'PDF · 12 pages',
                    path: '/x/b.pdf',
                  },
                ],
              },
            },
          },
        ] as never,
      });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatMediaContext.Provider value={{ designRel: '.design', chipName: () => '' }}>
            <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
          </ChatMediaContext.Provider>
        </AssistantRuntimeProvider>
      );
    }
    document.body.innerHTML = '';
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(<Host />);
    });
    const msg = document.querySelector('.chat-msg--user') as HTMLElement;
    const strip = msg.querySelector('[data-testid="ai-sent"]') as HTMLElement;
    expect(strip).not.toBeNull();
    // above the bubble, not inside it
    expect(strip.compareDocumentPosition(msg.querySelector('.chat-bubble') as Node)).toBe(
      4 /* FOLLOWING */
    );
    expect(strip.querySelector('img')?.getAttribute('src')).toBe(
      '/_api/acp/attachment?name=0a1b2c3d.jpg'
    );
    expect(strip.querySelector('[data-kind="file"]')?.textContent).toContain('PDF · 12 pages');
    expect(msg.textContent).not.toContain('maude-attachments');
  });

  test('no registry run, no card', async () => {
    const { all } = await mount([], null);
    expect(all('[data-testid="ai-turn-result"]')).toHaveLength(0);
  });
});
