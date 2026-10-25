// S9.22b (S2.18 / S5.11) — the `ai-holds` sender: the shell's run list tells the open canvas which OBJECTS
// a live AI run holds. The canvas is the untrusted side (DDR-054), so what reaches it is the object, a fixed
// neutral tag built from the state and the holder's name (v2-lead-neutral-ai-ring-tags) and a mine flag —
// never the run's label (its prompt), its question or its progress line.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const FILE = '.design/ui/combine.tsx';
const KEY = `path:${FILE}`;
const SECRET = 'Make the footer say SECRET-PROMPT-TEXT';

const mine = (over: Record<string, unknown> = {}) => ({
  v: 1,
  runId: 'r_1aaaaaa',
  askId: 'a_1aaaaaa',
  chatId: 'c1',
  origin: 'maude-chat',
  actor: 'you',
  label: SECRET,
  doing: `Writing ${SECRET}`,
  question: `Should I ${SECRET}?`,
  scope: { canvas: 'ui/combine.tsx', artboards: ['post'] },
  state: 'running',
  leases: [{ canvas: KEY, artboard: 'post', token: 1 }],
  waiting: [],
  touched: {},
  objects: [{ canvas: KEY, artboard: 'post', element: 'footer' }],
  createdAt: 1,
  ...over,
});
const tereza = (over: Record<string, unknown> = {}) => ({
  runId: 'r_2bbbbbb',
  askId: null,
  actor: 'tereza',
  origin: 'maude-chat',
  label: SECRET,
  state: 'needs-you',
  artboards: [{ canvas: KEY, artboard: 'story' }],
  waitingFor: [],
  objects: [
    { canvas: KEY, artboard: 'story', element: 'title', occurrence: 2 },
    { canvas: 'path:.design/ui/other.tsx', artboard: 'x', element: 'elsewhere' },
  ],
  since: 1,
  ...over,
});

describe('holdsFor (S9.22b)', () => {
  test('objects of running / needs-you runs on the open canvas, neutral tags, no prompt text', async () => {
    const { holdsFor } = await import('../client/v2/ai/runs-model.js');
    const { DGN_TABLE } = await import('../bridge/dgn-protocol.ts');
    const view = { seq: 1, mine: [mine()], others: [tereza()], needsYou: 0, live: 2 };
    const holds = holdsFor(view, { activeCanvas: FILE });
    expect(holds).toEqual([
      { artboard: 'post', element: 'footer', tag: 'AI is working', mine: true },
      {
        artboard: 'story',
        element: 'title',
        occurrence: 2,
        tag: 'Waiting for Tereza',
        mine: false,
      },
    ]);
    const wire = JSON.stringify(holds);
    expect(wire).not.toContain('SECRET');
    // the canvas's own parser takes it whole (a row past its caps would drop the WHOLE message)
    expect(DGN_TABLE.s2c['ai-holds'].parse({ holds })).toEqual({ holds });
  });

  test('a waiting or ended run holds nothing; an oversize id is left out, not sent', async () => {
    const { holdsFor } = await import('../client/v2/ai/runs-model.js');
    const view = {
      seq: 1,
      mine: [
        mine({ state: 'waiting' }),
        mine({ runId: 'r_3', state: 'done' }),
        mine({
          runId: 'r_4',
          objects: [{ canvas: KEY, artboard: 'post', element: 'e'.repeat(121) }],
        }),
      ],
      others: [tereza({ state: 'waiting' })],
      needsYou: 0,
      live: 0,
    };
    expect(holdsFor(view, { activeCanvas: FILE })).toEqual([]);
  });
});

describe('the relay posts ai-holds to the open canvas (S9.22b)', () => {
  test('the frame hears {dgn:"ai-holds", holds}; the same answer is not sent twice; gone holds are []', async () => {
    const { createRingsLane } = await import('../client/v2/ai/ring-relay.js');
    const { createRunsStore } = await import('../client/v2/ai/runs-store.js');
    let body: Record<string, unknown> = { seq: 1, mine: [mine()], others: [] };
    const fetchImpl = (async () =>
      new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
    const store = createRunsStore({ fetchImpl, target: new EventTarget() as unknown as Window });
    document.body.innerHTML = '';
    const sent: Array<Record<string, unknown>> = [];
    const el = document.createElement('iframe');
    el.setAttribute('data-testid', 'canvas-frame');
    el.setAttribute('src', 'http://127.0.0.1:4401/_canvas-shell.html'); // V2-8.9 L2: the relay posts to the frame's origin
    el.setAttribute('data-path', FILE);
    Object.defineProperty(el, 'contentWindow', {
      value: { postMessage: (m: Record<string, unknown>) => sent.push(m) },
    });
    document.body.append(el);
    const stop = createRingsLane({ store, doc: document, win: window });
    await store.refresh();
    const holdsMsgs = () => sent.filter((m) => m.dgn === 'ai-holds');
    expect(holdsMsgs()).toEqual([
      {
        dgn: 'ai-holds',
        holds: [{ artboard: 'post', element: 'footer', tag: 'AI is working', mine: true }],
      },
    ]);
    expect(JSON.stringify(sent)).not.toContain('SECRET');
    await store.refresh();
    expect(holdsMsgs()).toHaveLength(1);
    body = { seq: 2, mine: [], others: [] };
    await store.refresh();
    expect(holdsMsgs().at(-1)).toEqual({ dgn: 'ai-holds', holds: [] });
    stop();
  });
});
