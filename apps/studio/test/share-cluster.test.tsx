// V2-4.3a — the Share cluster against the REAL component (happy-dom + React):
//  · faces, the status word (each of the five), comments count, Exports (hidden until an export exists,
//    then a progress ring), Hide panels, Share / Ask to edit;
//  · every button runs the shell's action through `run(id)` — view.comments, view.exports, view.panels,
//    share.open — never a handler of its own;
//  · the island declares `data-occludes="top"` (docked in the pinned column: no edge);
//  · the mode switch's slot sits after Comments (V2-4.3b fills it; mode-toggle.test covers the switch).
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
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { accessStatus, exportsRing, facesOf, saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

const ctx = menuCtx({ native: true, canvasOpen: true });
const linked = { linked: true, online: true, phase: 'synced', pending: 0, writeFailed: null };
let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

type Props = Partial<Parameters<typeof ShareCluster>[0]>;
async function mount(props: Props = {}) {
  const ran: string[] = [];
  const actions: string[] = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(
      <ShareCluster
        faces={facesOf({ you: 'Michal Dovrtěl' })}
        status={saveStatus(linked)}
        ctx={ctx}
        run={(id: string) => ran.push(id)}
        onStatusAction={(id: string) => actions.push(id)}
        {...props}
      />
    );
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { ran, actions, q, host };
}

describe('the cluster', () => {
  test('the old chip’s tooltip and short label ride on the status word (V2-4.8b)', async () => {
    const { q } = await mount({
      status: {
        ...saveStatus({ ...linked, phase: 'attention' }),
        title: '2 files need a look (a.tsx, b.tsx) — open Sync',
        syncLabel: '2 to review',
      },
    });
    const word = q('share-cluster-status');
    expect(word?.getAttribute('title')).toContain('2 files need a look');
    expect(word?.getAttribute('data-sync-label')).toBe('2 to review');
  });

  test('the disk-full sentence still wins the tooltip, and no label is invented', async () => {
    const { q } = await mount({
      status: saveStatus({ writeFailed: { kind: 'disk-full' }, linked: true }),
    });
    expect(q('share-cluster-status')?.getAttribute('title')).toContain('out of space');
    expect(q('share-cluster-status')?.getAttribute('data-sync-label')).toBeNull();
  });

  test('faces: you, then Claude while it works', async () => {
    const { q } = await mount({ faces: facesOf({ you: 'Michal Dovrtěl', agentActive: true }) });
    const faces = q('share-cluster-faces');
    expect(faces?.querySelectorAll('li').length).toBe(2);
    expect(faces?.textContent).toBe('MDC');
  });

  test('a peer’s face is the Follow control (moved from the canvas stack)', async () => {
    const followed: number[] = [];
    const faces = facesOf({ you: 'Michal Dovrtěl', peers: [{ clientID: 7, name: 'Tereza K' }] });
    const { q } = await mount({ faces, onFollow: (id: number) => followed.push(id) });
    const face = q('share-cluster-face-7');
    expect(face?.tagName).toBe('BUTTON');
    expect(face?.getAttribute('aria-label')).toBe('Follow Tereza');
    expect(face?.getAttribute('aria-pressed')).toBe('false');
    await act(async () => face?.click());
    expect(followed).toEqual([7]);
    act(() => root?.unmount());
    const on = facesOf({ you: 'M', peers: [{ clientID: 7, name: 'Tereza K', following: true }] });
    const b = await mount({ faces: on, onFollow: () => {} });
    expect(b.q('share-cluster-face-7')?.getAttribute('aria-label')).toBe('Stop following Tereza');
    expect(b.q('share-cluster-face-7')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('the status word, one per state, with its testid', async () => {
    const cases: [object, string, string][] = [
      [linked, 'saved', 'Saved'],
      [{ ...linked, phase: 'syncing' }, 'syncing', 'Syncing…'],
      [{ ...linked, online: false }, 'offline', 'Offline — kept on this Mac'],
      [{ ...linked, linked: false }, 'local', 'Local project'],
      [{ ...linked, writeFailed: { kind: 'failed' } }, 'not-saved', 'Not saved'],
    ];
    for (const [input, kind, word] of cases) {
      const { q } = await mount({ status: saveStatus(input) });
      expect(q('share-cluster-status')?.getAttribute('data-status')).toBe(kind);
      expect(q('share-cluster-status')?.textContent).toBe(word);
      act(() => root?.unmount());
      host?.remove();
    }
  });

  test('Retry exists only on Not saved, and reports itself', async () => {
    const ok = await mount();
    expect(ok.q('share-cluster-retry')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const bad = await mount({ status: saveStatus({ ...linked, writeFailed: { kind: 'failed' } }) });
    expect(bad.q('share-cluster-retry')?.textContent).toBe('Retry');
    await act(async () => bad.q('share-cluster-retry')?.click());
    expect(bad.actions).toEqual(['retry']);
  });

  test('a full disk: the sentence is on screen, not only in a tooltip', async () => {
    const { q } = await mount({
      status: saveStatus({ ...linked, writeFailed: { kind: 'disk-full' } }),
    });
    expect(q('share-cluster-detail')?.textContent).toBe(
      "This Mac is out of space — changes wait here until there's room."
    );
  });

  test('comments: the count shows when there are open comments; the button runs view.comments', async () => {
    const none = await mount();
    expect(none.q('share-cluster-comments-count')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const some = await mount({ commentsCount: 3 });
    expect(some.q('share-cluster-comments-count')?.textContent).toBe('3');
    expect(some.q('share-cluster-comments')?.getAttribute('aria-label')).toBe('Comments — 3 open');
    await act(async () => some.q('share-cluster-comments')?.click());
    expect(some.ran).toEqual(['view.comments']);
  });

  test('Share for editors runs share.open; with no canvas it does nothing', async () => {
    const a = await mount({ canShare: true });
    await act(async () => a.q('share-cluster-share')?.click());
    expect(a.ran).toEqual(['share.open']);
    expect(a.q('share-cluster-ask')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ canShare: false });
    expect(b.q('share-cluster-share')?.getAttribute('aria-disabled')).toBe('true');
    await act(async () => b.q('share-cluster-share')?.click());
    expect(b.ran).toEqual([]);
  });

  test('without edit rights: an access word in the status slot, Ask to edit instead of Share', async () => {
    let asked = 0;
    const { q } = await mount({
      access: accessStatus({ canEdit: false, role: 'viewer' }),
      onAskToEdit: () => {
        asked++;
      },
    });
    expect(q('share-cluster-status')?.textContent).toBe('Can comment');
    expect(q('share-cluster-share')).toBeNull();
    expect(q('share-cluster-ask')?.textContent).toBe('Ask to edit');
    await act(async () => q('share-cluster-ask')?.click());
    expect(asked).toBe(1);
  });

  test('Exports: absent until an export exists; a ring while one runs; opens through view.exports', async () => {
    const none = await mount({ exports: exportsRing([]) });
    expect(none.q('share-cluster-exports')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const done = await mount({ exports: exportsRing([{ status: 'done' }]) });
    expect(done.q('share-cluster-exports')).not.toBeNull();
    expect(done.q('share-cluster-exports')?.querySelector('.st-ex-ring')).toBeNull();
    act(() => root?.unmount());
    host?.remove();
    const run = await mount({
      exports: exportsRing([{ status: 'running', progress: { current: 1, total: 4 } }]),
    });
    expect(run.q('share-cluster-exports')?.querySelector('.st-ex-ring')).not.toBeNull();
    expect(run.q('share-cluster-exports')?.getAttribute('aria-label')).toBe('Exports — 25 % done');
    await act(async () => run.q('share-cluster-exports')?.click());
    expect(run.ran).toEqual(['view.exports']);
  });

  test('Hide panels runs view.panels, and says Show panels when they are hidden', async () => {
    const a = await mount();
    expect(a.q('share-cluster-panels')?.getAttribute('aria-label')).toBe('Hide panels');
    expect(a.q('share-cluster-panels')?.getAttribute('title')).toBe('Hide panels  ⌘\\');
    await act(async () => a.q('share-cluster-panels')?.click());
    expect(a.ran).toEqual(['view.panels']);
    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ panelsHidden: true });
    expect(b.q('share-cluster-panels')?.getAttribute('aria-label')).toBe('Show panels');
    expect(b.q('share-cluster-panels')?.getAttribute('aria-pressed')).toBe('true');
  });

  test('the island declares its edge (top); docked in the pinned column it declares none', async () => {
    const a = await mount();
    expect(a.q('share-cluster')?.getAttribute('data-occludes')).toBe('top');
    expect(a.q('share-cluster')?.classList.contains('island')).toBe(true);
    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ docked: true });
    expect(b.q('share-cluster')?.hasAttribute('data-occludes')).toBe(false);
    expect(b.q('share-cluster')?.getAttribute('data-docked')).toBe('true');
  });

  test('the mode switch’s slot sits after Comments (the host fills it with ModeSwitch — mode-toggle.test)', async () => {
    const a = await mount();
    const order = [...(a.q('share-cluster')?.children ?? [])].map((c) =>
      c.getAttribute('data-testid')
    );
    expect(order).toEqual([
      'share-cluster-faces',
      'share-cluster-status',
      'share-cluster-comments',
      'share-cluster-panels',
      'share-cluster-share',
    ]);
    act(() => root?.unmount());
    host?.remove();
    const b = await mount({ modeSlot: <span data-testid="mode-stub" /> });
    const order2 = [...(b.q('share-cluster')?.children ?? [])].map((c) =>
      c.getAttribute('data-testid')
    );
    expect(order2.indexOf('mode-stub')).toBe(order2.indexOf('share-cluster-comments') + 1);
  });
});
