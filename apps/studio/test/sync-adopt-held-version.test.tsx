// Burndown 206/122c F4 — "Adopt as code" adopts exactly the version the owner was shown.
//
// The hub's held list names each held file's version (`sha256`, `size`); the row shows it, and the
// button sends `{ path, sha256 }`. The hub refuses other bytes (409 `changed`) and a caller with no
// version (428 `version-required`) — a teammate who swaps the file between show and click gets
// nothing adopted. This side carries the version and says what happened.

import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

// happy-dom's Request drops the Host header the route's loopback guard reads: keep Bun's.
const NativeRequest = globalThis.Request;

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { legacyClaim, resolveAccess } from '../access/scope.ts';
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import { guardTableRoute } from '../http.ts';
import { createSyncRoutes } from '../routes/sync.ts';
import type { RouteSpec } from '../routes/table.ts';
import { ADOPT_CHANGED, ADOPT_UPDATE, createAdoptHeld } from '../sync/adopt-held.ts';
import { codeHeldDetail, filePlaneHeld } from '../sync/index.ts';
import { fetchJournal } from '../sync/journal-client.ts';

const HUB = 'https://hub.test';
const SHA = 'a1b2c3d4'.repeat(8);
const ROUTE = '/_api/sync/adopt-held';

function harness(status: number) {
  const calls: unknown[] = [];
  const control = createAdoptHeld({
    hubUrl: HUB,
    token: () => 'owner-tok',
    fetchImpl: (async (_url: string, init: RequestInit) => {
      calls.push(JSON.parse(String(init.body)));
      return new Response('{}', { status });
    }) as unknown as typeof fetch,
    runPass: () => {},
  });
  const spec = createSyncRoutes({
    control: () => ({
      restart: async () => ({ syncing: false }),
      current: () => ({ adoptHeld: () => control }),
    }),
    trace: { begin() {}, view: () => null } as never,
    warn: () => {},
    access: () => resolveAccess(legacyClaim('owner')),
  })
    .map(guardTableRoute)
    .find((x) => x.method === 'POST' && x.path === ROUTE) as RouteSpec;
  const post = (body: unknown) =>
    spec.handle(
      new NativeRequest(`http://127.0.0.1:4399${ROUTE}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          host: '127.0.0.1:4399',
          'sec-fetch-site': 'same-origin',
        },
        body: JSON.stringify(body),
      }),
      {}
    );
  return { calls, post };
}

describe('the route carries the shown version to the hub', () => {
  test('{ path, sha256 } reaches the hub door as sent', async () => {
    const h = harness(200);
    const r = await h.post({ path: 'brand/x.tsx', sha256: SHA });
    expect(r.status).toBe(200);
    expect(h.calls).toEqual([{ path: 'brand/x.tsx', sha256: SHA }]);
  });

  test('no version, or not a sha: refused before the hub is asked', async () => {
    const h = harness(200);
    for (const body of [{ path: 'brand/x.tsx' }, { path: 'brand/x.tsx', sha256: 'zz' }]) {
      const r = await h.post(body);
      expect(r.status).toBe(400);
    }
    expect(h.calls).toEqual([]);
  });

  test('the hub’s 409 (swapped between show and click) and 428 (needs a version) say so', async () => {
    const swapped = await (await harness(409).post({ path: 'brand/x.tsx', sha256: SHA })).json();
    expect(swapped).toMatchObject({ ok: false, reason: 'changed', detail: ADOPT_CHANGED });
    const older = await (await harness(428).post({ path: 'brand/x.tsx', sha256: SHA })).json();
    expect(older).toMatchObject({ ok: false, reason: 'update', detail: ADOPT_UPDATE });
    expect(ADOPT_CHANGED).toContain('still held');
    expect(`${ADOPT_CHANGED} ${ADOPT_UPDATE}`).not.toMatch(/\bwe\b|!/);
  });
});

describe('the held list carries each version to the row', () => {
  test('the journal read keeps a valid sha and size, drops junk', async () => {
    const page = await fetchJournal({
      hubUrl: HUB,
      token: 't',
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({
            epoch: 'e',
            head: 0,
            entries: [],
            truncated: false,
            held: [
              { path: 'brand/x.tsx', reason: 'canvas-before-folders', sha256: SHA, size: 1234 },
              { path: 'brand/y.tsx', reason: 'canvas-before-folders', sha256: 'nope', size: -1 },
            ],
            heldCount: 2,
          }),
          { status: 200 }
        )) as unknown as typeof fetch,
    });
    expect(page?.held?.paths).toEqual([
      { path: 'brand/x.tsx', reason: 'canvas-before-folders', sha256: SHA, size: 1234 },
      { path: 'brand/y.tsx', reason: 'canvas-before-folders' },
    ]);
  });

  test('the status row lists the versions beside the paths', () => {
    const held = filePlaneHeld({
      codeHeld: {
        count: 2,
        paths: [
          { path: 'brand/x.tsx', reason: 'canvas-before-folders', sha256: SHA, size: 1234 },
          { path: 'brand/y.tsx', reason: 'canvas-before-folders' },
        ],
      },
    } as never);
    expect(held[0]).toMatchObject({
      kind: 'code-held',
      paths: ['brand/x.tsx', 'brand/y.tsx'],
      files: [{ path: 'brand/x.tsx', sha256: SHA, size: 1234 }],
    });
  });
});

describe('the held row shows the version and adopts that one', () => {
  let ui: Root | null = null;
  let host: HTMLElement | null = null;
  afterEach(() => {
    act(() => ui?.unmount());
    host?.remove();
    ui = null;
    host = null;
  });

  async function render(fetchImpl: typeof fetch, files: unknown[]) {
    const status = {
      files: {
        synced: 0,
        pulled: 0,
        pushed: 0,
        conflicts: 0,
        held: [
          {
            kind: 'code-held',
            count: 2,
            paths: ['brand/x.tsx', 'brand/y.tsx'],
            files,
            detail: codeHeldDetail(2),
          },
        ],
      },
    };
    host = document.createElement('div');
    document.body.append(host);
    ui = createRoot(host);
    await act(async () => {
      ui?.render(<SyncDetails project="P" status={status as never} fetchImpl={fetchImpl} />);
    });
    return host;
  }

  test('the row names size and version; the button posts that version; a file with none has no button', async () => {
    const posts: unknown[] = [];
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      if (init?.body) posts.push(JSON.parse(String(init.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as unknown as typeof fetch;
    const el = await render(fetchImpl, [{ path: 'brand/x.tsx', sha256: SHA, size: 1234 }]);
    expect(el.querySelector('[data-testid="diag-sync-held-version-0"]')?.textContent).toBe(
      '1.2 KB · version a1b2c3d4'
    );
    expect(el.querySelector('[data-testid="diag-sync-held-adopt-1"]')).toBe(null);
    expect(el.querySelector('[data-testid="diag-sync-held-adopt-said-1"]')?.textContent).toBe(
      ADOPT_UPDATE
    );
    await act(async () => {
      (el.querySelector('[data-testid="diag-sync-held-adopt-0"]') as HTMLButtonElement).click();
    });
    expect(posts).toEqual([{ path: 'brand/x.tsx', sha256: SHA }]);
  });
});
