// S1.8 — the Trash view, rendered over the S1.7 routes: Today / Earlier with who and when, Restore
// (canvas live, an artboard's not-yet line), Clear out… only for the owner (and the 403 line when the
// server refuses anyway), the confirm in the contract's words, the legacy fallback to today's per-Mac
// list, and that list rehomed under Canvases › Advanced as "Kept on this Mac".
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

type Call = { url: string; method: string; body?: string };
let calls: Call[] = [];
const realFetch = globalThis.fetch;

const NOW = new Date(2026, 9, 18, 15, 0, 0).getTime();
const at = (m: number, d: number, h = 12, min = 0) => new Date(2026, m, d, h, min, 0).getTime();

const ITEMS = [
  {
    id: 'canvas:e1',
    kind: 'canvas',
    group: 'today',
    entry: 'e1',
    path: 'ahoj.tsx',
    actor: 'local:m1',
    mine: true,
    at: NOW - 5_000,
    rev: 9,
  },
  {
    id: 'artboard:a1/arch2',
    kind: 'artboard',
    group: 'today',
    entry: 'e9',
    artboard: 'arch2',
    label: 'Arch 2 · vnitřek',
    path: 'ui/Combine-kampan.tsx',
    actor: 'hub:jonas',
    who: 'Jonas',
    at: at(9, 18, 14, 5),
    rev: 8,
  },
  {
    id: 'canvas:e2',
    kind: 'canvas',
    group: 'earlier',
    entry: 'e2',
    path: 'legacy/letak-nabor-2022-old.tsx',
    actor: 'hub:tereza',
    who: 'Tereza',
    at: at(9, 3),
    rev: 4,
  },
  {
    id: 'canvas:e3',
    kind: 'canvas',
    group: 'earlier',
    entry: 'e3',
    path: '2026/social/Super-Bowl-Watch-Party — kopie.tsx',
    actor: 'local:m1',
    mine: true,
    at: at(8, 28),
    rev: 2,
  },
];

const KEPT = {
  entries: [
    {
      trashRel: '_trash/old/ahoj.tsx',
      sourceRel: 'ui/ahoj.tsx',
      reason: 'conflict',
      at: NOW - 86_400_000 * 3,
      size: 5,
    },
  ],
  total: 1,
  bytes: 5,
};

type Reply = { status?: number; body: unknown };
let replies: Record<string, Reply | ((c: Call) => Reply)> = {};

function install(r: Record<string, Reply | ((c: Call) => Reply)>) {
  calls = [];
  replies = r;
  globalThis.fetch = (async (url: string, init?: { method?: string; body?: string }) => {
    const c: Call = { url, method: init?.method ?? 'GET', body: init?.body };
    calls.push(c);
    const key = `${c.method} ${c.url}`;
    const h = replies[key];
    const out: Reply = typeof h === 'function' ? h(c) : (h ?? { body: { ok: true } });
    return new Response(JSON.stringify(out.body), { status: out.status ?? 200 });
  }) as unknown as typeof fetch;
}

const shared = (over: Record<string, unknown> = {}) => ({
  body: { ok: true, items: ITEMS, canClear: true, seq: 1, ...over },
});

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  globalThis.fetch = realFetch;
  GlobalRegistrator.unregister();
});
const roots: Root[] = [];
afterEach(async () => {
  for (const r of roots.splice(0)) await act(async () => r.unmount());
  document.body.innerHTML = '';
});

const wait = (ms: number) => act(async () => new Promise((r) => setTimeout(r, ms)));

async function mountView(props: Record<string, unknown> = {}) {
  const { TrashView } = await import('../client/v2/left-panel/trash-view.jsx');
  const { useTrash } = await import('../client/v2/left-panel/use-trash.js');
  function Harness() {
    const { trash, reload } = useTrash({ enabled: true });
    return <TrashView trash={trash} onChanged={reload} onBack={() => {}} now={NOW} {...props} />;
  }
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  roots.push(root);
  await act(async () => root.render(<Harness />));
  await wait(320); // the read is debounced 250 ms
  await wait(20);
  return host;
}
const q = (host: HTMLElement, id: string) =>
  host.querySelector<HTMLElement>(`[data-testid="${id}"]`);
const qa = (host: HTMLElement, id: string) => [
  ...host.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`),
];
const click = (el: Element | null) => {
  if (!el) throw new Error('missing element');
  return act(async () => {
    el.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
  });
};
const posts = () => calls.filter((c) => c.method === 'POST');

describe('S1.8 Trash view — the shared list', () => {
  test('header count, Today / Earlier groups, and each row’s who and when', async () => {
    install({ 'GET /_api/trash': shared(), 'GET /_api/sync/trash': { body: KEPT } });
    const host = await mountView();
    expect(q(host, 'canvases-trash-count')?.textContent).toBe('3 canvases · 1 artboard');
    expect(host.querySelector('[data-mode="shared"]')).not.toBeNull();
    const today = q(host, 'canvases-trash-group-today');
    const earlier = q(host, 'canvases-trash-group-earlier');
    expect(today?.querySelector('h3')?.textContent).toBe('Today');
    expect(earlier?.querySelector('h3')?.textContent).toBe('Earlier');
    expect(qa(today as HTMLElement, 'canvases-trash-item').length).toBe(2);
    expect(qa(earlier as HTMLElement, 'canvases-trash-item').length).toBe(2);
    const subs = qa(host, 'canvases-trash-sub').map((s) => s.textContent);
    expect(subs).toEqual([
      'root · You, just now',
      'artboard of Combine-kampan · Jonas, 14:05',
      'legacy · Tereza, 3 Oct',
      '2026/social · You, 28 Sep',
    ]);
    expect(q(host, 'canvases-trash-foot')?.textContent).toContain('Kept until you clear it out.');
  });

  test('an empty shared Trash says so in the contract’s words and offers no Clear out', async () => {
    install({
      'GET /_api/trash': shared({ items: [] }),
      'GET /_api/sync/trash': { body: { entries: [], total: 0, bytes: 0 } },
    });
    const host = await mountView();
    expect(q(host, 'canvases-trash-empty')?.textContent).toContain('Trash is empty.');
    expect(q(host, 'canvases-trash-clear')).toBeNull();
    expect(q(host, 'canvases-trash-count')).toBeNull();
  });

  test('Restore a canvas posts its id, says so, and re-reads the list', async () => {
    install({
      'GET /_api/trash': shared(),
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/trash/restore': {
        body: { ok: true, id: 'canvas:e1', path: 'ahoj.tsx', renamed: false },
      },
    });
    const host = await mountView();
    const reads = calls.filter((c) => c.url === '/_api/trash').length;
    await click(qa(host, 'canvases-trash-restore')[0] ?? null);
    expect(posts().map((c) => [c.url, JSON.parse(c.body ?? '{}')])).toEqual([
      ['/_api/trash/restore', { id: 'canvas:e1' }],
    ]);
    expect(q(host, 'canvases-trash-note')?.textContent).toBe('Restored “ahoj”.');
    expect(calls.filter((c) => c.url === '/_api/trash').length).toBe(reads + 1);
  });

  test('an artboard’s Restore shows the not-yet line quietly and the row stays', async () => {
    install({
      'GET /_api/trash': shared(),
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/trash/restore': {
        status: 501,
        body: {
          ok: false,
          reason: 'not-yet',
          line: 'Restoring one artboard comes with Version history',
        },
      },
    });
    const host = await mountView();
    const row = host.querySelector('[data-id="artboard:a1/arch2"]') as HTMLElement;
    await click(row.querySelector('[data-testid="canvases-trash-restore"]'));
    expect(JSON.parse(posts()[0]?.body ?? '{}')).toEqual({ id: 'artboard:a1/arch2' });
    const note = q(host, 'canvases-trash-note');
    expect(note?.textContent).toBe('Restoring one artboard comes with Version history.');
    expect(note?.getAttribute('data-outcome')).toBe('not-yet');
    expect(note?.className).not.toContain('lp-note--err'); // not an alarm
    expect(host.querySelector('[data-id="artboard:a1/arch2"]')).not.toBeNull();
  });
});

describe('S1.8 Trash view — who may clear out', () => {
  test('an owner sees Clear out…, the confirm uses the contract’s words, Cancel does nothing', async () => {
    install({ 'GET /_api/trash': shared(), 'GET /_api/sync/trash': { body: KEPT } });
    const host = await mountView({ projectName: 'Alligators brand' });
    await click(q(host, 'canvases-trash-clear'));
    const ask = q(host, 'canvases-trash-ask');
    expect(ask?.textContent).toContain('Clear out the trash?');
    expect(q(host, 'canvases-trash-ask-body')?.textContent).toBe(
      '3 canvases and 1 artboard go for good — for everyone on Alligators brand. Restore can’t bring them back after this.'
    );
    expect(q(host, 'canvases-trash-clear-yes')?.textContent).toBe('Clear out');
    await click(q(host, 'canvases-trash-clear-cancel'));
    expect(q(host, 'canvases-trash-ask')).toBeNull();
    expect(posts().length).toBe(0);
  });

  test('confirming posts the clear-out once and says how many went', async () => {
    install({
      'GET /_api/trash': shared(),
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/trash/clear': { body: { ok: true, cleared: ITEMS.map((i) => i.id) } },
    });
    const host = await mountView();
    await click(q(host, 'canvases-trash-clear'));
    await click(q(host, 'canvases-trash-clear-yes'));
    expect(posts().map((c) => c.url)).toEqual(['/_api/trash/clear']);
    expect(q(host, 'canvases-trash-note')?.textContent).toBe('Cleared out 4.');
  });

  test('an editor (canClear false) sees Restore and no Clear out…', async () => {
    install({
      'GET /_api/trash': shared({ canClear: false }),
      'GET /_api/sync/trash': { body: KEPT },
    });
    const host = await mountView();
    expect(qa(host, 'canvases-trash-restore').length).toBe(4);
    expect(q(host, 'canvases-trash-clear')).toBeNull();
  });

  test('hidden is not refused: if the server answers 403 anyway the view says so', async () => {
    install({
      'GET /_api/trash': shared(),
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/trash/clear': { status: 403, body: { ok: false, reason: 'forbidden' } },
    });
    const host = await mountView();
    await click(q(host, 'canvases-trash-clear'));
    await click(q(host, 'canvases-trash-clear-yes'));
    expect(q(host, 'canvases-trash-note')?.textContent).toBe(
      'Only an owner clears out the trash. Nothing was changed.'
    );
    expect(q(host, 'canvases-trash-note')?.getAttribute('data-outcome')).toBe('refused');
  });

  test('a viewer (read-only) sees the list but neither Restore nor Clear out…', async () => {
    install({ 'GET /_api/trash': shared(), 'GET /_api/sync/trash': { body: KEPT } });
    const host = await mountView({ readOnly: true });
    expect(qa(host, 'canvases-trash-item').length).toBe(4);
    expect(qa(host, 'canvases-trash-restore').length).toBe(0);
    expect(q(host, 'canvases-trash-clear')).toBeNull();
  });
});

describe('S1.8 Trash view — legacy fallback and Kept on this Mac', () => {
  test('legacy: true falls back to today’s per-Mac list, whose Restore keeps its own route', async () => {
    install({
      'GET /_api/trash': { body: { ok: true, legacy: true, items: [], canClear: false, seq: 0 } },
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/sync/trash': { body: { ok: true, restoredTo: 'ui/ahoj.tsx' } },
    });
    const host = await mountView();
    expect(host.querySelector('[data-mode="legacy"]')).not.toBeNull();
    expect(q(host, 'canvases-trash-count')).toBeNull();
    expect(qa(host, 'canvases-trash-item').length).toBe(1);
    expect(qa(host, 'canvases-trash-group-today').length).toBe(0);
    await click(q(host, 'canvases-trash-restore'));
    expect(posts()[0]?.url).toBe('/_api/sync/trash');
    expect(JSON.parse(posts()[0]?.body ?? '{}')).toEqual({
      action: 'restore',
      trashRel: KEPT.entries[0]?.trashRel,
    });
    // …and its Clear out… is today’s ≥ 1-day prune, which asks first
    await click(q(host, 'canvases-trash-clear'));
    await click(q(host, 'canvases-trash-clear-yes'));
    expect(JSON.parse(posts()[1]?.body ?? '{}').action).toBe('prune');
  });

  test('an answer the studio does not know (no items) is the same fallback, not a crash', async () => {
    install({
      'GET /_api/trash': { status: 404, body: { ok: false } },
      'GET /_api/sync/trash': { body: KEPT },
    });
    const host = await mountView();
    expect(host.querySelector('[data-mode="legacy"]')).not.toBeNull();
    expect(qa(host, 'canvases-trash-item').length).toBe(1);
  });

  test('Kept on this Mac sits under Advanced when the shared Trash answers, with the old test ids', async () => {
    install({
      'GET /_api/trash': shared(),
      'GET /_api/sync/trash': { body: KEPT },
      'POST /_api/sync/trash': { body: { ok: true } },
    });
    const { KeptRow } = await import('../client/v2/canvases/kept-on-this-mac.jsx');
    const { useTrash } = await import('../client/v2/left-panel/use-trash.js');
    function Adv() {
      const { trash, reload } = useTrash({ enabled: true });
      return <KeptRow kept={trash && !trash.legacy ? trash.kept : null} onChanged={reload} />;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<Adv />));
    await wait(340);
    expect(q(host, 'canvases-kept')?.textContent).toContain('Kept on this Mac');
    expect(q(host, 'canvases-kept')?.textContent).toContain('1 thing');
    expect(qa(host, 'canvases-trash-item').length).toBe(0); // closed to start
    await click(q(host, 'canvases-kept-toggle'));
    expect(qa(host, 'canvases-trash-item').length).toBe(1);
    await click(q(host, 'canvases-trash-restore'));
    expect(posts()[0]?.url).toBe('/_api/sync/trash');
  });

  test('a viewer has no Kept on this Mac row, and an empty list has none either', async () => {
    const { KeptRow } = await import('../client/v2/canvases/kept-on-this-mac.jsx');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<KeptRow kept={KEPT} readOnly />));
    expect(q(host, 'canvases-kept')).toBeNull();
    await act(async () => root.render(<KeptRow kept={{ entries: [], total: 0, bytes: 0 }} />));
    expect(q(host, 'canvases-kept')).toBeNull();
  });
});

describe('S1.8 Trash view — it re-reads', () => {
  test('on the bus’s trash:changed (the app shell relays it as a window event)', async () => {
    install({ 'GET /_api/trash': shared(), 'GET /_api/sync/trash': { body: KEPT } });
    const host = await mountView();
    const { TRASH_CHANGED_EVENT } = await import('../client/v2/left-panel/use-trash.js');
    const before = calls.filter((c) => c.url === '/_api/trash').length;
    install({
      'GET /_api/trash': shared({ items: ITEMS.slice(0, 1), seq: 2 }),
      'GET /_api/sync/trash': { body: KEPT },
    });
    await act(async () => {
      window.dispatchEvent(new window.CustomEvent(TRASH_CHANGED_EVENT, { detail: { seq: 2 } }));
    });
    await wait(320);
    expect(before).toBe(1);
    expect(calls.filter((c) => c.url === '/_api/trash').length).toBe(1);
    expect(qa(host, 'canvases-trash-item').length).toBe(1);
    expect(q(host, 'canvases-trash-count')?.textContent).toBe('1 canvas');
  });

  test('on canvas-list-update (the tree re-stamps the hook)', async () => {
    install({ 'GET /_api/trash': shared(), 'GET /_api/sync/trash': { body: KEPT } });
    const { useTrash } = await import('../client/v2/left-panel/use-trash.js');
    function H({ stamp }: { stamp: number }) {
      const { items } = useTrash({ enabled: true, stamp });
      return <span data-testid="n">{items.length}</span>;
    }
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    roots.push(root);
    await act(async () => root.render(<H stamp={0} />));
    await wait(340);
    expect(q(host, 'n')?.textContent).toBe('4');
    install({ 'GET /_api/trash': shared({ items: [] }), 'GET /_api/sync/trash': { body: KEPT } });
    await act(async () => root.render(<H stamp={1} />));
    await wait(340);
    expect(q(host, 'n')?.textContent).toBe('0');
  });
});
