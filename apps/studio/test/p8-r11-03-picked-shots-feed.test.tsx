// P8 r11 (03 `ai-long-pinned`): the Feed draws the strip of picked shots under the reply whose tool calls placed them,
// and nothing under a reply that did not.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

const roots: Array<{ unmount(): void }> = [];
const P = '/Users/x/proj/.design/assets/combine-recap';
const write = (n: number) => ({
  type: 'tool-call',
  toolCallId: `w${n}`,
  toolName: 'Write',
  args: { file_path: `${P}/shot-0${n}.jpg` },
  argsText: '{}',
  result: {},
});

describe('picked shots in the feed', () => {
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterAll(async () => {
    const { act } = await import('react');
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    GlobalRegistrator.unregister();
  });

  async function mount(tools: unknown[], opened: string[] = []) {
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
          { role: 'user', content: [{ type: 'text', text: 'Pick the six sharpest' }] },
          {
            role: 'assistant',
            content: [{ type: 'text', text: 'Six shots picked.' }, ...tools],
            status: { type: 'complete', reason: 'stop' },
          },
        ] as never,
      });
      return (
        <AssistantRuntimeProvider runtime={runtime}>
          <ChatMediaContext.Provider
            value={{
              designRel: '.design',
              chipName: () => '',
              openLightbox: (src: string) => opened.push(src),
            }}
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
    roots.push(root);
    await act(async () => {
      root.render(<Host />);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 30));
    });
    return { all: (sel: string) => [...document.querySelectorAll(sel)] };
  }

  test('six placed pictures draw six tiles that open in the lightbox', async () => {
    const opened: string[] = [];
    const { all } = await mount([1, 2, 3, 4, 5, 6].map(write), opened);
    const tiles = all('[data-testid="ai-six-th"]') as HTMLImageElement[];
    expect(tiles).toHaveLength(6);
    expect(tiles[0].getAttribute('src')).toBe('/.design/assets/combine-recap/shot-01.jpg');
    (tiles[2].closest('button') as HTMLButtonElement).click();
    expect(opened).toEqual(['/.design/assets/combine-recap/shot-03.jpg']);
  });

  test('a reply that placed nothing draws no strip', async () => {
    const { all } = await mount([]);
    expect(all('[data-testid="ai-six"]')).toHaveLength(0);
  });
});
