// Round 11 (10 co-sync-offline / co-sync-back): the outbox's REAL projection (outbox/content.ts, over real
// `_state/outbox/<createdAt>-tx_*.json` files) drives the Canvases rows and the queued comment — and a
// comment typed offline is on that same projection (it is a `comments`-lane proposal, V2-1.14 §5.1), so
// nothing here is a second queue.
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { GlobalRegistrator } from '@happy-dom/global-registrator';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { contentView } from '../outbox/content.ts';

let root: Root | null = null;
let host: HTMLElement | null = null;
beforeAll(() => {
  GlobalRegistrator.register();
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});
afterAll(() => {
  GlobalRegistrator.unregister();
});

const stub = (name: string, at: number, ops: object[]) => ({
  file: `${at}-${name}.json`,
  body: {
    transactionId: name,
    createdAt: at,
    action: { kind: 'edit', label: 'x', operations: ops },
  },
});

/** A design root with the outbox a day offline leaves: edits on two canvases, one new comment + one reply. */
function offlineDesignRoot() {
  const dir = mkdtempSync(path.join(tmpdir(), 'r11-outbox-'));
  mkdirSync(path.join(dir, '_state', 'outbox'), { recursive: true });
  const comments = JSON.stringify([
    { id: 'c-old', text: 'sent long ago', thread: [] },
    {
      id: 'c-new',
      text: 'Pruh na rukávu sjednotit s helmou.',
      thread: [{ id: 'r-new', text: 'ok' }],
    },
  ]);
  const entries = [
    stub('tx_a', 1000, [
      { op: 'lane.replace', doc: 'ui-2026-dresy-uniformy-2027', lane: 'html', content: '<x/>' },
    ]),
    stub('tx_b', 2000, [
      {
        op: 'lane.replace',
        doc: 'ui-2026-combine-combine-cisla',
        lane: 'annotations',
        content: '[]',
      },
    ]),
    stub('tx_c', 3000, [
      {
        op: 'lane.replace',
        doc: 'ui-2026-dresy-uniformy-2027',
        lane: 'comments',
        content: comments,
      },
    ]),
  ];
  for (const e of entries)
    writeFileSync(path.join(dir, '_state', 'outbox', e.file), JSON.stringify(e.body));
  return dir;
}

describe('the real outbox projection → rows and queued comment', () => {
  test('byDoc → "not sent" on the two canvases; the comment lane → the unsent ids (accepted ones excluded)', async () => {
    const dir = offlineDesignRoot();
    try {
      const view = {
        content: contentView(dir, { acceptedComments: () => new Set(['c-old']) }),
        intents: [],
      };
      const { rowSyncSlots, queuedCommentIds } = await import(
        '../client/v2/sync-states/sync-states-model.js'
      );
      const canvases = [
        { rel: 'ui/2026/dresy/Uniformy-2027.tsx' },
        { rel: 'ui/2026/combine/Combine-cisla.tsx' },
        { rel: 'ui/2026/combine/Combine-kampan.tsx' },
      ];
      expect([...rowSyncSlots({ kind: 'offline', view, canvases }).keys()].sort()).toEqual([
        'ui/2026/combine/Combine-cisla.tsx',
        'ui/2026/dresy/Uniformy-2027.tsx',
      ]);
      expect([...queuedCommentIds({ kind: 'offline', view })].sort()).toEqual(['c-new', 'r-new']);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('useOutboxWords (hook) — publishes into the row-slots store and the queued-comments store', () => {
  test('offline publishes, back online flips the word, a drained outbox clears both', async () => {
    const slots = await import('../client/v2/canvases/row-slots.js');
    const words = await import('../client/v2/sync-states/row-words.js');
    slots.resetRowSlots();
    const canvases = [{ rel: 'ui/Uniformy-2027.tsx' }, { rel: 'ui/Other.tsx' }];
    const view = {
      content: {
        pending: 2,
        byDoc: { 'ui-uniformy-2027': { count: 2, oldestAt: 1, lanes: [] } },
        comments: ['c1'],
      },
    };
    const seen: Array<ReadonlySet<string>> = [];
    function Probe(p: { kind: string; view: unknown }) {
      words.useOutboxWords({ kind: p.kind, view: p.view, canvases });
      seen.push(words.useQueuedCommentIds());
      return null;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe kind="offline" view={view} />));
    expect(slots.getRowSlots().slotFor('ui/Uniformy-2027.tsx')?.meta?.word).toBe('not sent');
    expect(slots.getRowSlots().slotFor('ui/Other.tsx')).toBeNull();
    expect(seen.at(-1)?.has('c1')).toBe(true);

    await act(async () => root?.render(<Probe kind="syncing" view={view} />));
    expect(slots.getRowSlots().slotFor('ui/Uniformy-2027.tsx')?.meta?.word).toBe('sending');
    expect(seen.at(-1)?.size).toBe(0); // online: the comment is on its way, no "Queued" flash

    await act(async () => root?.render(<Probe kind="saved" view={null} />));
    expect(slots.getRowSlots().slotFor('ui/Uniformy-2027.tsx')).toBeNull();

    await act(async () => root?.render(<Probe kind="offline" view={view} />));
    act(() => root?.unmount());
    root = null;
    expect(slots.getRowSlots().slotFor('ui/Uniformy-2027.tsx')).toBeNull(); // unmount withdraws the words
    slots.resetRowSlots();
  });

  test('the shell’s pushed list (useQueuedMarkedByFile) carries `queued` only while offline, per file', async () => {
    const words = await import('../client/v2/sync-states/row-words.js');
    const byFile = {
      'ui/A.tsx': [{ id: 'c1', text: 'a', thread: [] }],
      'ui/B.tsx': [{ id: 'c9', text: 'b', thread: [] }],
    };
    let out: Record<string, Array<{ queued?: boolean }>> = {};
    function Probe() {
      out = words.useQueuedMarkedByFile(byFile) as typeof out;
      return null;
    }
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(<Probe />));
    expect(out).toBe(byFile); // nothing waits: the very same object
    act(() => words.setQueuedComments(new Set(['c1'])));
    expect(out['ui/A.tsx'][0].queued).toBe(true);
    expect(out['ui/B.tsx']).toBe(byFile['ui/B.tsx']);
    act(() => words.setQueuedComments(new Set()));
    expect(out).toBe(byFile);
  });
});
