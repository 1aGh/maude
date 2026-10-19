// S9.21 — Ask to edit, access states, trashed while open (10 co-ask-edit · co-access-ends · co-browser-view ·
// co-trashed; rule access-in-words).
//
// Done when: an ask sends `{ canvas }` only and says the hub's answer in words · the owner's block renders a
// requester's name as text and Let … edit / Not now post the fixed routes · a canvas outside a canvas-only
// session's grants means exactly what a missing canvas means (no oracle) · `maude.access` notices map to the
// card / link card / re-read · the access words and the canvas-only foot · the trashed banner names who and
// when, Restore posts S1's route, and the open-tab ghost row lands in the `trash` source.
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { AccessEndedCard } from '../client/v2/access/access-card.jsx';
import {
  ACCESS_WORDS,
  accessNotice,
  accessOutcome,
  accessSlots,
  accessWord,
  askToEditRequest,
  canvasRel,
  createAccessHandlers,
  requestNotice,
  WORDS,
} from '../client/v2/access/access-client.js';
import { RequestBlocks, ViewOnlyTip } from '../client/v2/access/ask-to-edit.jsx';
import { LinkOffCard } from '../client/v2/access/link-off-card.jsx';
import {
  TrashedBanner,
  trashedTitle,
  trashedWhileOpen,
  trashGhosts,
} from '../client/v2/access/trashed-banner.jsx';
import { getRowSlots, resetRowSlots, setGhostRows } from '../client/v2/canvases/row-slots.js';

type Call = { method: string; url: string; body: unknown };
function fakeFetch(answers: Record<string, { status: number; body?: unknown }>) {
  const calls: Call[] = [];
  const impl = (async (url: string, init: RequestInit = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ method, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
    const a = answers[`${method} ${url}`] ?? { status: 404, body: { reason: 'gone' } };
    return new Response(a.body === undefined ? '' : JSON.stringify(a.body), { status: a.status });
  }) as unknown as typeof fetch;
  return { calls, impl };
}

beforeAll(() => {
  GlobalRegistrator.register();
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

describe('Ask to edit', () => {
  test('sends { canvas } only and says the answer in words', async () => {
    const f = fakeFetch({ 'POST /_api/share/requests': { status: 201, body: { id: 'req_1' } } });
    const r = await askToEditRequest(
      { canvas: 'ui/Combine-kampan.tsx', note: 'free text' } as never,
      f.impl
    );
    expect(r).toEqual({ ok: true, state: 'asked', words: WORDS.asked });
    expect(f.calls).toEqual([
      { method: 'POST', url: '/_api/share/requests', body: { canvas: 'ui/Combine-kampan.tsx' } },
    ]);
  });

  test('pending, already, queued, rate-limited, offline', async () => {
    const cases: [number, unknown, string][] = [
      [
        409,
        { reason: 'pending', error: 'You already asked. The owner has your request.' },
        'pending',
      ],
      [409, { reason: 'already-can-edit' }, 'already'],
      [202, { queued: true, words: 'Queued — sends when this Mac is online.' }, 'queued'],
      [
        429,
        { reason: 'rate-limited', error: 'You asked several times today. Try again tomorrow.' },
        'limited',
      ],
      [503, { reason: 'unreachable' }, 'unavailable'],
    ];
    for (const [status, body, state] of cases) {
      const f = fakeFetch({ 'POST /_api/share/requests': { status, body } });
      const r = await askToEditRequest({ canvas: null }, f.impl);
      expect([state, r.state]).toEqual([state, state]);
      expect(r.words.length).toBeGreaterThan(0);
    }
  });

  test('the registry handler asks for the open canvas, designRoot-relative, and toasts', async () => {
    const f = fakeFetch({ 'POST /_api/share/requests': { status: 201, body: { id: 'req_1' } } });
    const said: string[] = [];
    const h = createAccessHandlers(
      {
        activePath: '.design/ui/Combine-kampan.tsx',
        designRel: '.design',
        toast: (t: string) => said.push(t),
      },
      f.impl
    );
    await h['share.ask-to-edit']();
    expect(f.calls[0]?.body).toEqual({ canvas: 'ui/Combine-kampan.tsx' });
    expect(said).toEqual([WORDS.asked]);
    expect(canvasRel('__system__')).toBe(null);
    expect(canvasRel('.design/../x.tsx')).toBe(null);
  });

  test('the tip says why the drag did nothing', () => {
    const html = renderToStaticMarkup(
      createElement(ViewOnlyTip, { canvas: 'ui/Combine-kampan.tsx' })
    );
    expect(html).toContain('You can look at Combine-kampan, not change it.');
    expect(html).toContain('Ask to edit, top right, sends a request to its owner.');
    expect(html).toContain('data-testid="access-view-tip"');
  });
});

describe('the owner’s request block', () => {
  test('a name is text, never markup; Let … edit and Not now post the fixed routes', async () => {
    const f = fakeFetch({
      'GET /_api/share/requests': {
        status: 200,
        body: {
          requests: [
            {
              id: 'req_1',
              from: { name: 'Petra <img src=x onerror=alert(1)>' },
              canvas: 'ui/Combine-kampan.tsx',
              at: 1,
            },
          ],
        },
      },
      'POST /_api/share/requests/req_1/approve': { status: 200, body: { ok: true } },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let answered = 0;
    await act(async () => {
      root.render(
        createElement(RequestBlocks, {
          fetchImpl: f.impl,
          now: 120_001,
          onAnswered: () => answered++,
        })
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(host.querySelector('img')).toBe(null);
    const block = host.querySelector('[data-testid="share-request-req_1"]');
    expect(block?.textContent).toContain(
      'Petra <img src=x onerror=alert(1)> asks to edit Combine-kampan'
    );
    expect(block?.textContent).toContain('2 min ago · can view it now');
    expect(host.querySelector('[data-testid="share-request-approve-req_1"]')?.textContent).toBe(
      'Let Petra edit'
    );
    await act(async () => {
      (
        host.querySelector('[data-testid="share-request-approve-req_1"]') as HTMLButtonElement
      ).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET /_api/share/requests',
      'POST /_api/share/requests/req_1/approve',
      'GET /_api/share/requests',
    ]);
    expect(answered).toBe(1);
    await act(async () => root.unmount());
    host.remove();
  });

  test('the owner’s toast reads the name and the canvas only', () => {
    expect(
      requestNotice({
        type: 'maude.access-request',
        id: 'req_1',
        from: { name: 'Petra' },
        canvas: 'ui/Combine-kampan.tsx',
        note: 'x',
      })
    ).toEqual({ id: 'req_1', text: 'Petra asks to edit Combine-kampan', action: 'Review' });
    expect(requestNotice({ type: 'maude.access', id: 'x' })).toBe(null);
  });
});

describe('access states', () => {
  test('a canvas outside a canvas-only session means exactly what a missing canvas means', () => {
    const outside = accessOutcome(403, {
      error: 'not-in-scope',
      reason: 'not-in-scope',
      message: 'Ask the owner to change this.',
    });
    const missing = accessOutcome(404, null);
    expect(outside).toEqual({ kind: 'missing' });
    expect(missing).toEqual(outside);
  });

  test('removed → the access card; link off → the link card; a plain refusal is not an access state', () => {
    expect(accessOutcome(401, { reason: 'access-withdrawn' })).toEqual({
      kind: 'ended',
      reason: 'removed',
    });
    expect(accessOutcome(403, { reason: 'link-off' })).toEqual({ kind: 'link-off' });
    expect(accessOutcome(403, { reason: 'read-only' })).toBe(null);
    expect(accessNotice({ type: 'maude.access', change: 'ended', reason: 'link-off' })).toEqual({
      kind: 'link-off',
    });
    expect(accessNotice({ type: 'maude.access', change: 'ended', reason: 'removed' })).toEqual({
      kind: 'ended',
      reason: 'removed',
    });
    expect(accessNotice({ type: 'maude.access', change: 'raised' })).toEqual({ kind: 'raised' });
    expect(WORDS.raised('Combine-kampan')).toBe('You can edit Combine-kampan now.');
  });

  test('the cards say it plainly and name only the project / the link’s own canvas', () => {
    const ended = renderToStaticMarkup(
      createElement(AccessEndedCard, { project: 'Alligators brand' })
    );
    expect(ended).toContain('You no longer have access to Alligators brand.');
    expect(ended).toContain(
      'Your last changes were saved first. If this is a surprise, ask someone on the team.'
    );
    expect(ended).toContain('Back to Home');
    expect(ended).toContain('data-testid="access-ended-home"');
    const off = renderToStaticMarkup(createElement(LinkOffCard, { canvas: 'Combine-kampan' }));
    expect(off).toContain('This link was turned off.');
    expect(off).toContain('Ask the person who shared Combine-kampan for a new one.');
  });

  test('access in words: the role words and the canvas-only foot', () => {
    expect(ACCESS_WORDS).toEqual({
      owner: 'Owner',
      member: 'Can edit',
      viewer: 'Can comment',
      observer: 'Can view',
    });
    expect(accessWord('observer')).toBe('Can view');
    expect(accessWord('admin')).toBe('');
    const one = accessSlots({
      role: null,
      grants: [{ c: 'ui/Combine-kampan.tsx', r: 'observer' }],
    });
    expect(one.canvasOnly).toBe(true);
    expect(one.foot?.text).toBe('Only Combine-kampan was shared with you.');
    expect(one.rows.get('ui/Combine-kampan.tsx')?.sub.text).toBe('Shared with you · Can view');
    const two = accessSlots({
      role: null,
      grants: [
        { c: 'a.tsx', r: 'viewer' },
        { c: 'b.tsx', r: 'member' },
      ],
    });
    expect(two.foot?.text).toBe('Only these 2 canvases were shared with you.');
    expect(accessSlots({ role: 'member', grants: [{ c: 'a.tsx', r: 'viewer' }] }).foot).toBe(null);
  });
});

describe('trashed while open', () => {
  const item = {
    id: 'canvas:n_cisla',
    kind: 'canvas',
    path: 'ui/Combine-cisla.tsx',
    who: 'Tereza',
    mine: false,
    at: 0,
  };

  test('the banner: who, what, when, and the unsent changes stay with it', () => {
    expect(trashedWhileOpen([item], 'ui/Combine-cisla.tsx')).toBe(item);
    expect(trashedWhileOpen([item], 'ui/other.tsx')).toBe(null);
    expect(trashedTitle(item, 120_000)).toBe('Tereza moved Combine-cisla to the trash · 2 min ago');
    expect(trashedTitle({ ...item, mine: true }, 120_000)).toContain('You moved');
    const html = renderToStaticMarkup(createElement(TrashedBanner, { item, now: 120_000 }));
    expect(html).toContain('You can keep looking. Your unsent changes stay with it.');
    expect(html).toContain('data-testid="canvas-trashed-restore"');
    expect(
      renderToStaticMarkup(createElement(TrashedBanner, { item, canRestore: false }))
    ).not.toContain('canvas-trashed-restore');
  });

  test('Restore posts S1’s route with the item id', async () => {
    const f = fakeFetch({
      'POST /_api/trash/restore': { status: 200, body: { ok: true, path: 'ui/Combine-cisla.tsx' } },
    });
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    let back: string | null = null;
    await act(async () => {
      root.render(
        createElement(TrashedBanner, {
          item,
          fetchImpl: f.impl,
          onRestored: (p: string) => (back = p),
        })
      );
    });
    await act(async () => {
      (host.querySelector('[data-testid="canvas-trashed-restore"]') as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(f.calls).toEqual([
      { method: 'POST', url: '/_api/trash/restore', body: { id: 'canvas:n_cisla' } },
    ]);
    expect(back).toBe('ui/Combine-cisla.tsx');
    await act(async () => root.unmount());
    host.remove();
  });

  test('an open tab on a trashed canvas is a dim ghost row in the `trash` source', () => {
    resetRowSlots();
    const ghosts = trashGhosts([item], ['ui/Combine-cisla.tsx', 'ui/live.tsx'], () => {});
    expect(ghosts.map((g) => [g.path, g.slot.sub.text, g.slot.dim])).toEqual([
      ['ui/Combine-cisla.tsx', 'In the trash · open here', true],
    ]);
    setGhostRows('trash', ghosts);
    expect(getRowSlots().ghosts.map((g: { path: string }) => g.path)).toEqual([
      'ui/Combine-cisla.tsx',
    ]);
    resetRowSlots();
  });
});
