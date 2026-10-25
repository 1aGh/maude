// S6.12 (C5, 01 `cf-render-error`) — a canvas that compiles and then throws while it draws.
//
// Done when: the canvas posts render-error / render-ok; the shell binds each to the FRAME it came from (a
// canvas cannot speak for another canvas); the card is S11.7's one card (`kind: 'render'`) over the dimmed
// last good render with "Last good version · 6 Oct, 14:05" and **Go back to 14:05**; Ask AI pre-fills and never
// sends; the card is silent while this Mac's own run draws on the canvas and appears if the canvas is still
// broken when the run ends; a cold open that never drew stands on the dimmed index cover.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { repairOfferFor, resetRepairOffers } from '../client/v2/create/repair-offer.js';
import {
  cardShown,
  noteRender,
  RENDER_MESSAGE_MAX,
  readRenderMessage,
  useRenderSignal,
  writingRunOn,
} from '../client/v2/create/use-render-error.js';

const ORIGIN = 'http://localhost:4400';
const PATH_A = '.design/ui/Pricing.tsx';
const PATH_B = '.design/ui/Home.tsx';

type Frame = { contentWindow: object; getAttribute: (k: string) => string | null };
const frame = (path: string): Frame => ({
  contentWindow: {},
  getAttribute: (k) => (k === 'data-path' ? path : null),
});
const msg = (source: object, data: unknown, origin = ORIGIN) =>
  ({ origin, source, data }) as unknown as MessageEvent;

describe('the ledger', () => {
  test('error keeps the time it last drew fine; ok sets it; the message is clipped plain text', () => {
    let s = noteRender({}, { kind: 'render-ok', canvas: PATH_A, at: 1000 });
    expect(s[PATH_A]).toEqual({ status: 'ok', message: '', lastGoodAt: 1000 });
    s = noteRender(s, { kind: 'render-error', canvas: PATH_A, message: 'boom', at: 2000 });
    expect(s[PATH_A]).toEqual({ status: 'error', message: 'boom', lastGoodAt: 1000 });
    s = noteRender(s, { kind: 'render-error', canvas: PATH_B, message: 'x'.repeat(900), at: 3000 });
    expect(s[PATH_B]?.message.length).toBeLessThanOrEqual(RENDER_MESSAGE_MAX);
    expect(s[PATH_B]?.lastGoodAt).toBeNull();
    s = noteRender(s, { kind: 'render-ok', canvas: PATH_A, at: 4000 });
    expect(s[PATH_A]?.status).toBe('ok');
  });
});

describe('the message belongs to its frame', () => {
  const fa = frame(PATH_A);
  const fb = frame(PATH_B);
  const ctx = { canvasOrigin: ORIGIN, frames: [fa, fb] };

  test('the canvas it is about is the FRAME the message came from, never the file it names', () => {
    const r = readRenderMessage(
      msg(fa.contentWindow, { dgn: 'render-error', file: PATH_B, message: 'lie' }),
      ctx
    );
    expect(r).toEqual({ kind: 'render-error', canvas: PATH_A, message: 'lie' });
    expect(
      readRenderMessage(msg(fb.contentWindow, { dgn: 'render-ok', file: PATH_A }), ctx)
    ).toEqual({ kind: 'render-ok', canvas: PATH_B, message: '' });
  });

  test('another origin, a window that is not one of our frames, and junk are ignored', () => {
    const good = { dgn: 'render-error', file: PATH_A, message: 'm' };
    expect(readRenderMessage(msg(fa.contentWindow, good, 'https://evil.test'), ctx)).toBeNull();
    expect(readRenderMessage(msg({}, good), ctx)).toBeNull();
    expect(readRenderMessage(msg(null as unknown as object, good), ctx)).toBeNull();
    expect(
      readRenderMessage(msg(fa.contentWindow, { dgn: 'render-error', file: PATH_A }), ctx)
    ).toBeNull();
    expect(
      readRenderMessage(
        msg(fa.contentWindow, { dgn: 'render-error', file: PATH_A, message: 'x'.repeat(700) }),
        ctx
      )
    ).toBeNull();
    expect(
      readRenderMessage(msg(fa.contentWindow, { dgn: 'render-nope', file: PATH_A }), ctx)
    ).toBeNull();
  });
});

describe('when the card shows', () => {
  const broken = { status: 'error', message: 'boom', lastGoodAt: 1 };
  const run = (over: Record<string, unknown> = {}) => ({
    runId: 'r1',
    state: 'running',
    scope: { canvas: 'ui/Pricing.tsx' },
    leases: [],
    ...over,
  });
  const base = { entry: broken, canvas: PATH_A, designRel: '.design', view: { mine: [] } };

  test('a broken canvas shows it; a fine or unknown one does not', () => {
    expect(cardShown(base)).toBe(true);
    expect(cardShown({ ...base, entry: { ...broken, status: 'ok' } })).toBe(false);
    expect(cardShown({ ...base, entry: undefined })).toBe(false);
  });

  test("silent while this Mac's own run draws on the canvas — by scope or by an artboard lease", () => {
    expect(cardShown({ ...base, view: { mine: [run()] } })).toBe(false);
    expect(
      cardShown({
        ...base,
        view: {
          mine: [run({ scope: null, leases: [{ canvas: `path:${PATH_A}`, artboard: 'a1' }] })],
        },
      })
    ).toBe(false);
  });

  test('a run on ANOTHER canvas, a queued run, or an ended run does not silence it', () => {
    expect(
      cardShown({ ...base, view: { mine: [run({ scope: { canvas: 'ui/Home.tsx' } })] } })
    ).toBe(true);
    expect(cardShown({ ...base, view: { mine: [run({ state: 'waiting' })] } })).toBe(true);
    expect(cardShown({ ...base, view: { mine: [run({ state: 'done' })] } })).toBe(true);
    expect(writingRunOn({ mine: [run({ state: 'needs-you' })] }, PATH_A, '.design')).toBe(true);
  });

  test('one card, not two: not while the load-failure card shows, not while a past version is held', () => {
    expect(cardShown({ ...base, loadFailed: true })).toBe(false);
    expect(cardShown({ ...base, viewing: true })).toBe(false);
  });
});

// ── the component ───────────────────────────────────────────────────────────────────────────────
describe('<RenderErrorHost>', () => {
  const roots: Root[] = [];
  let RenderErrorHost: typeof import('../client/v2/create/render-error.jsx').RenderErrorHost;
  let whenLabel: typeof import('../client/v2/code/canvas-error-card.jsx').whenLabel;
  let clockLabel: typeof import('../client/v2/code/canvas-error-card.jsx').clockLabel;

  beforeAll(async () => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    ({ RenderErrorHost } = await import('../client/v2/create/render-error.jsx'));
    ({ whenLabel, clockLabel } = await import('../client/v2/code/canvas-error-card.jsx'));
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    resetRepairOffers();
    document.body.innerHTML = '';
  });

  const q = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);
  const click = (el: Element | null) => {
    if (!el) throw new Error('missing element');
    return act(async () => {
      el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
    });
  };
  const settle = () =>
    act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });

  /** A fake runs store (the shape useSyncExternalStore reads). */
  function runsStore(mine: unknown[] = []) {
    const subs = new Set<() => void>();
    let snap = { view: { seq: 1, mine, others: [] }, loaded: true, done: {} };
    return {
      subscribe: (fn: () => void) => {
        subs.add(fn);
        return () => subs.delete(fn);
      },
      getSnapshot: () => snap,
      set(next: unknown[]) {
        snap = { ...snap, view: { ...snap.view, seq: snap.view.seq + 1, mine: next } };
        for (const fn of [...subs]) fn();
      },
    };
  }
  async function mount(el: React.ReactElement) {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(el);
    });
    await settle();
    return host;
  }

  const AT = new Date(2026, 9, 6, 14, 5).getTime();
  const entry = { status: 'error', message: 'plan is not defined', lastGoodAt: AT };
  const jsonRes = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

  test('the card over the last good render: title, body, "Last good version · 6 Oct, 14:05", Go back to 14:05', async () => {
    await mount(
      <RenderErrorHost
        canvas={PATH_A}
        entry={entry}
        runsStore={runsStore()}
        askAiAvailable
        onAskAi={() => {}}
      />
    );
    expect(q('render-error-host')).not.toBeNull();
    expect(q('canvas-error-card')?.getAttribute('data-kind')).toBe('render');
    expect(q('canvas-error-title')?.textContent).toBe("Pricing can't be drawn right now.");
    expect(q('canvas-error-last-good-line')?.textContent).toBe(
      `Last good version · ${whenLabel(AT)}`
    );
    expect(whenLabel(AT)).toBe('6 Oct, 14:05');
    expect(q('canvas-error-go-back')?.textContent).toBe(`Go back to ${clockLabel(AT)}`);
    expect(q('canvas-error-body')?.textContent).toContain(
      'Behind this card is the last good version'
    );
    // nothing technical up front
    expect(q('canvas-error-message')).toBeNull();
    // the render is still there behind it: no cover, no replacement picture
    expect(q('render-error-thumb')).toBeNull();
  });

  test('Show details has the error as plain text — never markup', async () => {
    const evil = { ...entry, message: '<img src=x onerror=alert(1)> plan is not defined' };
    await mount(<RenderErrorHost canvas={PATH_A} entry={evil} runsStore={runsStore()} />);
    await click(q('fold-canvas-error-toggle'));
    expect(q('canvas-error-message')?.textContent).toContain('<img src=x');
    expect(document.querySelector('img[onerror]')).toBeNull();
  });

  test('Go back asks for @last-good, tells how it went in words, and writes through no other door', async () => {
    const seen: { url: string; body: unknown }[] = [];
    const told: [string, boolean][] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      seen.push({ url, body: JSON.parse(init.body) });
      return jsonRes({ ok: true, line: 'Went back to 14:05' });
    }) as unknown as typeof fetch;
    await mount(
      <RenderErrorHost
        canvas={PATH_A}
        entry={entry}
        runsStore={runsStore()}
        fetchImpl={fetchImpl}
        onNotify={(l: string, ok: boolean) => told.push([l, ok])}
      />
    );
    await click(q('canvas-error-go-back'));
    await settle();
    expect(seen).toEqual([
      { url: '/_api/project/restore', body: { path: PATH_A, at: '@last-good' } },
    ]);
    expect(told).toEqual([['Went back to 14:05', true]]);
  });

  test('a person who can only look is not offered Go back (the server refuses it as well)', async () => {
    await mount(
      <RenderErrorHost canvas={PATH_A} entry={entry} runsStore={runsStore()} canEdit={false} />
    );
    expect(q('canvas-error-go-back')).toBeNull();
    await click(q('fold-canvas-error-toggle'));
    expect(q('canvas-error-last-good')).toBeNull();
  });

  test('the card keeps ONE verb; Ask AI to fix it is announced for the AI panel chip (P8 C8, 01 cf-render-error)', async () => {
    await mount(
      <RenderErrorHost canvas={PATH_A} entry={entry} runsStore={runsStore()} askAiAvailable />
    );
    expect(q('canvas-error-ask-ai')).toBeNull();
    expect(q('canvas-error-go-back')).not.toBeNull();
    const text = repairOfferFor(PATH_A) ?? '';
    expect(text).toContain("Pricing can't be drawn right now. Fix it.");
    expect(text).toContain('It stopped while drawing');
    expect(text).toContain('“plan is not defined”');
  });

  test('no offer when AI is not available (a browser tab has no chat)', async () => {
    await mount(<RenderErrorHost canvas={PATH_A} entry={entry} runsStore={runsStore()} />);
    expect(repairOfferFor(PATH_A)).toBeNull();
  });

  test('the offer goes with the card: none once the canvas draws again', async () => {
    await mount(
      <RenderErrorHost
        canvas={PATH_A}
        entry={{ ...entry, status: 'ok' }}
        runsStore={runsStore()}
        askAiAvailable
      />
    );
    expect(repairOfferFor(PATH_A)).toBeNull();
  });

  test("silent during this Mac's own run on the canvas — and it appears if the canvas is still broken when the run ends", async () => {
    const store = runsStore([
      { runId: 'r1', state: 'running', scope: { canvas: 'ui/Pricing.tsx' }, leases: [] },
    ]);
    await mount(<RenderErrorHost canvas={PATH_A} entry={entry} runsStore={store} />);
    expect(q('render-error-host')).toBeNull();
    await act(async () => store.set([]));
    expect(q('render-error-host')).not.toBeNull();
  });

  test('a cold open that never drew: no time, the dimmed index cover behind, Go back still offered', async () => {
    const fetchImpl = (async (url: string) =>
      url.startsWith('/_api/index')
        ? jsonRes({
            project: { designRel: '.design' },
            writer: { seq: 1 },
            canvases: [{ rel: 'ui/Pricing.tsx', cover: { key: 'cover-abc' } }],
          })
        : jsonRes({ ok: true })) as unknown as typeof fetch;
    await mount(
      <RenderErrorHost
        canvas={PATH_A}
        entry={{ ...entry, lastGoodAt: null }}
        runsStore={runsStore()}
        fetchImpl={fetchImpl}
      />
    );
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
    expect(q('canvas-error-last-good-line')).toBeNull();
    expect(q('canvas-error-go-back')).toBeNull(); // no time to name: the verb waits under the fold
    expect(q('render-error-thumb')?.getAttribute('src')).toBe('/_api/thumb/cover-abc');
    await click(q('fold-canvas-error-toggle'));
    expect(q('canvas-error-last-good')).not.toBeNull();
  });
});

// ── the listener ────────────────────────────────────────────────────────────────────────────────
describe('useRenderSignal', () => {
  const roots: Root[] = [];
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
  });
  afterAll(() => {
    GlobalRegistrator.unregister();
  });
  afterEach(async () => {
    for (const r of roots.splice(0)) await act(async () => r.unmount());
    document.body.innerHTML = '';
  });

  function frameEl(path: string) {
    const f = document.createElement('iframe');
    f.setAttribute('data-path', path);
    document.body.append(f);
    return f;
  }
  const speak = (source: unknown, data: unknown) =>
    act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data,
          source: source as Window,
          origin: window.location.origin,
        })
      );
    });

  async function harness(props: { viewingPath?: string | null; wsSend?: (m: unknown) => void }) {
    const seen: { current: Record<string, { status: string; message: string }> } = { current: {} };
    function Probe() {
      seen.current = useRenderSignal({
        cfg: {},
        wsSend: props.wsSend,
        viewingPath: props.viewingPath ?? null,
      });
      return null;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => {
      root.render(<Probe />);
    });
    return seen;
  }

  test('error and ok land on the speaking frame; ok is relayed to the server as a bare name', async () => {
    const sent: unknown[] = [];
    const seen = await harness({ wsSend: (m) => sent.push(m) });
    const a = frameEl(PATH_A);
    const b = frameEl(PATH_B);
    await speak(a.contentWindow, { dgn: 'render-error', file: PATH_B, message: 'boom' });
    expect(seen.current[PATH_A]?.status).toBe('error');
    expect(seen.current[PATH_B]).toBeUndefined(); // the file it named is not the canvas it spoke for
    await speak(b.contentWindow, { dgn: 'render-ok', file: PATH_A });
    expect(seen.current[PATH_B]?.status).toBe('ok');
    expect(sent).toEqual([{ type: 'render-ok', file: PATH_B }]);
  });

  test('a frame holding a past version (Viewing) says nothing about the canvas now', async () => {
    const sent: unknown[] = [];
    const seen = await harness({ viewingPath: PATH_A, wsSend: (m) => sent.push(m) });
    const a = frameEl(PATH_A);
    await speak(a.contentWindow, { dgn: 'render-error', file: PATH_A, message: 'old' });
    await speak(a.contentWindow, { dgn: 'render-ok', file: PATH_A });
    expect(seen.current).toEqual({});
    expect(sent).toEqual([]);
  });

  test("a window that is not one of the shell's frames is ignored", async () => {
    const sent: unknown[] = [];
    const seen = await harness({ wsSend: (m) => sent.push(m) });
    frameEl(PATH_A);
    await speak({}, { dgn: 'render-ok', file: PATH_A });
    expect(seen.current).toEqual({});
    expect(sent).toEqual([]);
  });
});
