// p8-held-surface — the owner sees what the hub holds back from the code lane.
//
// The hub (apps/hub file-manifest.mjs `hubCheckoutClass`) holds a path as `never` when it was a
// canvas only because no canvas folders were declared and the owner's declaration now makes it
// code (decision maude/v2-p8-boundary-harden-config-never-promotes-to-code). Held = not synced,
// not committed. Without this surface it was a silent failure: the hub knew, the owner never did.
//
// The whole desktop path is pinned here: the journal read parses the owner-only `held` list
// (shape-checked — the hub is untrusted to peers, DDR-054), a real file-plane pass carries it
// into its result, `filePlaneHeld` turns it into a Sync details row with its reason, the status
// store keeps it, and Sync details renders the row with its sentence and its files.

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import { syncDetailsModel } from '../client/v2/diagnostics/sync-details/sync-details-model.js';
import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane } from '../sync/file-plane.ts';
import { codeHeldDetail, filePlaneHeld } from '../sync/index.ts';
import { fetchJournal } from '../sync/journal-client.ts';
import { createSyncStatusStore, type SyncStatusPayload } from '../sync/status.ts';

const HUB = 'https://hub.test';

/** A hub whose journal answers one empty page — plus, for the owner, what it holds. */
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

const OWNER_PAGE = {
  held: [
    { path: 'brand/x.tsx', reason: 'canvas-before-folders' },
    { path: 'components/Button.tsx', reason: 'changed-as-canvas' },
  ],
  heldCount: 2,
};

describe('the journal read parses the owner-only held list', () => {
  test('an owner page carries each path with its reason', async () => {
    const page = await fetchJournal({ hubUrl: HUB, token: 't', fetchImpl: hubWith(OWNER_PAGE) });
    expect(page?.held).toEqual({
      count: 2,
      paths: [
        { path: 'brand/x.tsx', reason: 'canvas-before-folders' },
        { path: 'components/Button.tsx', reason: 'changed-as-canvas' },
      ],
    });
  });

  test('a non-owner page (no field) carries none', async () => {
    const page = await fetchJournal({ hubUrl: HUB, token: 't', fetchImpl: hubWith({}) });
    expect(page?.held).toBeUndefined();
  });

  test('a hostile list is shape-checked: bad paths dropped, the count never below the list', async () => {
    const page = await fetchJournal({
      hubUrl: HUB,
      token: 't',
      fetchImpl: hubWith({
        held: [
          { path: '../../etc/passwd', reason: 'canvas-before-folders' },
          { path: '/abs.tsx' },
          'brand/y.tsx',
          { path: 'brand/ok.tsx', reason: '<script>' },
        ],
        heldCount: -5,
      }),
    });
    expect(page?.held).toEqual({
      count: 1,
      paths: [{ path: 'brand/ok.tsx', reason: 'canvas-before-folders' }],
    });
  });
});

describe('a file-plane pass reports it, and Sync details shows it with its reason', () => {
  let root: string;
  let ledger: FileLedger;
  let ui: Root | null = null;
  let host: HTMLElement | null = null;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'held-surface-'));
    mkdirSync(join(root, 'ui'), { recursive: true });
    writeFileSync(join(root, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    ledger = createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0 });
  });
  afterEach(() => {
    act(() => ui?.unmount());
    host?.remove();
    ui = null;
    rmSync(root, { recursive: true, force: true });
  });

  const pass = (fetchImpl: typeof fetch) =>
    createFilePlane({
      designRoot: root,
      hubUrl: HUB,
      token: () => 'tok',
      ledger,
      allowCodeModules: true,
      label: 'owner-mac',
      fetchImpl,
      log: { log() {}, warn() {} },
      now: () => 1_700_000_000_000,
    }).reconcile();

  test('owner: the pass carries the held list and the panel row says what to do', async () => {
    const result = await pass(hubWith(OWNER_PAGE));
    expect(result.codeHeld?.count).toBe(2);

    const held = filePlaneHeld(result);
    const row = held.find((h) => h.kind === 'code-held');
    expect(row).toEqual({
      kind: 'code-held',
      count: 2,
      paths: ['brand/x.tsx', 'components/Button.tsx'],
      detail: codeHeldDetail(2),
    });
    // The reason, in the user's words (CONTRACT §4: what happened · what is safe · one verb).
    expect(row?.detail).toContain('before the canvas folders were set');
    expect(row?.detail).toContain('Nothing was removed.');
    expect(row?.detail).toContain('Add their folders to the canvas folders');
    expect(codeHeldDetail(1)).toContain('1 file was made or changed as a canvas');
    expect(codeHeldDetail(1)).toContain('Add its folder to the canvas folders');
    expect(row?.detail).not.toMatch(/\bwe\b|\bI\b|!/);

    // The status store keeps it for the panel.
    const writes: SyncStatusPayload[] = [];
    const store = createSyncStatusStore({
      url: HUB,
      canvases: 1,
      write: (p) => writes.push(p),
      broadcast: () => {},
      now: () => 42,
    });
    store.updateFiles({ synced: 0, pulled: 0, pushed: 0, conflicts: 0, held });
    const status = store.get();
    expect(status.files?.held?.[0]?.kind).toBe('code-held');

    // Sync details: a held row with the sentence and the files — no control, so none dead.
    const m = syncDetailsModel(status, { project: 'Alligators brand' });
    expect(m.lists.held).toEqual([
      {
        kind: 'code-held',
        detail: codeHeldDetail(2),
        paths: ['brand/x.tsx', 'components/Button.tsx'],
      },
    ]);
    host = document.createElement('div');
    document.body.append(host);
    ui = createRoot(host);
    await act(async () => {
      ui?.render(<SyncDetails project="Alligators brand" status={status as never} />);
    });
    const el = document.querySelector('[data-testid="diag-sync-held-code-held"]');
    expect(el?.querySelector('summary')?.textContent).toBe(codeHeldDetail(2));
    expect([...(el?.querySelectorAll('li') ?? [])].map((li) => li.textContent)).toEqual([
      'brand/x.tsx',
      'components/Button.tsx',
    ]);
    expect(el?.querySelectorAll('button').length).toBe(0);
  });

  test('every held sentence reaches the panel whole — a cut one loses its verb', () => {
    const held = filePlaneHeld({
      deleteHeld: { direction: 'out', count: 12, paths: [] },
      firstAnchorHeld: { count: 40, paths: [] },
      reanchorHeld: true,
      codeHeld: { count: 123_456, paths: [] },
    } as never);
    expect(held.map((h) => h.kind)).toEqual([
      'delete-out',
      'first-anchor',
      'code-held',
      'reanchor',
    ]);
    const m = syncDetailsModel({ files: { synced: 0, pulled: 0, pushed: 0, conflicts: 0, held } });
    expect(m.lists.held.map((h: { detail: string }) => h.detail)).toEqual(
      held.map((h) => h.detail)
    );
  });

  test('not the owner (no field) or nothing held: no row', async () => {
    expect(filePlaneHeld(await pass(hubWith({}))).some((h) => h.kind === 'code-held')).toBe(false);
    expect(
      filePlaneHeld(await pass(hubWith({ held: [], heldCount: 0 }))).some(
        (h) => h.kind === 'code-held'
      )
    ).toBe(false);
  });
});
