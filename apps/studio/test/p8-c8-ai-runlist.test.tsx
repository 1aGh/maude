// P8 stage C round 8 (p8-c8-ai) — 03 ai-two-artboards: the run list ends with "All chats  N" (opens the chat list).
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // the run list reads the project index for artboard names; here there is none
  globalThis.fetch = (async (url: string) =>
    String(url).startsWith('/_api/acp/chats')
      ? Response.json({
          groups: [
            {
              canvas: 'ui/combine.tsx',
              chats: [
                { id: 'a', title: 'A' },
                { id: 'b', title: 'B' },
              ],
            },
            { canvas: null, chats: [{ id: 'c', title: 'C' }] },
          ],
        })
      : new Response('{}', { status: 404 })) as unknown as typeof fetch;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const FILE = '.design/ui/combine.tsx';
const KEY = `path:${FILE}`;
const lease = (artboard: string) => ({ canvas: KEY, artboard, token: 1 });

let n = 0;
const mine = (over: Record<string, unknown>) => ({
  v: 1,
  runId: `r_${++n}aaaaaa`,
  askId: `a_${n}aaaaaa`,
  chatId: `c${n}`,
  origin: 'maude-chat',
  actor: 'you',
  label: 'Make it greener',
  scope: { canvas: 'ui/combine.tsx', artboards: ['post'] },
  state: 'running',
  leases: [lease('post')],
  waiting: [],
  touched: {},
  objects: [],
  createdAt: n,
  ...over,
});
const tereza = (over: Record<string, unknown> = {}) => ({
  runId: `r_${++n}bbbbbb`,
  askId: null,
  actor: 'tereza',
  origin: 'maude-chat',
  label: 'Shorter headline',
  state: 'running',
  artboards: [{ canvas: KEY, artboard: 'story' }],
  waitingFor: [],
  objects: [],
  since: 1,
  ...over,
});

async function storeWith(body: Record<string, unknown>) {
  const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
  const posts: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      posts.push(url);
      return new Response('{}', { status: 200 });
    }
    return new Response(JSON.stringify({ seq: 1, ...body }), { status: 200 });
  }) as unknown as typeof fetch;
  const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
  await store.refresh();
  return { store, posts };
}

async function mount(node: unknown) {
  const { createRoot } = await import('react-dom/client');
  const { act } = await import('react');
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(node as never));
  return { act, root, host };
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('the run list ends with All chats', () => {
  test('the row counts every chat of the project and opens the chat list', async () => {
    const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
    const { store } = await storeWith({ mine: [mine({})], others: [] });
    let opened = 0;
    const { act } = await mount(
      <RunsCount
        store={store}
        activeCanvas={FILE}
        designRel=".design"
        currentChatId="x"
        onOpenList={() => opened++}
      />
    );
    await act(async () => q('ai-chat-count')?.click());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const row = q('ai-runs-all');
    expect(row?.textContent).toContain('All chats');
    expect(row?.textContent).toContain('3');
    await act(async () => row?.click());
    expect(opened).toBe(1);
    expect(q('ai-runs-list')).toBeNull();
  });
  test('no host handler, no row', async () => {
    const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
    const { store } = await storeWith({ mine: [mine({})], others: [] });
    const { act } = await mount(
      <RunsCount store={store} activeCanvas={FILE} designRel=".design" currentChatId="x" />
    );
    await act(async () => q('ai-chat-count')?.click());
    expect(q('ai-runs-all')).toBeNull();
  });
});
