// S11.5 — "Every artboard moved to the trash" (05 Empty States › es-all-trashed).
//
// Done when: the card says the canvas's words from a fake Trash list · Restore N posts S1's route once per
// id, in order, and its Undo is ONE step (`actionIds`) · Can view sees the card without the button, and the
// server refuses their restore anyway · the shell tells the open canvas (and only it) which outlines to
// keep, read from the canvas as it was before the trash action · the bridge row refuses a planted payload
// and the canvas layer draws only what the shell said.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { DGN_TABLE } from '../bridge/dgn-protocol.ts';
import { AllTrashed, AllTrashedCard } from '../client/v2/empty/all-trashed.jsx';
import {
  agoWord,
  allTrashedModel,
  canvasTrashedItems,
  countWord,
  loadGhosts,
  rectsFromVersion,
  resetGhostCache,
  restoreAll,
  restoreLabel,
  restoreOutcome,
  showAllTrashed,
  undoRestore,
  whoWord,
} from '../client/v2/empty/all-trashed-model.js';
import { createGhostLane } from '../client/v2/empty/all-trashed-relay.js';
import { copy } from '../client/v2/empty/index.js';
import { trashAccess } from '../history/trash.ts';
import { createTrashRoutes } from '../routes/trash.ts';

beforeEach(() => resetGhostCache());

const T0 = Date.UTC(2026, 9, 18, 12, 0, 0);
const NOW = T0 + 10 * 60_000;
const PATH = 'ui/LetakA6.tsx';

function item(artboard: string, label: string, over: Record<string, unknown> = {}) {
  return {
    id: `artboard:a9/${artboard}`,
    kind: 'artboard',
    entry: 'n_letak',
    doc: 'ui-letaka6',
    artboard,
    label,
    rev: 12,
    actionId: 'a9',
    actor: 'jonas@alligators.test',
    at: T0,
    mine: false,
    who: 'Jonas',
    group: 'today',
    path: PATH,
    ...over,
  };
}
const FOUR = [
  item('flag-a', 'A · přední FLAG'),
  item('flag-b', 'B · zadní FLAG'),
  item('tackle-c', 'C · přední TACKLE'),
  item('tackle-d', 'D · zadní TACKLE'),
];
const NOISE = [
  item('other', 'Elsewhere', { id: 'artboard:a8/other', path: 'ui/Other.tsx' }),
  item('gone', 'Canvas is trashed', { id: 'artboard:a7/gone', canvasTrashed: true }),
  { id: 'canvas:n_x', kind: 'canvas', path: PATH, at: T0, rev: 3, mine: false, who: 'Jonas' },
];
const TRASH = [...NOISE, ...FOUR];

describe('the words', () => {
  test('the card reads the 05 canvas verbatim from a fake Trash list', () => {
    const model = allTrashedModel(TRASH, PATH, NOW);
    expect(model?.count).toBe(4);
    expect(model?.items.map((i: { artboard: string }) => i.artboard)).toEqual([
      'flag-a',
      'flag-b',
      'tackle-c',
      'tackle-d',
    ]);
    const c = copy('es-all-trashed.all-trashed', model?.vars);
    expect(c.title).toBe('LetakA6 has no artboards left.');
    expect(c.next).toBe(
      'Jonas moved all four to the trash 10 min ago. Restore puts them back where they were; every earlier version is in Version history too.'
    );
    expect(c.action).toBe('Restore 4 artboards');
    expect(model?.restoreLabel).toBe('Restore 4 artboards');
  });

  test('nothing of this canvas in the Trash → no card; other canvases and a trashed canvas do not count', () => {
    expect(allTrashedModel(NOISE, PATH, NOW)).toBeNull();
    expect(allTrashedModel(TRASH, 'ui/Nothing.tsx', NOW)).toBeNull();
    expect(canvasTrashedItems(NOISE, PATH)).toEqual([]);
    expect(allTrashedModel([], PATH, NOW)).toBeNull();
  });

  test('the card shows only when the canvas holds no artboard and has loaded', () => {
    const model = allTrashedModel(FOUR, PATH, NOW);
    expect(showAllTrashed({ artboardCount: 0, ready: true, model })).toBe(true);
    expect(showAllTrashed({ artboardCount: 2, ready: true, model })).toBe(false);
    expect(showAllTrashed({ artboardCount: 0, ready: false, model })).toBe(false);
    expect(showAllTrashed({ artboardCount: 0, ready: true, model: null })).toBe(false);
  });

  test('counts read for 1 and for many; You for this person; times relative first, 24-hour', () => {
    expect(restoreLabel(1)).toBe('Restore 1 artboard');
    expect(restoreLabel(2)).toBe('Restore 2 artboards');
    expect(countWord(1)).toBe('of it');
    expect(countWord(2)).toBe('two');
    expect(countWord(12)).toBe('12');
    expect(whoWord({ mine: true, who: 'Jonas' })).toBe('You');
    expect(whoWord({ who: 'Jonas' })).toBe('Jonas');
    expect(whoWord({ actor: 'local:mac' })).toBe('You');
    expect(whoWord({ actor: 'x@y' })).toBe('Someone');
    expect(agoWord(T0, T0 + 20_000)).toBe('just now');
    expect(agoWord(T0, T0 + 10 * 60_000)).toBe('10 min ago');
    expect(agoWord(T0, T0 + 3 * 3_600_000)).toBe('3 h ago');
    expect(agoWord(T0, T0 + 26 * 3_600_000)).toBe('yesterday');
    expect(agoWord(Date.UTC(2026, 9, 6, 14, 5), Date.UTC(2026, 9, 18, 12, 0))).toMatch(
      /^on 6 Oct, \d\d:05$/
    );
    // one artboard: the sentence still reads
    const one = allTrashedModel([FOUR[0]], PATH, NOW);
    expect(copy('es-all-trashed.all-trashed', one?.vars).next).toContain(
      'Jonas moved all of it to the trash 10 min ago.'
    );
    expect(one?.restoreLabel).toBe('Restore 1 artboard');
  });
});

describe('the card', () => {
  const model = allTrashedModel(FOUR, PATH, NOW);

  test('Can edit: the Restore N button; Can view: the same card, no button', () => {
    const edit = renderToStaticMarkup(createElement(AllTrashedCard, { model, canEdit: true }));
    expect(edit).toContain('data-testid="all-trashed"');
    expect(edit).toContain('data-count="4"');
    expect(edit).toContain('LetakA6 has no artboards left.');
    expect(edit).toContain('data-testid="all-trashed-restore"');
    expect(edit).toContain('Restore 4 artboards');
    const view = renderToStaticMarkup(createElement(AllTrashedCard, { model, canEdit: false }));
    expect(view).toContain('LetakA6 has no artboards left.');
    expect(view).toContain('Jonas moved all four to the trash 10 min ago.');
    expect(view).not.toContain('all-trashed-restore');
    expect(view).not.toContain('<button');
  });

  test('a note (a refused restore) is the card’s foot line', () => {
    const html = renderToStaticMarkup(
      createElement(AllTrashedCard, { model, canEdit: true, note: 'Nothing was changed.' })
    );
    expect(html).toContain('Nothing was changed.');
  });
});

/** A fake studio: records every call, answers per route. */
function fakeFetch(
  handlers: Record<string, (body: any, url: string) => { status?: number; json: unknown }>
) {
  const calls: { method: string; url: string; body: any }[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    const key = `${method} ${url.split('?')[0]}`;
    const h = handlers[key];
    const out = h ? h(body, url) : { status: 404, json: { ok: false } };
    return new Response(JSON.stringify(out.json), { status: out.status ?? 200 });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

describe('Restore N', () => {
  test('one POST /_api/trash/restore per id, each id once, in order; the action ids are kept', async () => {
    let n = 0;
    const f = fakeFetch({
      'POST /_api/trash/restore': () => ({ json: { ok: true, actionId: `act${++n}` } }),
    });
    const r = await restoreAll(FOUR, { fetchImpl: f.impl });
    expect(f.calls.map((c) => c.body.id)).toEqual(FOUR.map((i) => i.id));
    expect(new Set(f.calls.map((c) => c.body.id)).size).toBe(4);
    expect(r.restored).toHaveLength(4);
    expect(r.actionIds).toEqual(['act1', 'act2', 'act3', 'act4']);
    const out = restoreOutcome(r, 4);
    expect(out).toEqual({
      ok: true,
      line: '4 artboards are back where they were.',
      undo: ['act1', 'act2', 'act3', 'act4'],
    });
  });

  test('Undo is ONE step: a single POST /_api/project/undo with every action id', async () => {
    const f = fakeFetch({ 'POST /_api/project/undo': () => ({ json: { ok: true } }) });
    expect(await undoRestore(['act1', 'act2', 'act3', 'act4'], { fetchImpl: f.impl })).toBe(true);
    expect(f.calls).toHaveLength(1);
    expect(f.calls[0].body).toEqual({ actionIds: ['act1', 'act2', 'act3', 'act4'] });
    const refused = fakeFetch({
      'POST /_api/project/undo': () => ({ status: 409, json: { ok: false } }),
    });
    expect(await undoRestore(['a'], { fetchImpl: refused.impl })).toBe(false);
  });

  test('one refused restore stops nothing: the rest come back, the line says how many', async () => {
    const f = fakeFetch({
      'POST /_api/trash/restore': (b) =>
        b.id.endsWith('/tackle-c')
          ? { status: 409, json: { ok: false, reason: 'not-in-trash' } }
          : { json: { ok: true, actionId: `x-${b.id}` } },
    });
    const r = await restoreAll(FOUR, { fetchImpl: f.impl });
    expect(f.calls).toHaveLength(4);
    expect(r.restored).toHaveLength(3);
    const out = restoreOutcome(r, 4);
    expect(out.ok).toBe(false);
    expect(out.line).toBe(
      '3 of 4 came back. Someone already restored it. The rest are still in the trash.'
    );
    expect(out.undo).toHaveLength(3);
  });

  test('a server that cannot splice yet (501 not-yet) changes nothing and says why', async () => {
    const f = fakeFetch({
      'POST /_api/trash/restore': () => ({
        status: 501,
        json: {
          ok: false,
          reason: 'not-yet',
          line: 'Restoring one artboard comes with Version history',
        },
      }),
    });
    const r = await restoreAll(FOUR, { fetchImpl: f.impl });
    const out = restoreOutcome(r, 4);
    expect(out.ok).toBe(false);
    expect(out.line).toBe('Restoring one artboard comes with Version history Nothing was changed.');
    expect(out.undo).toBeNull();
  });

  test('without action ids from the server there is no Undo to offer', () => {
    expect(restoreOutcome({ restored: ['a', 'b'], failed: [], actionIds: [] }, 2).undo).toBeNull();
  });
});

describe('the host (a canvas with no artboards left)', () => {
  let dom = false;
  beforeAll(() => {
    GlobalRegistrator.register();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
      true;
    dom = true;
  });
  afterAll(() => {
    if (dom) GlobalRegistrator.unregister();
  });

  function studio(role: 'edit' | 'view') {
    let n = 0;
    return fakeFetch({
      'GET /_api/trash': () => ({ json: { ok: true, items: TRASH, canClear: false, seq: 4 } }),
      'POST /_api/trash/restore': () =>
        role === 'view'
          ? { status: 403, json: { ok: false, reason: 'forbidden' } }
          : { json: { ok: true, actionId: `act${++n}` } },
      'POST /_api/project/undo': () => ({ json: { ok: true } }),
      'GET /_api/project/source': (_b, url) => {
        const lane = new URL(url, 'http://x').searchParams.get('lane');
        return lane === 'meta'
          ? {
              json: {
                ok: true,
                source: JSON.stringify({
                  layout: {
                    artboards: [
                      { id: 'flag-a', x: 330, y: 120 },
                      { id: 'flag-b', x: 540, y: 120 },
                      { id: 'tackle-c', x: 750, y: 120 },
                      { id: 'tackle-d', x: 960, y: 120 },
                    ],
                  },
                }),
              },
            }
          : {
              json: {
                ok: true,
                source: ['flag-a', 'flag-b', 'tackle-c', 'tackle-d']
                  .map((id) => `<DCArtboard id="${id}" label="x" width={180} height={254}>`)
                  .join('\n'),
              },
            };
      },
    });
  }

  async function mount(props: Record<string, unknown>) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(AllTrashed, props as never));
    });
    // the trash read and the ghost read settle
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    return { host, root };
  }

  const baseProps = (f: ReturnType<typeof fakeFetch>, extra: Record<string, unknown> = {}) => ({
    activePath: '.design/ui/LetakA6.tsx',
    designRel: '.design',
    artboardCount: 0,
    ready: true,
    canEdit: true,
    fetchImpl: f.impl,
    now: () => NOW,
    lane: { set() {}, stop() {} },
    toast: () => {},
    ...extra,
  });

  test('renders the card from the Trash; a canvas that still has artboards does not even ask', async () => {
    const f = studio('edit');
    const { host, root } = await mount(baseProps(f));
    expect(host.querySelector('[data-testid="all-trashed"]')).not.toBeNull();
    expect(host.textContent).toContain('LetakA6 has no artboards left.');
    expect(host.querySelector('[data-testid="all-trashed-restore"]')?.textContent).toBe(
      'Restore 4 artboards'
    );
    await act(async () => root.unmount());

    const g = studio('edit');
    const again = await mount(baseProps(g, { artboardCount: 3 }));
    expect(again.host.querySelector('[data-testid="all-trashed"]')).toBeNull();
    expect(g.calls.filter((c) => c.url === '/_api/trash')).toHaveLength(0);
    await act(async () => again.root.unmount());
  });

  test('Restore 4 artboards: each id once, the card goes, the toast offers one Undo for all four', async () => {
    const f = studio('edit');
    const toasts: {
      message: string;
      ok?: boolean;
      action?: { label: string; onClick: () => void };
    }[] = [];
    const { host, root } = await mount(
      baseProps(f, {
        toast: (message: string, ok?: boolean, action?: any) =>
          toasts.push({ message, ok, action }),
      })
    );
    const button = host.querySelector('[data-testid="all-trashed-restore"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    const posts = f.calls.filter((c) => c.method === 'POST' && c.url === '/_api/trash/restore');
    expect(posts.map((c) => c.body.id)).toEqual(FOUR.map((i) => i.id));
    expect(host.querySelector('[data-testid="all-trashed"]')).toBeNull();
    expect(toasts).toHaveLength(1);
    expect(toasts[0].message).toBe('4 artboards are back where they were.');
    expect(toasts[0].ok).toBe(true);
    expect(toasts[0].action?.label).toBe('Undo');
    await act(async () => {
      toasts[0].action?.onClick();
      await new Promise((r) => setTimeout(r, 20));
    });
    const undo = f.calls.filter((c) => c.url === '/_api/project/undo');
    expect(undo).toHaveLength(1);
    expect(undo[0].body).toEqual({ actionIds: ['act1', 'act2', 'act3', 'act4'] });
    // and the card is back: they are in the trash again
    expect(host.querySelector('[data-testid="all-trashed"]')).not.toBeNull();
    await act(async () => root.unmount());
  });

  test('Can view: the card without the button; a restore they somehow send is refused (403)', async () => {
    const f = studio('view');
    const { host, root } = await mount(baseProps(f, { canEdit: false }));
    expect(host.querySelector('[data-testid="all-trashed"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="all-trashed-restore"]')).toBeNull();
    expect(host.querySelector('button')).toBeNull();
    await act(async () => root.unmount());
    const r = await restoreAll(FOUR, { fetchImpl: f.impl });
    expect(r.restored).toEqual([]);
    expect(restoreOutcome(r, 4).line).toBe(
      'Your role in this project can’t restore artboards. Nothing was changed.'
    );
  });

  test('a refused restore leaves the card up with the reason as its foot', async () => {
    const f = studio('view');
    const { host, root } = await mount(baseProps(f, { canEdit: true }));
    const button = host.querySelector('[data-testid="all-trashed-restore"]') as HTMLButtonElement;
    await act(async () => {
      button.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(host.querySelector('[data-testid="all-trashed"]')).not.toBeNull();
    expect(host.textContent).toContain('Nothing was changed.');
    await act(async () => root.unmount());
  });

  test('the outlines are handed to the canvas lane with the places the artboards stood in', async () => {
    const f = studio('edit');
    const sets: unknown[][] = [];
    const { root } = await mount(
      baseProps(f, { lane: { set: (...a: unknown[]) => sets.push(a), stop() {} } })
    );
    const last = sets.at(-1) as [string, string, { id: string; rect: unknown }[]];
    expect(last[0]).toBe('.design/ui/LetakA6.tsx');
    expect(last[1]).toBe('ui/LetakA6.tsx');
    expect(last[2].map((g) => g.id)).toEqual(['flag-a', 'flag-b', 'tackle-c', 'tackle-d']);
    expect(last[2][0].rect).toEqual({ x: 330, y: 120, w: 180, h: 254 });
    // one read pair for the one trash action (rev 12 → the canvas as of r11)
    const reads = f.calls.filter((c) => c.url.startsWith('/_api/project/source'));
    expect(reads).toHaveLength(2);
    expect(reads.every((c) => c.url.includes('at=r11'))).toBe(true);
    await act(async () => root.unmount());
  });
});

describe('the outlines', () => {
  const META = JSON.stringify({
    layout: {
      artboards: [
        { id: 'a', x: 10, y: 20 },
        { id: 'b', x: 5, y: 6 },
      ],
    },
  });
  const HTML = [
    '<DCArtboard id="a" label="A" width={180} height={254}>',
    '<DCArtboard label="B" id="b" width="300" height="400" fixed>',
  ].join('\n');

  test('x / y from the meta layout, width / height from the JSX; unknown stays null', () => {
    const r = rectsFromVersion(META, HTML, ['a', 'b', 'c']);
    expect(r.a).toEqual({ x: 10, y: 20, w: 180, h: 254 });
    expect(r.b).toEqual({ x: 5, y: 6, w: 300, h: 400 });
    expect(r.c).toBeNull();
    expect(rectsFromVersion('not json', HTML, ['a']).a).toBeNull();
    expect(rectsFromVersion(META, null, ['a']).a).toBeNull();
    // a regex-special id cannot break the lookup
    expect(rectsFromVersion(META, HTML, ['a.*'])['a.*']).toBeNull();
  });

  test('Can view (the source is refused): every rect is null, the card still has its words', async () => {
    const f = fakeFetch({
      'GET /_api/project/source': () => ({ status: 403, json: { ok: false, reason: 'forbidden' } }),
    });
    const model = allTrashedModel(FOUR, PATH, NOW) as NonNullable<
      ReturnType<typeof allTrashedModel>
    >;
    const g = await loadGhosts(model, { fetchImpl: f.impl });
    expect(g.map((x: { rect: unknown }) => x.rect)).toEqual([null, null, null, null]);
    expect(g[0].label).toBe('A · přední FLAG');
  });
});

describe('the relay to the canvas', () => {
  function frame(path: string) {
    const sent: unknown[] = [];
    const el = document.createElement('iframe');
    el.setAttribute('data-testid', 'canvas-frame');
    el.setAttribute('data-path', path);
    Object.defineProperty(el, 'contentWindow', {
      value: { postMessage: (m: unknown) => sent.push(m) },
    });
    document.body.append(el);
    return { sent, el, win: (el as unknown as { contentWindow: Window }).contentWindow };
  }
  let dom = false;
  beforeAll(() => {
    if (!('document' in globalThis)) {
      GlobalRegistrator.register();
      dom = true;
    }
  });
  afterAll(() => {
    if (dom) GlobalRegistrator.unregister();
  });

  const GHOSTS = [{ id: 'flag-a', label: 'A', rect: { x: 1, y: 2, w: 3, h: 4 } }];

  test('only the frame of that canvas is told; the same answer is not sent twice; gone outlines are sent as []', () => {
    document.body.innerHTML = '';
    const mine = frame('.design/ui/LetakA6.tsx');
    const other = frame('.design/ui/Other.tsx');
    const lane = createGhostLane({ doc: document, win: window });
    lane.set('.design/ui/LetakA6.tsx', 'ui/LetakA6.tsx', GHOSTS);
    expect(mine.sent).toEqual([
      { dgn: 'trashed-artboards', canvas: 'ui/LetakA6.tsx', items: GHOSTS },
    ]);
    expect(other.sent).toEqual([]); // never spoken to, nothing to say
    lane.set('.design/ui/LetakA6.tsx', 'ui/LetakA6.tsx', GHOSTS);
    expect(mine.sent).toHaveLength(1);
    lane.set(null, '', null);
    expect(mine.sent.at(-1)).toEqual({ dgn: 'trashed-artboards', canvas: '', items: [] });
    lane.stop();
  });

  test('a canvas that has just loaded is told again', () => {
    document.body.innerHTML = '';
    const mine = frame('.design/ui/LetakA6.tsx');
    const lane = createGhostLane({ doc: document, win: window });
    lane.set('.design/ui/LetakA6.tsx', 'ui/LetakA6.tsx', GHOSTS);
    expect(mine.sent).toHaveLength(1);
    const ev = new window.MessageEvent('message', {
      data: { dgn: 'loaded' },
      source: mine.win as never,
    });
    window.dispatchEvent(ev);
    expect(mine.sent).toHaveLength(2);
    lane.stop();
  });
});

describe('the bridge row (trashed-artboards)', () => {
  const row = (
    DGN_TABLE.s2c as Record<
      string,
      { gate: string; parse: (raw: Record<string, unknown>) => unknown }
    >
  )['trashed-artboards'];

  test('parent-gated; ids, labels and rects only', () => {
    expect(row.gate).toBe('parent');
    const ok = {
      canvas: 'ui/LetakA6.tsx',
      items: [
        { id: 'flag-a', label: 'A', rect: { x: 1, y: 2, w: 3, h: 4 } },
        { id: 'flag-b', label: 'B', rect: null },
      ],
    };
    expect(row.parse(ok)).toEqual(ok);
  });

  test('a planted payload is refused whole', () => {
    const base = { id: 'a', label: 'A', rect: null };
    expect(row.parse({ canvas: 'c', items: [{ ...base, label: 'x'.repeat(201) }] })).toBeNull();
    expect(row.parse({ canvas: 'c', items: [{ ...base, id: 'x'.repeat(129) }] })).toBeNull();
    expect(
      row.parse({ canvas: 'c', items: [{ ...base, rect: { x: 'a', y: 1, w: 1, h: 1 } }] })
    ).toBeNull();
    expect(row.parse({ canvas: 'c', items: 'nope' })).toBeNull();
    expect(row.parse({ canvas: 5, items: [] })).toBeNull();
  });
});

describe('the canvas layer draws only what the shell said', () => {
  let dom = false;
  beforeAll(() => {
    if (!('document' in globalThis)) {
      GlobalRegistrator.register();
      (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
        true;
      dom = true;
    }
  });
  afterAll(() => {
    if (dom) GlobalRegistrator.unregister();
  });

  test('outlines in world coordinates, no hit area; an unknown place is left out; the canvas itself cannot say it', async () => {
    const { ArtboardGhostsLayer } = await import('../artboard-ghosts-overlay.tsx');
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    await act(async () => {
      root.render(createElement(ArtboardGhostsLayer));
    });
    expect(host.querySelector('[data-testid="artboard-ghosts"]')).toBeNull();
    const say = async (data: unknown, source: unknown = window.parent) => {
      await act(async () => {
        window.dispatchEvent(new window.MessageEvent('message', { data, source: source as never }));
      });
    };
    await say({
      dgn: 'trashed-artboards',
      canvas: 'ui/LetakA6.tsx',
      items: [
        { id: 'flag-a', label: 'A · přední FLAG', rect: { x: 330, y: 120, w: 180, h: 254 } },
        { id: 'flag-b', label: 'B', rect: null },
      ],
    });
    const ghost = host.querySelector('[data-testid="artboard-ghost-flag-a"]') as HTMLElement | null;
    expect(ghost).not.toBeNull();
    expect(ghost?.style.left).toBe('330px');
    expect(ghost?.style.width).toBe('180px');
    expect(ghost?.textContent).toBe('A · přední FLAG');
    expect(host.querySelector('[data-testid="artboard-ghost-flag-b"]')).toBeNull();
    expect(host.querySelector('[data-testid="artboard-ghosts"]')?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    // a message from anywhere but the shell changes nothing
    const stranger = document.createElement('iframe');
    document.body.append(stranger);
    await say({ dgn: 'trashed-artboards', canvas: 'c', items: [] }, stranger.contentWindow);
    expect(host.querySelector('[data-testid="artboard-ghost-flag-a"]')).not.toBeNull();
    // the shell says they are gone
    await say({ dgn: 'trashed-artboards', canvas: '', items: [] });
    expect(host.querySelector('[data-testid="artboard-ghosts"]')).toBeNull();
    await act(async () => root.unmount());
  });
});

describe('the server (hidden ≠ refused)', () => {
  const claim = (c: unknown) => Buffer.from(JSON.stringify(c)).toString('base64url');
  const LISTING = {
    canvases: [],
    artboards: FOUR.map((i) => ({
      id: i.id,
      entry: i.entry,
      doc: i.doc,
      artboard: i.artboard,
      label: i.label,
      rev: i.rev,
      actionId: i.actionId,
      actor: i.actor,
      at: i.at,
    })),
    live: { n_letak: { doc: 'ui-letaka6', path: PATH } },
    you: null,
  };
  function routes(seen: string[]) {
    return createTrashRoutes({
      control: () => ({ acceptedTrash: async () => structuredClone(LISTING) }) as never,
      access: (req) =>
        trashAccess({
          workspace: true,
          header: req.headers.get('x-maude-access'),
          localRole: null,
        }),
      readSource: () => null,
      restoreArtboard: async (it) => {
        seen.push(it.id);
        return { status: 'accepted', actionId: `act-${it.artboard}` };
      },
    });
  }
  async function restore(specs: ReturnType<typeof routes>, role: string, id: string) {
    const s = specs.find((x) => x.method === 'POST' && x.path === '/_api/trash/restore');
    const res = await s?.handle(
      new Request('http://localhost/_api/trash/restore', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-maude-access': claim({ v: 1, role }) },
        body: JSON.stringify({ id }),
      }),
      {} as never
    );
    return { status: res?.status, body: (await res?.json()) as Record<string, unknown> };
  }

  test('an editor’s artboard restore answers with the action id, so Undo can take every one back together', async () => {
    const seen: string[] = [];
    const r = await restore(routes(seen), 'member', FOUR[0].id);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, id: FOUR[0].id, path: PATH, actionId: 'act-flag-a' });
    expect(seen).toEqual([FOUR[0].id]);
  });

  test('Can view / Can comment: the restore is refused 403 and the splice is never asked', async () => {
    const seen: string[] = [];
    const specs = routes(seen);
    for (const role of ['observer', 'viewer']) {
      const r = await restore(specs, role, FOUR[1].id);
      expect(r).toMatchObject({ status: 403, body: { ok: false, reason: 'forbidden' } });
    }
    expect(seen).toEqual([]);
  });
});
