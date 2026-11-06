// fix/207 — the in-app place to answer "may the project's hub deliver shared code here?".
//
// Sync details' code-consent held row carries Allow shared code…, the canvas-waiting card for a
// canvas held for shared code carries the same, and once allowed Sync details offers Stop allowing
// shared code…. Each opens the confirm sheet; its primary posts the answer
// (`POST /_api/sync/code-consent/set { allow }`). Registry ids `sync.allow-code` / `sync.stop-code`.
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
import { AGENT_PATHS } from '../actions/agents.ts';
import { ACTIONS_BY_ID } from '../actions/index.ts';
import { CanvasWaitingCard } from '../client/v2/code/canvas-waiting-card.jsx';
import { consentWords } from '../client/v2/code/code-consent.js';
import SyncDetails from '../client/v2/diagnostics/sync-details/sync-details.jsx';

const HOST = 'studyfi.cloud.maude.sh';
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

type Call = { url: string; method: string; body: unknown };
function fakeHub(initial: { allowed: boolean; changeable?: boolean }) {
  let consent = {
    host: HOST,
    allowed: initial.allowed,
    how: initial.allowed ? 'recorded' : null,
    recorded: initial.allowed ? true : null,
    changeable: initial.changeable ?? true,
  };
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, method, body });
    if (url === '/_api/sync/code-consent/set') {
      const allow = (body as { allow: boolean }).allow;
      consent = { ...consent, allowed: allow, how: allow ? 'recorded' : null, recorded: allow };
      return Response.json({ ok: true, consent });
    }
    if (url === '/_api/sync/code-consent') return Response.json({ consent });
    return Response.json({});
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function mount(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(el);
  });
  await act(async () => {});
}
const q = (id: string) => document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
const click = async (id: string) => {
  await act(async () => q(id)?.click());
  await act(async () => {});
};

const held = (n: number) => ({
  state: 'online',
  queuedOps: 0,
  docs: { synced: 3, pending: 0, rejected: 0 },
  url: `https://${HOST}`,
  files: {
    synced: 10,
    pulled: 0,
    conflicts: 0,
    held: [
      {
        kind: 'code-consent',
        count: n,
        paths: ['ui/shared/_helper.ts'],
        detail: `${n} files of shared code from this project are waiting: shared code reaches this Mac only once you allow it. Nothing is lost. Allow shared code to bring them here.`,
      },
    ],
  },
});

describe('Sync details — shared code', () => {
  test('the held row offers Allow shared code…; the sheet asks, and the primary posts allow: true', async () => {
    const hub = fakeHub({ allowed: false });
    await mount(<SyncDetails project="StudyFi" status={held(1783)} fetchImpl={hub.f} />);
    expect(q('diag-sync-held-code-consent')?.textContent).toContain('1783 files of shared code');
    const btn = q('diag-sync-allow-code');
    expect(btn?.textContent).toBe('Allow shared code…');
    expect(btn?.getAttribute('data-action')).toBe('sync.allow-code');
    expect(q('code-consent-sheet')).toBeNull();

    await click('diag-sync-allow-code');
    expect(q('code-consent-sheet')?.getAttribute('data-mode')).toBe('allow');
    expect(q('code-consent-title')?.textContent).toBe(`Allow shared code from ${HOST}?`);
    expect(q('code-consent-sheet')?.textContent).toContain('outside the canvas sandbox');
    // focus starts on Cancel, never on the yes
    expect(document.activeElement?.getAttribute('data-testid')).toBe('code-consent-cancel');

    await click('code-consent-go');
    expect(hub.calls.filter((c) => c.method === 'POST')).toEqual([
      { url: '/_api/sync/code-consent/set', method: 'POST', body: { allow: true } },
    ]);
    expect(q('code-consent-sheet')).toBeNull();
    expect(q('diag-sync-allow-code')).toBeNull();
    expect(q('diag-sync-code-allowed')?.textContent).toContain(
      `Shared code from ${HOST} is allowed on this Mac.`
    );
  });

  test('Cancel posts nothing', async () => {
    const hub = fakeHub({ allowed: false });
    await mount(<SyncDetails project="StudyFi" status={held(2)} fetchImpl={hub.f} />);
    await click('diag-sync-allow-code');
    await click('code-consent-cancel');
    expect(q('code-consent-sheet')).toBeNull();
    expect(hub.calls.some((c) => c.method === 'POST')).toBe(false);
  });

  test('allowed → Stop allowing shared code… posts allow: false', async () => {
    const hub = fakeHub({ allowed: true });
    await mount(<SyncDetails project="StudyFi" status={held(0)} fetchImpl={hub.f} />);
    expect(q('diag-sync-allow-code')).toBeNull();
    expect(q('diag-sync-stop-code')?.getAttribute('data-action')).toBe('sync.stop-code');
    await click('diag-sync-stop-code');
    expect(q('code-consent-title')?.textContent).toBe(`Stop allowing shared code from ${HOST}?`);
    expect(q('code-consent-go')?.textContent).toBe('Stop allowing');
    await click('code-consent-go');
    expect(hub.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { allow: false },
    ]);
    expect(q('diag-sync-code-allowed')).toBeNull();
    expect(q('diag-sync-allow-code')?.textContent).toBe('Allow shared code…');
  });

  test('no button where this Mac cannot answer (not signed in to that hub, or a cell)', async () => {
    const hub = fakeHub({ allowed: false, changeable: false });
    await mount(<SyncDetails project="StudyFi" status={held(3)} fetchImpl={hub.f} />);
    expect(q('diag-sync-held-code-consent')).not.toBeNull();
    expect(q('diag-sync-allow-code')).toBeNull();
  });
});

describe('the canvas-waiting card — shared code', () => {
  const REFUSED = {
    files: [{ rel: 'ui/_uniform-template.ts', state: 'refused', reason: 'code-consent' }],
    more: 0,
    need: { here: 4, total: 5 },
    progress: { delivered: 5029, total: 5041 },
  };
  test('a canvas held for shared code carries Allow shared code…, through the same sheet', async () => {
    const hub = fakeHub({ allowed: false });
    await mount(
      <CanvasWaitingCard canvas="ui/Uniformy-2027.tsx" waiting={REFUSED} fetchImpl={hub.f} />
    );
    expect(q('canvas-waiting-body')?.textContent).toContain('Allow shared code to open it');
    expect(q('canvas-waiting-body')?.textContent).not.toMatch(/link this folder/);
    await click('canvas-waiting-allow-code');
    expect(q('code-consent-title')?.textContent).toBe(`Allow shared code from ${HOST}?`);
    await click('code-consent-go');
    expect(hub.calls.filter((c) => c.method === 'POST').map((c) => c.body)).toEqual([
      { allow: true },
    ]);
    expect(q('canvas-waiting-allow-code')).toBeNull();
    expect(q('canvas-waiting-allowed')?.textContent).toContain('opens once it arrives');
  });

  test('a canvas waiting for an ordinary download asks nothing', async () => {
    const hub = fakeHub({ allowed: false });
    await mount(
      <CanvasWaitingCard
        canvas="ui/Uniformy-2027.tsx"
        waiting={{ ...REFUSED, files: [{ rel: 'ui/a.ts', state: 'downloading' }] }}
        fetchImpl={hub.f}
      />
    );
    expect(q('canvas-waiting-allow-code')).toBeNull();
    expect(hub.calls).toEqual([]);
  });
});

describe('the registry', () => {
  test('both answers are registry actions the agent can never take', () => {
    for (const id of ['sync.allow-code', 'sync.stop-code']) {
      expect(ACTIONS_BY_ID.get(id)?.exec).toBe('shell');
      const ai = AGENT_PATHS[id as keyof typeof AGENT_PATHS];
      expect(ai?.agent.path).toBe('human');
      expect(ai?.server).toEqual({ route: '/_api/sync/code-consent/set', method: 'POST' });
    }
    expect(consentWords('allow', HOST).go).toBe('Allow shared code');
    expect(consentWords('stop', HOST).go).toBe('Stop allowing');
  });
});
