// S2.20 — Menu › Edit › Undo history… against the REAL components (happy-dom + React), 14
// `ed-edge-undo`: newest first; You / AI rows; ⌘Z on the top row; an AI run reads "Footer — 14
// changes, one step"; pointing at a row lights the area in the canvas ("Would undo · 14 changes",
// `undo-preview` → editing/undo-preview.tsx); a click undoes down to there as ONE step; the foot
// names the other people and offers Version history ⌥⌘H. Also: the registry row exists (it left
// PENDING_MENU_IDS) and the menu row runs the popover.
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
import { createMenuHandlers } from '../client/v2/shell/menu-runner.js';
import { PENDING_MENU_IDS } from '../client/v2/shell/project-menu-model.js';
import {
  footText,
  previewTag,
  rowText,
  UndoHistoryHost,
  undoHistoryOpen,
} from '../client/v2/undo/undo-history.jsx';
import { createUndoProjection } from '../client/v2/undo/use-undo-projection.jsx';
import { UndoPreview } from '../editing/undo-preview.tsx';

const REPO = '.design/ui/Homepage.tsx';
const NOW = 1_000_000;

const ENTRIES = [
  // oldest first (the server's view is newest first; the store sorts by madeAt)
  {
    actionId: 'a5',
    who: 'you',
    label: 'Duplicated Desktop at Tablet',
    madeAt: NOW - 600_000,
    state: 'done',
    artboards: ['desktop'],
  },
  {
    actionId: 'a4',
    who: 'ai',
    label: 'Hero picture — kept try 2 of 3',
    madeAt: NOW - 360_000,
    state: 'done',
    artboards: ['desktop'],
    changes: 3,
  },
  {
    actionId: 'a3',
    who: 'you',
    label: 'Moved See pricing 10 px',
    madeAt: NOW - 180_000,
    state: 'done',
    artboards: ['desktop'],
  },
  {
    actionId: 'a2',
    who: 'you',
    label: 'Headline text',
    madeAt: NOW - 60_000,
    state: 'done',
    artboards: ['desktop'],
  },
  {
    actionId: 'a1',
    who: 'ai',
    label: 'Footer',
    madeAt: NOW - 5_000,
    state: 'done',
    artboards: ['desktop'],
    changes: 14,
  },
];

function fakeServer() {
  const posts: unknown[] = [];
  const request = async (method: string, url: string, body?: unknown) => {
    if (url.startsWith('/_api/project/history'))
      return {
        status: 200,
        body: {
          ok: true,
          history: [
            {
              revision: 9,
              actionId: 'z',
              actor: 'Tereza',
              mine: false,
              kind: 'edit',
              committedAt: NOW - 1_000,
              canvases: ['ui/Homepage.tsx'],
            },
          ],
        },
      };
    if (method === 'POST') {
      posts.push(body);
      return { status: 200, body: { ok: true, actionId: 'u1' } };
    }
    return { status: 200, body: { ok: true, entries: [...ENTRIES].reverse(), redo: [] } };
  };
  return { posts, request };
}

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => {
    undoHistoryOpen.close();
    root?.unmount();
  });
  host?.remove();
  root = null;
});

const flush = async () => {
  for (let i = 0; i < 6; i++) await act(async () => await new Promise((r) => setTimeout(r, 0)));
};

async function mountHost() {
  const server = fakeServer();
  const store = createUndoProjection({
    request: server.request,
    now: () => NOW - 3_600_000,
    announce: () => {},
  });
  const sent: Array<Record<string, unknown>> = [];
  let versions = 0;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <UndoHistoryHost
        activePath={REPO}
        store={store}
        now={() => NOW}
        postToActiveCanvas={(m: Record<string, unknown>) => sent.push(m)}
        onVersionHistory={() => versions++}
      />
    );
  });
  await act(async () => undoHistoryOpen.open());
  await flush();
  return { server, sent, store, versions: () => versions };
}

const q = (sel: string) => document.querySelector(sel) as HTMLElement | null;

describe('S2.20 Undo history popover', () => {
  test('rows newest first: You / AI, the AI run as one step, ⌘Z on the top row only', async () => {
    await mountHost();
    expect(q('[data-testid="undo-history"]')?.textContent).toContain('Undo historynewest first');
    const rows = [...document.querySelectorAll('[data-testid^="undo-history-row-"]')];
    expect(rows.map((r) => r.querySelector('.sh-uh-txt > span')?.textContent)).toEqual([
      'Footer — 14 changes, one step',
      'Headline text',
      'Moved See pricing 10 px',
      'Hero picture — kept try 2 of 3 — 3 changes, one step',
      'Duplicated Desktop at Tablet',
    ]);
    expect(rows[0].querySelector('em')?.textContent).toBe('AI · now');
    expect(rows[1].querySelector('em')?.textContent).toBe('You · 1 min ago');
    expect(rows.map((r) => r.getAttribute('data-top'))).toEqual(['true', null, null, null, null]);
    expect(rows[0].textContent).toContain('⌘Z');
    expect(rows[1].textContent).not.toContain('⌘Z');
  });

  test('S2.24: the popover says where it was opened from (14 ed-edge-undo)', async () => {
    await mountHost();
    expect(q('[data-testid="undo-history"] .sh-uh-from')?.textContent).toBe(
      'Opened from Menu › Edit › Undo history'
    );
  });

  test('pointing at a row lights what it would undo in the canvas; leaving clears it', async () => {
    const { sent } = await mountHost();
    await act(async () => {
      q('[data-testid="undo-history-row-0"]')?.dispatchEvent(
        new MouseEvent('mouseover', { bubbles: true })
      );
    });
    expect(sent.at(-1)).toEqual({
      dgn: 'undo-preview',
      artboards: ['desktop'],
      tag: 'Would undo · 14 changes',
    });
    await act(async () => {
      q('[data-testid="undo-history"]')?.dispatchEvent(
        new MouseEvent('mouseout', { bubbles: true, relatedTarget: document.body })
      );
    });
    expect(sent.at(-1)).toEqual({ dgn: 'undo-preview', artboards: [], tag: null });
  });

  test('a click undoes down to that row as ONE step (one POST of every id above it)', async () => {
    const { server } = await mountHost();
    await act(async () => q('[data-testid="undo-history-row-2"]')?.click());
    await flush();
    expect(server.posts).toEqual([{ actionIds: ['a1', 'a2', 'a3'], via: 'panel' }]);
    expect(q('[data-testid="undo-history"]')).toBeNull(); // it closes
  });

  test("the foot: other people's changes are theirs to undo; Version history ⌥⌘H", async () => {
    const h = await mountHost();
    expect(q('[data-testid="undo-history-foot"]')?.textContent).toBe(
      "Tereza's changes are theirs to undo."
    );
    const v = q('[data-testid="undo-history-version"]');
    expect(v?.textContent).toContain('Version history');
    expect(v?.textContent).toContain('⌥⌘H');
    await act(async () => v?.click());
    expect(h.versions()).toBe(1);
  });

  test('words', () => {
    expect(rowText({ who: 'ai', label: 'Footer', changes: 1 })).toBe('Footer — 1 change, one step');
    expect(rowText({ who: 'you', label: 'Headline text' })).toBe('Headline text');
    expect(previewTag({ changes: 14 })).toBe('Would undo · 14 changes');
    expect(previewTag({})).toBe('Would undo');
    expect(footText([])).toBeNull();
    expect(footText(['Tereza', 'Jan'])).toBe("Tereza and Jan's changes are theirs to undo.");
  });
});

describe('S2.20 registry + menu', () => {
  test('edit.undo-history is registered (left PENDING_MENU_IDS) and the menu row opens the popover', () => {
    const def = ACTIONS_BY_ID.get('edit.undo-history');
    expect(def).toMatchObject({ label: 'Undo history…', exec: 'shell' });
    expect(def?.keys ?? []).toEqual([]);
    expect(PENDING_MENU_IDS['edit.undo-history']).toBeUndefined();
    const handlers = createMenuHandlers({ activePath: REPO } as never) as Record<
      string,
      () => void
    >;
    act(() => handlers['edit.undo-history']());
    expect(undoHistoryOpen.get()).toBe(true);
  });
});

describe('S2.20 canvas highlight (editing/undo-preview.tsx)', () => {
  test('the shell lights the artboards (parent only); an empty list clears; a sibling frame cannot', async () => {
    host = document.createElement('div');
    document.body.append(host);
    const ab = document.createElement('div');
    ab.setAttribute('data-dc-screen', 'desktop');
    document.body.append(ab);
    root = createRoot(host);
    await act(async () => root?.render(<UndoPreview />));
    const send = async (source: unknown, data: unknown) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent('message', { source: source as Window, data }));
        await new Promise((r) => setTimeout(r, 20));
      });
    await send({}, { dgn: 'undo-preview', artboards: ['desktop'], tag: 'Would undo · 14 changes' });
    expect(q('[data-testid="edit-undo-preview"]')).toBeNull(); // a sibling's message is dropped
    await send(window.parent, {
      dgn: 'undo-preview',
      artboards: ['desktop'],
      tag: 'Would undo · 14 changes',
    });
    expect(q('[data-testid="edit-undo-preview"]')?.getAttribute('data-artboard')).toBe('desktop');
    expect(q('[data-testid="edit-undo-preview-tag"]')?.textContent).toBe('Would undo · 14 changes');
    await send(window.parent, { dgn: 'undo-preview', artboards: [], tag: null });
    expect(q('[data-testid="edit-undo-preview"]')).toBeNull();
    ab.remove();
  });
});
