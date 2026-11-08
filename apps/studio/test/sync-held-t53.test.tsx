// #167 T5.3 — the held row in Sync details, the client half.
//
//   overflow — the hub's owner read carries `heldOverflow` when its hold list may be short (the hold
//              cap or a cut walk): files it could not name are held back too. The row says so, even
//              when it lists nothing.
//   item 9   — the held row's buttons ("Adopt as code", "Open canvas folders") are action-registry
//              entries run through the one runner, not a new key handler.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { codeHeldDetail, filePlaneHeld } from '../sync/index.ts';
import { fetchJournal } from '../sync/journal-client.ts';

const HUB = 'https://hub.test';
const SHA = 'a1b2c3d4'.repeat(8);

function hubWith(extra: Record<string, unknown>) {
  return (async (url: string) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      return new Response(
        JSON.stringify({ epoch: 'epoch-1', head: 0, entries: [], truncated: false, ...extra }),
        { status: 200 }
      );
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

describe('overflow — the held list may be short', () => {
  test('the journal read carries heldOverflow on the held list; only a strict true counts', async () => {
    const page = await fetchJournal({
      hubUrl: HUB,
      token: 't',
      fetchImpl: hubWith({
        held: [{ path: 'brand/x.tsx', reason: 'canvas-before-folders' }],
        heldCount: 1,
        heldOverflow: true,
      }),
    });
    expect(page?.held).toEqual({
      count: 1,
      paths: [{ path: 'brand/x.tsx', reason: 'canvas-before-folders' }],
      overflow: true,
    });
    for (const odd of ['true', 1, {}, false]) {
      const p = await fetchJournal({
        hubUrl: HUB,
        token: 't',
        fetchImpl: hubWith({ held: [], heldCount: 0, heldOverflow: odd }),
      });
      expect(p?.held).toEqual({ count: 0, paths: [] });
    }
  });

  test('an overflowed hold list is a row even when it names no file, and the row says why', () => {
    const held = filePlaneHeld({ codeHeld: { count: 0, paths: [], overflow: true } } as never);
    expect(held).toEqual([
      {
        kind: 'code-held',
        count: 0,
        paths: [],
        overflow: true,
        detail: codeHeldDetail(0, { overflow: true }),
      },
    ]);
    const words = codeHeldDetail(0, { overflow: true });
    expect(words).toContain('couldn’t keep track of every one');
    expect(words).toContain('Nothing was removed.');
    expect(words).toContain('canvas folders');
    expect(words).not.toMatch(/\bwe\b|\bI\b|!/);
  });

  test('with files listed, the sentence adds that more may be held than are listed', () => {
    const one = codeHeldDetail(2, { overflow: true });
    expect(one.startsWith(codeHeldDetail(2))).toBe(true);
    expect(one).toContain('more may be held than are listed');
    // No overflow: the old sentence, unchanged.
    expect(codeHeldDetail(2, { overflow: false })).toBe(codeHeldDetail(2));
    // No overflow and nothing listed: still no row.
    expect(filePlaneHeld({ codeHeld: { count: 0, paths: [] } } as never)).toEqual([]);
  });
});

describe('item 9 — the held row has its buttons (registry entries, not a key handler)', () => {
  let ui: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => ui?.unmount());
    host?.remove();
    ui = null;
    host = null;
  });

  const status = {
    files: {
      synced: 0,
      pulled: 0,
      pushed: 0,
      conflicts: 0,
      held: [
        {
          kind: 'code-held',
          count: 1,
          paths: ['brand/x.tsx'],
          files: [{ path: 'brand/x.tsx', sha256: SHA, size: 40 }],
          detail: codeHeldDetail(1),
        },
      ],
    },
  };

  async function render(props: Record<string, unknown>) {
    host = document.createElement('div');
    document.body.append(host);
    ui = createRoot(host);
    await act(async () => {
      ui?.render(<SyncDetails project="P" status={status as never} {...props} />);
    });
    return host;
  }

  test('both actions are registry rows hidden from ⌘K; Open canvas folders is the Mac app’s door', () => {
    const adopt = ACTIONS_BY_ID.get('sync.adopt-as-code');
    const open = ACTIONS_BY_ID.get('sync.open-canvas-folders');
    expect(adopt?.label).toBe('Adopt as code');
    expect(open?.label).toBe('Open canvas folders');
    expect(open?.exec).toBe('native');
    expect(adopt?.search).toEqual({ hidden: true });
    expect(open?.search).toEqual({ hidden: true });
  });

  test('Adopt as code posts the file to the studio route and says what happened', async () => {
    const calls: { url: string; body: unknown }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const el = await render({ fetchImpl });
    const btn = el.querySelector('[data-testid="diag-sync-held-adopt-0"]') as HTMLButtonElement;
    expect(btn?.textContent).toBe('Adopt as code');
    expect(btn?.getAttribute('data-action')).toBe('sync.adopt-as-code');
    await act(async () => {
      btn.click();
    });
    // (the panel reads its own GETs on mount; the adopt is the one POST)
    expect(calls.filter((c) => c.body !== null)).toEqual([
      { url: '/_api/sync/adopt-held', body: { path: 'brand/x.tsx', sha256: SHA } },
    ]);
    expect(el.querySelector('[data-testid="diag-sync-held-adopt-said-0"]')?.textContent).toBe(
      'Kept as code. It syncs on the next pass.'
    );
  });

  test('a refusal shows the route’s own words', async () => {
    const fetchImpl = (async () =>
      new Response(
        JSON.stringify({
          ok: false,
          detail: 'Only the project owner can keep a held file as code.',
        }),
        { status: 403 }
      )) as unknown as typeof fetch;
    const el = await render({ fetchImpl });
    await act(async () => {
      (el.querySelector('[data-testid="diag-sync-held-adopt-0"]') as HTMLButtonElement).click();
    });
    expect(el.querySelector('[data-testid="diag-sync-held-adopt-said-0"]')?.textContent).toBe(
      'Only the project owner can keep a held file as code.'
    );
  });

  test('Open canvas folders: in the Mac app only, and it runs the registry action', async () => {
    const ran: string[] = [];
    const el = await render({ native: true, runAction: (id: string) => ran.push(id) });
    const btn = el.querySelector(
      '[data-testid="diag-sync-held-open-folders-code-held"]'
    ) as HTMLButtonElement;
    expect(btn?.getAttribute('data-action')).toBe('sync.open-canvas-folders');
    await act(async () => {
      btn.click();
    });
    expect(ran).toEqual(['sync.open-canvas-folders']);
    act(() => ui?.unmount());
    host?.remove();
    const browser = await render({ native: false });
    expect(browser.querySelector('[data-testid="diag-sync-held-open-folders-code-held"]')).toBe(
      null
    );
  });

  test('the shell runner has a handler for it (no dead row)', () => {
    const h = createMenuHandlers({ designRel: '.design', toast() {} } as never);
    expect(typeof h['sync.open-canvas-folders']).toBe('function');
  });
});
