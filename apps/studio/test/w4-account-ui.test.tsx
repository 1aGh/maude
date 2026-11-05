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
import { ProjectAccountCard } from '../client/v2/shell/project-account-card.jsx';
import { projectAccount } from '../client/v2/shell/project-account-model.js';
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

const profile = { id: 'work', label: 'Work' };
describe('2 · the model: which account this project uses, and how', () => {
  test('a team server on a non-default port names host:port, the same as the Home card', () => {
    const base = { native: true, profile, cloudUrl: 'https://cloud.maude.sh' };
    expect(
      projectAccount({ ...base, linkedHub: { url: 'http://127.0.0.1:60542', credentialed: true } })
        .where
    ).toBe('127.0.0.1:60542');
    expect(
      projectAccount({
        ...base,
        linkedHub: { url: 'https://hub.studio.cz:443', credentialed: true },
      }).where
    ).toBe('hub.studio.cz');
  });

  test('team server: kind, profile, host, the recorded account', () => {
    const a = projectAccount({
      native: true,
      profile,
      linkedHub: { url: 'https://hub.studio.cz', credentialed: true },
      hubAccount: 'michal@studio.cz',
      cloudUrl: 'https://cloud.maude.sh',
      github: { state: 'in', login: 'iagh' },
    });
    expect(a.kind).toBe('team');
    expect(a.kindLabel).toBe('Team server');
    expect(a.profileLabel).toBe('Work');
    expect(a.where).toBe('hub.studio.cz');
    expect(a.who).toBe('michal@studio.cz');
    expect(a.signOut?.path).toBe('hub-detach');
    expect(a.github).toEqual({ login: 'iagh', canSignIn: false, canSignOut: true });
  });

  test('Maude Cloud (desktop): the cloud project and e-mail; sign out + switch on the cloud path', () => {
    const a = projectAccount({
      native: true,
      profile,
      project: 'Matchday',
      linkedHub: { url: 'https://abc.cloud.maude.sh', credentialed: true },
      cloudUrl: 'https://cloud.maude.sh',
      cloudConnected: true,
      cloudEmail: 'you@work.cz',
      github: { state: 'out' },
    });
    expect(a.kind).toBe('cloud');
    expect(a.kindLabel).toBe('Maude Cloud');
    expect(a.where).toBe('Matchday');
    expect(a.who).toBe('you@work.cz');
    expect(a.signOut?.path).toBe('cloud-signout');
    // the existing confirm wording (account-card-model)
    expect(a.signOut?.confirm.title).toBe('Sign out of you@work.cz?');
    expect(a.signOut?.confirm.body).toBe(
      'Every project on it is signed out. Your work stays on this Mac.'
    );
    expect(a.switch?.id).toBe('account.switch');
    expect(a.github).toEqual({ login: null, canSignIn: true, canSignOut: false });
  });

  test('GitHub only: kind GitHub, the login; Switch is a fresh GitHub sign-in (bind-on-sign-in in the shell)', () => {
    const a = projectAccount({ native: true, profile, github: { state: 'in', login: 'iagh' } });
    expect(a.kind).toBe('github');
    expect(a.who).toBe('@iagh');
    expect(a.signOut?.path).toBe('github-signout');
    expect(a.switch?.id).toBe('account.github-signin');
  });

  test('a cloud tab: no Mac, no keychain — the hub session, one way to stop being them', () => {
    const a = projectAccount({
      native: false,
      cloudTab: {
        projectName: 'Matchday',
        dashboardUrl: 'https://cloud.maude.sh',
        user: { email: 'a@b.c' },
      },
    });
    expect(a.kind).toBe('cloud');
    expect(a.who).toBe('a@b.c');
    expect(a.signOut).toBeNull();
    expect(a.switch?.id).toBe('account.switch');
    expect(a.github).toBeNull();
  });

  test('a browser tab on this Mac: says what is known, offers nothing that needs the app', () => {
    const a = projectAccount({
      native: false,
      linkedHub: { url: 'https://hub.studio.cz', credentialed: true },
      cloudUrl: 'https://cloud.maude.sh',
    });
    expect(a.kind).toBe('team');
    expect(a.signOut).toBeNull();
    expect(a.switch).toBeNull();
    expect(a.github).toEqual({
      login: null,
      canSignIn: false,
      canSignOut: false,
      note: expect.any(String),
    });
  });
});

describe('2 · the card', () => {
  const team = projectAccount({
    native: true,
    profile,
    linkedHub: { url: 'https://hub.studio.cz', credentialed: true },
    hubAccount: 'michal@studio.cz',
    cloudUrl: 'https://cloud.maude.sh',
    github: { state: 'out' },
  });
  test('shows kind · profile · hub · login; Sign out asks first, then calls its path', async () => {
    const calls: string[] = [];
    const ran: string[] = [];
    const { q } = await render(
      <ProjectAccountCard
        account={team}
        run={(id: string) => ran.push(id)}
        onSignOut={async (path: string) => {
          calls.push(path);
        }}
        onClose={() => {}}
      />
    );
    expect(q('project-account-kind')?.textContent).toBe('Team server');
    expect(q('project-account-profile')?.textContent).toContain('Work');
    expect(q('project-account-where')?.textContent).toBe('hub.studio.cz');
    expect(q('project-account-who')?.textContent).toBe('michal@studio.cz');
    await click(q('project-account-signout'));
    expect(calls).toEqual([]);
    expect(q('project-account-confirm')).not.toBeNull();
    await click(q('project-account-signout-confirm'));
    expect(calls).toEqual(['hub-detach']);
  });

  test('GitHub sign-in is in the card and runs the registry action', async () => {
    const ran: string[] = [];
    const { q } = await render(
      <ProjectAccountCard account={team} run={(id: string) => ran.push(id)} onClose={() => {}} />
    );
    await click(q('project-account-github-signin'));
    expect(ran).toEqual(['account.github-signin']);
  });

  test('Switch runs the switch action (cloud: account.switch → bind-on-sign-in)', async () => {
    const ran: string[] = [];
    const cloud = projectAccount({
      native: true,
      profile,
      cloudConnected: true,
      cloudEmail: 'you@work.cz',
      github: { state: 'out' },
    });
    const { q } = await render(
      <ProjectAccountCard account={cloud} run={(id: string) => ran.push(id)} onClose={() => {}} />
    );
    await click(q('project-account-switch'));
    expect(ran).toEqual(['account.switch']);
  });

  test('no dead buttons: a browser tab renders no sign-out, switch or sign-in button', async () => {
    const a = projectAccount({
      native: false,
      linkedHub: { url: 'https://hub.x', credentialed: true },
    });
    const { host: h } = await render(
      <ProjectAccountCard account={a} run={() => {}} onClose={() => {}} />
    );
    expect(h?.querySelectorAll('button').length).toBe(0);
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
