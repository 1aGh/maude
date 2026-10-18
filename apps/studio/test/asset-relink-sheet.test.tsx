// S8.19c — the shell half of Relink…: the two requests (import, then `asset.relink`), the sheet, the
// Inspector's box for a Waiting / Missing picture, and who may open any of it. A canvas only asks; the
// shell opens a relink for what its own asset-state answer says, and a session that cannot edit opens
// nothing.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { clearAssetAnswers, createAssetStateLane } from '../client/v2/assets/asset-state-lane.js';
import { relinkWithFile, undoRelink } from '../client/v2/assets/relink.js';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => GlobalRegistrator.unregister());
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
  clearAssetAnswers();
});

const CANVAS = 'ui/Post.tsx';
const FROM = 'assets/c1658844.png';
const TO = 'assets/7f3e21c4.jpg';
const JONAS = { name: 'jonas', kind: 'mac', self: false };

type Call = { url: string; init?: RequestInit };
function fakeFetch(answers: Array<{ status?: number; body: unknown } | 'throw'>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const a = answers.shift();
    if (a === 'throw' || !a) throw new Error('offline');
    return new Response(JSON.stringify(a.body), { status: a.status ?? 200 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const file = () => new File(['x'], 'copy.jpg', { type: 'image/jpeg' });

describe('relinkWithFile / undoRelink', () => {
  test('imports first, then one asset.relink with the studio-named from and the imported to', async () => {
    const f = fakeFetch([
      { status: 201, body: { path: TO } },
      { body: { ok: true, writeId: 'w_abc', rev: '0123456789abcdef', actionId: null, refs: [] } },
    ]);
    const r = await relinkWithFile({ canvas: CANVAS, from: FROM, file: file() }, f.fn);
    expect(r).toEqual({ ok: true, to: TO, writeId: 'w_abc' });
    expect(f.calls.map((c) => c.url)).toEqual(['/_api/asset', '/_api/edit-op']);
    expect(JSON.parse(String(f.calls[1]?.init?.body))).toEqual({
      file: CANVAS,
      op: 'asset.relink',
      targets: [],
      params: { from: FROM, to: TO },
    });
  });

  test('a refused import writes nothing; a refused op says why in plain words', async () => {
    const a = fakeFetch([{ status: 413, body: { ok: false, error: 'too big' } }]);
    const r = await relinkWithFile({ canvas: CANVAS, from: FROM, file: file() }, a.fn);
    expect(r.ok).toBe(false);
    expect(a.calls).toHaveLength(1); // never reached the edit op
    const b = fakeFetch([
      { status: 201, body: { path: TO } },
      { status: 409, body: { ok: false, code: 'locked', message: 'x' } },
    ]);
    const r2 = await relinkWithFile({ canvas: CANVAS, from: FROM, file: file() }, b.fn);
    expect(r2).toEqual({
      ok: false,
      message: 'Not relinked. Something that uses this picture is locked; unlock it first.',
    });
    const c = fakeFetch(['throw']);
    expect((await relinkWithFile({ canvas: CANVAS, from: FROM, file: file() }, c.fn)).ok).toBe(
      false
    );
  });

  test('undo is the edit op’s own revert', async () => {
    const f = fakeFetch([{ body: { ok: true } }]);
    expect(await undoRelink({ canvas: CANVAS, writeId: 'w_abc' }, f.fn)).toBe(true);
    expect(JSON.parse(String(f.calls[0]?.init?.body))).toMatchObject({
      op: 'revert',
      params: { writeId: 'w_abc' },
    });
  });
});

/** Tell the module store what the studio said about CANVAS, through the real lane. */
async function seedAnswer(items: unknown[]) {
  const canvasWin = { postMessage: () => {} };
  const frame = { contentWindow: canvasWin, getAttribute: () => CANVAS };
  const listeners: Array<(e: unknown) => void> = [];
  const lane = createAssetStateLane({
    win: {
      addEventListener: (_t: string, fn: (e: unknown) => void) => listeners.push(fn),
    } as never,
    frames: () => [frame as unknown as Element],
    activeWindow: () => canvasWin as unknown as Window,
    canvasOrigin: () => 'http://127.0.0.1:5555',
    setTimer: () => 1,
    clearTimer: () => {},
    fetchImpl: (async () =>
      new Response(JSON.stringify({ items }), { status: 200 })) as unknown as typeof fetch,
  });
  await act(async () => {
    for (const fn of listeners)
      fn({ data: { dgn: 'canvas-rendered' }, source: canvasWin, origin: 'http://127.0.0.1:5555' });
    await new Promise((r) => setTimeout(r, 5));
  });
  return lane;
}

async function mount(node: React.ReactElement) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(node));
  return host;
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;

describe('who may open a relink', () => {
  async function Host(canEdit: boolean) {
    const { useRelinkSheet } = await import('../client/v2/assets/missing-frame.jsx');
    let api: { onRelink: (rel: string, canvas: string) => void } | null = null;
    function App() {
      const r = useRelinkSheet({ canEdit });
      api = r;
      return <div>{r.sheet}</div>;
    }
    await mount(<App />);
    return () => api as NonNullable<typeof api>;
  }

  test('Can edit: the studio’s missing rel opens the sheet; a rel it never named opens nothing', async () => {
    const lane = await seedAnswer([
      { rel: FROM, state: 'missing' },
      { rel: 'assets/here0001.png', state: 'here' },
    ]);
    const api = await Host(true);
    await act(async () => api().onRelink('assets/never-said.png', CANVAS));
    await act(async () => api().onRelink('assets/here0001.png', CANVAS));
    await act(async () => api().onRelink(FROM, 'ui/Other.tsx')); // a canvas the studio told nothing about
    expect(q('asset-relink-sheet')).toBeNull();
    await act(async () => api().onRelink(FROM, CANVAS));
    expect(q('asset-relink-sheet')?.getAttribute('aria-label')).toBe('Relink c1658844.png');
    lane.stop();
  });

  test('Can view / Can comment: nothing opens, whatever is missing', async () => {
    const lane = await seedAnswer([{ rel: FROM, state: 'missing' }]);
    const api = await Host(false);
    await act(async () => api().onRelink(FROM, CANVAS));
    expect(q('asset-relink-sheet')).toBeNull();
    lane.stop();
  });
});

describe('the sheet', () => {
  test('choose a file → relink({canvas, from, file}) → closes; a refusal stays open and says why', async () => {
    const { RelinkSheet } = await import('../client/v2/assets/missing-frame.jsx');
    const seen: Array<{ canvas: string; from: string }> = [];
    let closed = 0;
    const answers = [
      { ok: false, message: 'Not relinked. That file does not fit here; pick another.' },
      { ok: true, to: TO, writeId: 'w_1' },
    ];
    await mount(
      <RelinkSheet
        from={FROM}
        canvas={CANVAS}
        onClose={() => {
          closed += 1;
        }}
        relink={async (req: { canvas: string; from: string }) => {
          seen.push({ canvas: req.canvas, from: req.from });
          return answers.shift() as never;
        }}
      />
    );
    const pick = async () => {
      const input = q('asset-relink-input') as HTMLInputElement;
      Object.defineProperty(input, 'files', { value: [file()], configurable: true });
      await act(async () => {
        input.dispatchEvent(new Event('change', { bubbles: true }));
      });
    };
    await pick();
    expect(q('asset-relink-error')?.textContent).toContain('does not fit here');
    expect(closed).toBe(0);
    await pick();
    expect(seen).toEqual([
      { canvas: CANVAS, from: FROM },
      { canvas: CANVAS, from: FROM },
    ]);
    expect(closed).toBe(1);
  });
});

describe('the Inspector box', () => {
  async function box(
    items: unknown[],
    src: string,
    canEdit: boolean
  ): Promise<{ stop: () => void; opened: Array<[string, string]> }> {
    const lane = await seedAnswer(items);
    const { AssetAbsentBox, useRelinkSheet } = await import(
      '../client/v2/assets/missing-frame.jsx'
    );
    const opened: Array<[string, string]> = [];
    function App() {
      const r = useRelinkSheet({ canEdit });
      return (
        <div>
          <AssetAbsentBox el={{ attrs: { src } }} canvas={CANVAS} />
          {r.sheet}
        </div>
      );
    }
    await mount(<App />);
    return { stop: () => lane.stop(), opened };
  }

  test('Missing says Missing with Relink…; Waiting says whose Mac, quietly, and offers it', async () => {
    let h = await box([{ rel: FROM, state: 'missing' }], '/assets/c1658844.png', true);
    expect(q('asset-absent-word')?.textContent).toBe('Missing');
    expect(q('asset-absent-box')?.getAttribute('data-state')).toBe('missing');
    await act(async () => q('asset-absent-relink')?.click());
    expect(q('asset-relink-sheet')).not.toBeNull();
    h.stop();
    document.body.innerHTML = '';
    clearAssetAnswers();
    h = await box([{ rel: FROM, state: 'waiting', who: JONAS }], './assets/c1658844.png?v=2', true);
    expect(q('asset-absent-word')?.textContent).toBe("Waiting for Jonas's Mac");
    expect(q('asset-absent-box')?.textContent).toContain('Have it here?');
    h.stop();
  });

  test('a picture that is here draws no box; Can view / Can comment see the words but no Relink…', async () => {
    let h = await box([{ rel: FROM, state: 'here' }], '/assets/c1658844.png', true);
    expect(q('asset-absent-box')).toBeNull();
    h.stop();
    document.body.innerHTML = '';
    clearAssetAnswers();
    h = await box([{ rel: FROM, state: 'missing' }], '/assets/c1658844.png', false);
    expect(q('asset-absent-box')).not.toBeNull();
    expect(q('asset-absent-relink')).toBeNull();
    h.stop();
  });
});
