// 2.0.5 W4 (Michal after 2.0.4: "every button must do something, nothing may fail"):
//  1. the status word in the Share cluster is a button: Diagnostics › Sync (the registry's `diag.sync`)
//     in every sync state; a held conflict opens that conflict (its Compare).
//  2. the avatar (your own face, or the account chip) opens THIS project's account: kind (team server /
//     Maude Cloud / GitHub), profile label, hub or cloud project, the signed-in login — Sign out on the
//     kind's own existing path, Switch through the bind-on-sign-in path.
//  3. GitHub sign-in is a registry action (`account.github-signin`), reachable from the avatar and from
//     every "Sign in with GitHub to publish" line. No real keychain or sign-in: `window.__TAURI__` is a stub.
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
import { outcomeBanner } from '../client/v2/history/git-model.js';
import { Banner } from '../client/v2/history/git-parts.jsx';
import { createMenuHandlers, MENU_ACTION_EVENT } from '../client/v2/shell/menu-runner.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { facesOf, saveStatus } from '../client/v2/shell/save-status.js';
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

async function render(el: React.ReactElement) {
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root?.render(el));
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  return { q, host };
}
const click = async (el: HTMLElement | null) => {
  expect(el).not.toBeNull();
  await act(async () => el?.click());
};

describe('1 · the status word opens Diagnostics › Sync', () => {
  const states: Array<[string, Parameters<typeof saveStatus>[0]]> = [
    ['saved', linked],
    ['syncing', { ...linked, phase: 'syncing' }],
    ['offline', { ...linked, online: false }],
    ['local', { linked: false }],
  ];
  for (const [kind, input] of states)
    test(`${kind}: a button that runs diag.sync`, async () => {
      const ran: string[] = [];
      const { q } = await render(
        <ShareCluster
          faces={facesOf({ you: 'Michal' })}
          status={saveStatus(input)}
          ctx={ctx}
          run={(id: string) => ran.push(id)}
        />
      );
      const word = q('share-cluster-status');
      expect(word?.tagName).toBe('BUTTON');
      expect(word?.getAttribute('data-status')).toBe(kind);
      await click(word);
      expect(ran).toEqual(['diag.sync']);
    });

  test('held: the word opens that conflict (Compare), not the bare panel', async () => {
    const ran: string[] = [];
    const acts: string[] = [];
    const { q } = await render(
      <ShareCluster
        faces={facesOf({ you: 'Michal' })}
        status={saveStatus({ ...linked, held: ['poster'] })}
        ctx={ctx}
        run={(id: string) => ran.push(id)}
        onStatusAction={(id: string) => acts.push(id)}
      />
    );
    await click(q('share-cluster-status'));
    expect(acts).toEqual(['compare']);
    expect(ran).toEqual([]);
  });

  test('the access word (Can view) stays a word', async () => {
    const { q } = await render(
      <ShareCluster
        faces={[]}
        status={saveStatus(linked)}
        access={{ word: 'Can view', action: null }}
        ctx={ctx}
        run={() => {}}
      />
    );
    expect(q('share-cluster-status')?.tagName).toBe('SPAN');
  });

  test('your own face is the avatar: it opens the account', async () => {
    let opened = 0;
    const { q } = await render(
      <ShareCluster
        faces={facesOf({ you: 'Michal' })}
        presence={{ run() {}, labelOf: () => '', canSummon: false, canvasLabel: '' }}
        status={saveStatus(linked)}
        ctx={ctx}
        run={() => {}}
        onAccount={() => {
          opened += 1;
        }}
      />
    );
    const you = q('share-cluster-face-you');
    expect(you?.tagName).toBe('BUTTON');
    await click(you);
    expect(opened).toBe(1);
  });
});

describe('3 · GitHub sign-in: one registry action, every publish line a button', () => {
  test('the registry has account.github-signin (desktop)', () => {
    const def = ACTIONS_BY_ID.get('account.github-signin');
    expect(def?.label).toBe('Sign in with GitHub…');
    expect(def?.exec).toBe('shell');
  });

  test('the handler hands it to the mounted host (desktop) and says where it lives (browser)', () => {
    const heard: string[] = [];
    const on = (e: Event) => heard.push((e as CustomEvent).detail?.id);
    window.addEventListener(MENU_ACTION_EVENT, on);
    const toasts: string[] = [];
    createMenuHandlers({ native: true, toast: (m: string) => toasts.push(m) } as never)[
      'account.github-signin'
    ]();
    createMenuHandlers({ native: false, toast: (m: string) => toasts.push(m) } as never)[
      'account.github-signin'
    ]();
    window.removeEventListener(MENU_ACTION_EVENT, on);
    expect(heard).toEqual(['account.github-signin']);
    expect(toasts).toEqual(['Signing in with GitHub needs the Maude desktop app.']);
  });

  test('a publish refused for sign-in: the banner carries a Sign in with GitHub button', async () => {
    let asked = 0;
    const banner = outcomeBanner('publish', { ok: false, authRequired: true }, null);
    expect(banner?.signIn).toBe(true);
    const { q } = await render(
      <Banner
        banner={banner}
        busy={false}
        onGetLatest={() => {}}
        onDismiss={() => {}}
        onSignIn={() => {
          asked += 1;
        }}
      />
    );
    await click(q('git-signin-github'));
    expect(asked).toBe(1);
  });
});
