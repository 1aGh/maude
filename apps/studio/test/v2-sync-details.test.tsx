// S11.12 — Sync details (06 ad-syncd): one render test per card, and the picks' requests.
//
//   header "Sync · <project>" + "<n> need you" · the conflict card (Keep mine · Use theirs · Keep
//   both + Compare) · the unfinished AI edit (Publish · Discard) · Moving now with ✕ · Counts and
//   the held / rate-limited / failed lists · the sign-in ran-out card with Sign in again.

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
import SyncDetails, {
  AI_PICK,
  CONFLICT_PICK,
} from '../client/v2/diagnostics/sync-details/sync-details.jsx';
import {
  conflictSlugs,
  resolvedWords,
  syncDetailsModel,
} from '../client/v2/diagnostics/sync-details/sync-details-model.js';

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

const base = (over: Record<string, unknown> = {}) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: 'https://alligators.cloud.maude.sh',
  ...over,
});
const conflict = (slug: string) => ({
  id: `source-conflict-${slug}`,
  severity: 'warn',
  text: `Source sync blocked for ${slug}.`,
});

type Call = { url: string; body: unknown };
function fakeFetch(answer: (url: string, body: unknown) => unknown) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body });
    return new Response(JSON.stringify(answer(url, body)), { status: 200 });
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function mount(props: Record<string, unknown>) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<SyncDetails project="Alligators brand" {...(props as never)} />);
  });
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = (id: string) => act(async () => q(id)?.click());

describe('Sync details — the cards', () => {
  test('header: "Sync · <project>" and "<n> need you"', async () => {
    await mount({
      status: base({
        notices: [conflict('ui-uniformy'), { id: 'shared-doc', text: 'x' }],
        aiAction: { state: 'held', label: 'Cut the trailer', canvases: ['a', 'b'] },
      }),
    });
    expect(q('diag-sync-title')?.textContent).toBe('Sync · Alligators brand');
    expect(q('diag-sync-need-word')?.textContent).toBe('2 need you');
    expect(q('diag-sync-needs')?.textContent).toContain('Needs you · 2');
  });

  test('nothing needs you: no word, no Needs you', async () => {
    await mount({ status: base() });
    expect(q('diag-sync-need-word')).toBeNull();
    expect(q('diag-sync-needs')).toBeNull();
  });

  test('the conflict card: Keep mine · Use theirs · Keep both + Compare, each one request', async () => {
    const { f, calls } = fakeFetch((url, body) =>
      url.startsWith('/_api/project/conflict?')
        ? { ok: true, slug: 'ui-uniformy', mine: 'a\nmine\n', theirs: 'a\ntheirs\n' }
        : (body as { choice: string }).choice === 'keep-both'
          ? { ok: true, status: 'kept-both', copy: { rel: 'ui/uniformy this Mac.tsx' } }
          : { ok: true, status: 'taken' }
    );
    await mount({ status: base({ notices: [conflict('ui-uniformy')] }), fetchImpl: f });
    const card = q('diag-sync-conflict-ui-uniformy');
    expect(card?.textContent).toContain('ui-uniformy changed here and in the cloud.');
    expect(card?.textContent).toContain('Both versions are kept until you choose.');
    const labels = Array.from(card?.querySelectorAll('button') ?? []).map((b) => b.textContent);
    expect(labels).toEqual(['Keep mine', 'Use theirs', 'Keep both', 'Compare']);

    await click('diag-sync-keep-both-ui-uniformy');
    expect(calls.at(-1)).toEqual({
      url: '/_api/project/conflict',
      body: { file: 'ui-uniformy', choice: 'keep-both' },
    });
    expect(q('diag-sync-conflict-note-ui-uniformy')?.textContent).toBe(
      'Both kept. This Mac’s version is “uniformy this Mac”.'
    );
    await click('diag-sync-keep-mine-ui-uniformy');
    expect(calls.at(-1)?.body).toEqual({ file: 'ui-uniformy', choice: 'mine' });
    await click('diag-sync-use-theirs-ui-uniformy');
    expect(calls.at(-1)?.body).toEqual({ file: 'ui-uniformy', choice: 'theirs' });

    await click('diag-sync-compare-ui-uniformy');
    expect(calls.at(-1)?.url).toBe('/_api/project/conflict?file=ui-uniformy');
    const lines = q('diag-sync-compare-lines-ui-uniformy')?.textContent ?? '';
    expect(lines).toContain('Yoursmine');
    expect(lines).toContain('Cloudtheirs');
  });

  test('a refused Keep both says why and keeps the card', async () => {
    const { f } = fakeFetch(() => ({ ok: false, status: 'rejected', code: 'still-editing' }));
    await mount({ status: base({ notices: [conflict('ui-a')] }), fetchImpl: f });
    await click('diag-sync-keep-both-ui-a');
    expect(q('diag-sync-conflict-note-ui-a')?.textContent).toBe(
      'This canvas is still changing. Try again in a moment.'
    );
    expect(q('diag-sync-conflict-ui-a')).toBeTruthy();
  });

  test('the unfinished AI edit: Publish · Discard', async () => {
    const { f, calls } = fakeFetch(() => ({ ok: true }));
    await mount({
      status: base({ aiAction: { state: 'held', label: 'Cut the trailer', canvases: ['a'] } }),
      fetchImpl: f,
    });
    expect(q('diag-sync-ai')?.textContent).toContain('AI stopped halfway on Cut the trailer.');
    expect(q('diag-sync-ai')?.textContent).toContain('It changed 1 canvas');
    await click('diag-sync-publish-ai');
    expect(calls.at(-1)).toEqual({ url: '/_api/project/ai-action', body: { choice: 'publish' } });
    await click('diag-sync-discard-ai');
    expect(calls.at(-1)?.body).toEqual({ choice: 'discard' });
  });

  test('Moving now: the transfer with its ✕', async () => {
    const { f, calls } = fakeFetch(() => ({ ok: true }));
    await mount({
      status: base({
        assets: {
          total: 50,
          done: 31,
          pushed: 30,
          skipped: 1,
          failedCount: 0,
          finished: false,
          active: 'combine-40yd.mov',
        },
      }),
      fetchImpl: f,
    });
    expect(q('diag-sync-moving')?.textContent).toContain('combine-40yd.mov');
    expect(q('diag-sync-moving')?.textContent).toContain('62%');
    await click('diag-sync-cancel-transfer');
    expect(calls.at(-1)?.url).toBe('/_api/sync/cancel-assets');
    expect(q('diag-sync-moving')).toBeNull();
  });

  test('Counts and the held · rate-limited · failed lists', async () => {
    await mount({
      status: base({
        assets: { total: 247, done: 247, pushed: 0, skipped: 247, failedCount: 0, finished: true },
        files: {
          synced: 1318,
          pulled: 0,
          conflicts: 0,
          failed: 2,
          rateLimited: { waiting: 4 },
          held: [
            {
              kind: 'delete-breaker',
              detail: 'Too many files would be removed at once.',
              paths: ['ui/a.png'],
            },
          ],
          progress: { tracked: 1318, delivered: 1318, remaining: 0, phase: 'converged' },
          delivery: { 'ui/b.png': 'stuck', 'ui/c.png': 'everywhere' },
        },
      }),
    });
    expect(q('diag-sync-count-files')?.textContent).toContain('1 318 · all here');
    expect(q('diag-sync-count-assets')?.textContent).toContain('247');
    expect(q('diag-sync-count-held')?.textContent).toContain('1 · 4 · 2');
    expect(q('diag-sync-rate-limited')?.textContent).toContain('4 files still on the way');
    expect(q('diag-sync-held-delete-breaker')?.textContent).toContain('ui/a.png');
    expect(q('diag-sync-failed')?.textContent).toContain('ui/b.png');
    expect(q('diag-sync-failed')?.textContent).not.toContain('ui/c.png');
  });

  test('the sign-in ran out: Sign in again (desktop only)', async () => {
    const seen: string[] = [];
    const refused = base({ state: 'auth-rejected', docs: { synced: 0, pending: 0, rejected: 3 } });
    await mount({ status: refused, native: true, onSignInAgain: (u: string) => seen.push(u) });
    expect(q('diag-sync-signin')?.textContent).toContain(
      'Sync stopped — the sign-in to the cloud ran out.'
    );
    await click('diag-sync-signin-again');
    expect(seen).toEqual(['https://alligators.cloud.maude.sh']);
    expect(syncDetailsModel(refused, { native: true, refused: true, cloud: {} }).signIn).toBe(
      false
    );
    expect(syncDetailsModel(refused, { native: false, refused: true }).signIn).toBe(false);
  });
});

describe('Sync details — the model and the registry', () => {
  test('conflict slugs come only from source-conflict notices, safe and unique', () => {
    expect(
      conflictSlugs({
        notices: [
          conflict('ui-a'),
          conflict('ui-a'),
          { id: 'source-conflict-../x' },
          { id: 'other' },
        ],
      })
    ).toEqual(['ui-a']);
  });

  test('every pick is a registry action, hidden from ⌘K, Can edit for the conflict and AI picks', () => {
    for (const id of [...Object.keys(CONFLICT_PICK), ...Object.keys(AI_PICK)]) {
      const def = ACTIONS_BY_ID.get(id as never);
      expect(def?.visible).toEqual({ minRole: 'edit' });
      expect(def?.search).toEqual({ hidden: true });
    }
    for (const id of ['sync.get-latest', 'sync.sign-in-again', 'sync.cancel-transfer'])
      expect(ACTIONS_BY_ID.get(id as never)).toBeTruthy();
  });

  test('words after a pick', () => {
    expect(resolvedWords('mine', { ok: true })).toBe('Your version is the canvas now.');
    expect(resolvedWords('theirs', { ok: true })).toBe('The cloud’s version is the canvas now.');
    expect(resolvedWords('keep-both', { ok: false, code: 'no-local-version' })).toBe(
      'This Mac’s version is gone — nothing to keep.'
    );
  });
});
