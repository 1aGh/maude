// S5.11 — the ✦ N and its list, the waiting card, the relay that tells the canvas, and the rings it draws.
// Real components, real DOM (happy-dom), real React; only the network is a stub.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // the run list reads the project index for artboard names; here there is none
  globalThis.fetch = (async () => new Response('{}', { status: 404 })) as unknown as typeof fetch;
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

describe('✦ N and the run list (ai-two-artboards, ai-tereza)', () => {
  test('two chats on two artboards: ✦ 2; Tereza on the canvas is listed View only and not counted', async () => {
    const React = await import('react');
    const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
    const { store } = await storeWith({
      mine: [
        mine({ label: 'Make it greener' }),
        mine({
          label: 'Translate the poster',
          leases: [lease('poster')],
          scope: { canvas: 'ui/combine.tsx', artboards: ['poster'] },
        }),
      ],
      others: [tereza()],
    });
    const { act } = await mount(
      <RunsCount store={store} activeCanvas={FILE} designRel=".design" currentChatId="x" />
    );
    const btn = q('ai-chat-count');
    expect(btn?.textContent).toBe('2');
    expect(btn?.getAttribute('aria-label')).toBe('2 chats running');
    expect(q('ai-runs-list')).toBeNull();
    await act(async () => btn?.click());
    const rows = [...document.querySelectorAll('[data-testid^="ai-run-r_"]')];
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.getAttribute('data-view-only') === 'true')).toHaveLength(1);
    expect(q('ai-runs-list')?.textContent).toContain('On this canvas');
    expect(q('ai-runs-list')?.textContent).toContain('View only');
    expect(q('ai-chat-count')?.textContent).toBe('2');
    void React;
  });

  test('absent at zero; a run list never opens for nothing', async () => {
    const React = await import('react');
    const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
    const { store } = await storeWith({
      mine: [mine({ state: 'ended', outcome: 'done', leases: [] })],
      others: [tereza()],
    });
    await mount(<RunsCount store={store} activeCanvas={FILE} designRel=".design" />);
    expect(q('ai-chat-count')).toBeNull();
    void React;
  });

  test('a row takes you to its artboard (and its chat); esc closes and gives focus back', async () => {
    const React = await import('react');
    const { RunsCount } = await import('../client/v2/ai/RunList.jsx');
    const { CANVAS_OP_EVENT } = await import('../client/v2/left-panel/left-panel-bus.js');
    const run = mine({ chatId: 'chat-green' });
    const { store } = await storeWith({ mine: [run], others: [] });
    const opened: string[] = [];
    const { act } = await mount(
      <RunsCount
        store={store}
        activeCanvas={FILE}
        designRel=".design"
        onOpenChat={(id: string) => opened.push(id)}
      />
    );
    const jumps: Array<Record<string, string>> = [];
    window.addEventListener(CANVAS_OP_EVENT, (e) => jumps.push((e as CustomEvent).detail));
    await act(async () => q('ai-chat-count')?.click());
    await act(async () => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(q('ai-runs-list')).toBeNull();
    expect(document.activeElement).toBe(q('ai-chat-count'));
    await act(async () => q('ai-chat-count')?.click());
    await act(async () => q(`ai-run-${run.runId}`)?.click());
    expect(jumps).toEqual([{ op: 'jump', path: FILE, artboardId: 'post' }]);
    expect(opened).toEqual(['chat-green']);
    expect(q('ai-runs-list')).toBeNull();
    void React;
  });
});

describe('the waiting card (ai-same-artboard)', () => {
  const holder = tereza({
    runId: 'r_holder1',
    label: 'Make it greener',
    artboards: [{ canvas: KEY, artboard: 'post' }],
  });
  const waiting = () =>
    mine({
      state: 'waiting',
      chatId: 'c-wait',
      label: 'Headline in one word',
      leases: [],
      waiting: [{ ...lease('post'), position: 1, heldBy: holder }],
    });

  test('a second ask on a busy artboard shows the card; × cancels it', async () => {
    const React = await import('react');
    const { WaitingCards } = await import('../client/v2/ai/WaitingCard.jsx');
    const run = waiting();
    const { store, posts } = await storeWith({ mine: [run], others: [holder] });
    const { act } = await mount(<WaitingCards store={store} chatId="c-wait" designRel=".design" />);
    expect(q('ai-waiting-card')?.textContent).toContain(
      'Waiting for “Make it greener” to finish on Post'
    );
    expect(q('ai-waiting-card')?.textContent).toContain('Starts by itself, on top of its result.');
    expect(q('ai-waiting-card')?.textContent).not.toMatch(/minute/);
    await act(async () => q('ai-waiting-cancel')?.click());
    expect(posts).toEqual([`/_api/ai/runs/${run.runId}/cancel`]);
    void React;
  });

  test('another chat’s waiting ask is not drawn here', async () => {
    const React = await import('react');
    const { WaitingCards } = await import('../client/v2/ai/WaitingCard.jsx');
    const { store } = await storeWith({ mine: [waiting()], others: [holder] });
    await mount(<WaitingCards store={store} chatId="some-other-chat" designRel=".design" />);
    expect(q('ai-waiting-card')).toBeNull();
    void React;
  });

  test('Run on a copy is not drawn until the server half exists; when it is, it posts /copy', async () => {
    const React = await import('react');
    const mod = await import('../client/v2/ai/WaitingCard.jsx');
    expect(mod.RUN_ON_COPY_LIVE).toBe(false);
    const run = waiting();
    const { store } = await storeWith({ mine: [run], others: [holder] });
    await mount(<mod.WaitingCards store={store} chatId="c-wait" designRel=".design" />);
    expect(q('ai-waiting-copy')).toBeNull();
    const calls: string[] = [];
    const { act } = await mount(
      <mod.WaitingCard
        run={run}
        designRel=".design"
        copyLive
        onCopy={() => calls.push('copy')}
        onCancel={() => {}}
      />
    );
    await act(async () => q('ai-waiting-copy')?.click());
    expect(calls).toEqual(['copy']);
    void React;
  });
});

describe('the relay that tells the canvas (dgn ai-runs)', () => {
  function fakeFrame(path: string) {
    const sent: unknown[] = [];
    const win = { postMessage: (m: unknown) => sent.push(m) };
    const el = document.createElement('iframe');
    el.setAttribute('data-testid', 'canvas-frame');
    el.setAttribute('data-path', path);
    Object.defineProperty(el, 'contentWindow', { value: win });
    document.body.append(el);
    return { sent, win, el };
  }

  test('posts the rings of the open canvas; the same answer is not sent twice; gone rings are sent as {}', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    let body: Record<string, unknown> = { seq: 1, mine: [mine({})], others: [] };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    document.body.innerHTML = '';
    const { sent } = fakeFrame(FILE);
    const stop = createRingsLane({ store, doc: document, win: window });
    await store.refresh();
    expect(sent).toEqual([
      {
        dgn: 'ai-runs',
        artboards: { post: { state: 'running', who: 'you', tag: 'AI is working', waiting: 0 } },
      },
    ]);
    await store.refresh(); // same seq, same answer
    expect(sent).toHaveLength(1);
    body = { seq: 2, mine: [], others: [] };
    await store.refresh();
    expect(sent.at(-1)).toEqual({ dgn: 'ai-runs', artboards: {} });
    stop();
  });

  test('a canvas that has just loaded is told again; one with nothing to show is left quiet', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ seq: 1, mine: [mine({})], others: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    await store.refresh();
    document.body.innerHTML = '';
    const a = fakeFrame(FILE);
    const quiet = fakeFrame('.design/ui/another.tsx');
    const stop = createRingsLane({ store, doc: document, win: window });
    expect(a.sent).toHaveLength(1);
    expect(quiet.sent).toHaveLength(0); // no AI on that canvas, nothing ever said to it
    window.dispatchEvent(
      new MessageEvent('message', { data: { dgn: 'loaded' }, source: a.win as never })
    );
    expect(a.sent).toHaveLength(2);
    stop();
  });

  test('a just-finished artboard is sent as a settled ring', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    const fetchImpl = (async () =>
      new Response(JSON.stringify({ seq: 1, mine: [], others: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    const store = createRunsStore({
      fetchImpl,
      target: new EventTarget() as unknown as Window,
      setTimer: () => 0,
    });
    document.body.innerHTML = '';
    const { sent } = fakeFrame(FILE);
    const stop = createRingsLane({ store, doc: document, win: window });
    store.markDone(['post']);
    expect(sent.at(-1)).toEqual({
      dgn: 'ai-runs',
      artboards: { post: { state: 'done', who: 'you', tag: 'Made by AI', waiting: 0 } },
    });
    stop();
  });
});

describe('the rings on the canvas', () => {
  async function overlay() {
    const React = await import('react');
    const { ArtboardRingsLayer } = await import('../artboard-activity-overlay.tsx');
    const view = await mount(<ArtboardRingsLayer />);
    const board = document.createElement('div');
    board.setAttribute('data-dc-screen', 'post');
    board.getBoundingClientRect = () =>
      ({
        left: 100,
        top: 100,
        width: 320,
        height: 320,
        right: 420,
        bottom: 420,
        x: 100,
        y: 100,
      }) as DOMRect;
    document.body.append(board);
    void React;
    return view;
  }
  const post = (data: unknown, source: unknown = window) =>
    window.dispatchEvent(new MessageEvent('message', { data, source: source as never }));

  test('a ring and its tag appear on the artboard the shell names; "· N waiting" rides on the tag', async () => {
    const { act } = await overlay();
    await act(async () => {
      post({
        dgn: 'ai-runs',
        artboards: { post: { state: 'running', who: 'you', tag: 'AI is working', waiting: 1 } },
      });
    });
    const ring = q('ai-ring-post');
    expect(ring?.getAttribute('data-state')).toBe('running');
    expect(ring?.textContent).toContain('AI is working · 1 waiting');
    // the rectangle follows the artboard (on an animation frame)
    await new Promise((r) => requestAnimationFrame(() => r(null)));
    const style = ring?.getAttribute('style') ?? '';
    expect(style).toContain('left: 95px');
    expect(style).toContain('width: 330px');
  });

  test("Tereza's ring carries her initial; a needs-you ring is its own state; none left = nothing drawn", async () => {
    const { act } = await overlay();
    await act(async () => {
      post({
        dgn: 'ai-runs',
        artboards: {
          post: { state: 'needs-you', who: 'tereza', tag: 'Waiting for Tereza', waiting: 0 },
        },
      });
    });
    expect(q('ai-ring-post')?.getAttribute('data-state')).toBe('needs-you');
    expect(q('ai-ring-post')?.querySelector('.dc-ai-face')?.textContent).toBe('T');
    await act(async () => {
      post({ dgn: 'ai-runs', artboards: {} });
    });
    expect(q('ai-rings')).toBeNull();
  });

  test('only the shell may say it: a message from anywhere else draws nothing', async () => {
    const { act } = await overlay();
    await act(async () => {
      post(
        {
          dgn: 'ai-runs',
          artboards: { post: { state: 'running', who: 'you', tag: 'AI is working', waiting: 0 } },
        },
        { not: 'the parent' }
      );
    });
    expect(q('ai-rings')).toBeNull();
  });

  test('a planted payload is refused whole', async () => {
    const { act } = await overlay();
    await act(async () => {
      post({
        dgn: 'ai-runs',
        artboards: { post: { state: 'running', who: 'you', tag: 'x'.repeat(500), waiting: 0 } },
      });
      post({
        dgn: 'ai-runs',
        artboards: { post: { state: 'bold', who: 'you', tag: 'x', waiting: 0 } },
      });
      post({
        dgn: 'ai-runs',
        artboards: JSON.parse('{"__proto__":{"state":"running","who":"a","tag":"b","waiting":0}}'),
      });
    });
    expect(q('ai-rings')).toBeNull();
  });
});
