// S1.22a — the account chip beside the faces and its card (canvas 11 · pn-accounts):
//  · GAP-ACCOUNTS-1  which account this project tab is bound to (`/_config.profile`), in the Share cluster;
//  · GAP-ACCOUNTS-2  "Sign out of … " naming the effect (every project on the account), a confirm, then the
//                    EXISTING sign-out path — the card never signs out on its own, it calls `onSignOut`;
//  · GAP-ACCOUNTS-3  the footnote "Kept on this Mac — <project> opens as <account> next time."
// The model is pure (words); the component is presentational (the host owns fetch / the shell).
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
import { AccountChip } from '../client/v2/shell/account-card.jsx';
import { accountCard, accountChip, projectsPhrase } from '../client/v2/shell/account-card-model.js';
import { menuCtx } from '../client/v2/shell/project-menu-model.js';
import { saveStatus } from '../client/v2/shell/save-status.js';
import { ShareCluster } from '../client/v2/shell/share-cluster.jsx';

const work = { id: 'work', label: 'Work' };
const email = 'you@work-studio.cz';

describe('projectsPhrase — the canvas’s “A, B and 4 more”', () => {
  test('lists up to three, then two and a count', () => {
    expect(projectsPhrase([])).toBe('');
    expect(projectsPhrase(['A'])).toBe('A');
    expect(projectsPhrase(['A', 'B'])).toBe('A and B');
    expect(projectsPhrase(['A', 'B', 'C'])).toBe('A, B and C');
    expect(projectsPhrase(['Alligators brand', 'Matchday 2026', 'C', 'D', 'E', 'F'])).toBe(
      'Alligators brand, Matchday 2026 and 4 more'
    );
  });
});

describe('accountChip — whether and what the Share cluster shows', () => {
  test('desktop + signed in + a non-default profile: the chip names the account', () => {
    const c = accountChip({ native: true, connected: true, profile: work, email });
    expect(c).toMatchObject({ label: 'Work', initial: 'W', title: `Work · ${email}` });
  });
  test('absent where there is no Mac account: browser, cloud tab, signed out', () => {
    expect(accountChip({ native: false, connected: true, profile: work, email })).toBeNull();
    expect(accountChip({ native: true, connected: false, profile: work, email })).toBeNull();
    expect(
      accountChip({ native: true, connected: true, profile: work, email, cloud: true })
    ).toBeNull();
  });
  test('the default profile alone is a one-account Mac: no chip until a second account is known', () => {
    const d = { id: 'default', label: 'Default' };
    expect(accountChip({ native: true, connected: true, profile: d, email })).toBeNull();
    const two = [
      { id: 'default', label: 'Default', email, projects: ['A'] },
      { id: 'work', label: 'Work', email: 'w@x.cz', projects: [] },
    ];
    expect(
      accountChip({ native: true, connected: true, profile: d, email, accounts: two })
    ).not.toBeNull();
    expect(
      accountChip({ native: true, connected: true, profile: d, email, accounts: [two[0]] })
    ).toBeNull();
  });
});

describe('accountCard — the words', () => {
  test('without the Mac’s account list: this account, the sign-out effect, the footnote', () => {
    const c = accountCard({ project: 'Alligators brand', profile: work, email });
    expect(c.current).toMatchObject({
      initial: 'W',
      title: `Work · ${email}`,
      sub: 'Alligators brand uses this account',
    });
    expect(c.others).toEqual([]);
    expect(c.switchLabel).toBe('Sign in as another account…');
    expect(c.signOut.label).toBe(`Sign out of ${email}…`);
    expect(c.signOut.sub).toBe('Signs out every project on it.');
    expect(c.foot).toBe('Kept on this Mac — Alligators brand opens as Work next time.');
  });
  test('with the list: the other accounts and the projects the sign-out names', () => {
    const accounts = [
      {
        id: 'work',
        label: 'Work',
        email,
        projects: ['Alligators brand', 'Matchday 2026', 'C', 'D', 'E', 'F'],
      },
      {
        id: 'personal',
        label: 'Personal',
        email: 'you@gmail.com',
        projects: ['Studio site', 'Portfolio 2026'],
      },
    ];
    const c = accountCard({ project: 'Alligators brand', profile: work, email, accounts });
    expect(c.signOut.sub).toBe(
      'Signs out every project on it: Alligators brand, Matchday 2026 and 4 more.'
    );
    expect(c.others).toMatchObject([
      {
        id: 'personal',
        initial: 'P',
        title: 'Personal · you@gmail.com',
        sub: 'Studio site and Portfolio 2026',
      },
    ]);
  });
  // S1.22c: `accounts_list` (S1.22b option B) names only the caller's own projects; every other
  // account arrives as a label and a COUNT — `projects: 3`, never a name list.
  test('another account with a numeric project count reads "N projects"', () => {
    const accounts = [
      { id: 'work', label: 'Work', email, projects: ['Alligators brand'] },
      { id: 'personal', label: 'Personal', projects: 3 },
      { id: 'side', label: 'Side', projects: 1 },
      { id: 'empty', label: 'Empty', projects: 0 },
    ];
    const c = accountCard({ project: 'Alligators brand', profile: work, email, accounts });
    expect(c.others.map((o) => o.sub)).toEqual(['3 projects', '1 project', '0 projects']);
  });
  test('the confirm asks with the verb its button carries (CONTRACT §4)', () => {
    const c = accountCard({ project: 'P', profile: work, email });
    expect(c.signOut.confirm).toEqual({
      title: `Sign out of ${email}?`,
      body: 'Every project on it is signed out. Your work stays on this Mac.',
      primary: 'Sign out',
      cancel: 'Cancel',
    });
  });
});

let root: Root | null = null;
let host: HTMLElement | null = null;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
});

async function mount(props: Record<string, unknown> = {}) {
  const calls: string[] = [];
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  const chip = accountChip({ native: true, connected: true, profile: work, email });
  const card = accountCard({ project: 'Alligators brand', profile: work, email });
  await act(async () => {
    root?.render(
      <AccountChip
        chip={chip}
        card={card}
        onSwitch={() => calls.push('switch')}
        onSignOut={async () => {
          calls.push('signout');
        }}
        {...props}
      />
    );
  });
  const q = (id: string) => host?.querySelector(`[data-testid="${id}"]`) as HTMLElement | null;
  const click = async (id: string) => {
    await act(async () => {
      q(id)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
  };
  return { calls, q, click };
}

describe('AccountChip', () => {
  test('the chip names the account; the card is closed until pressed', async () => {
    const { q, click } = await mount();
    const chip = q('share-cluster-account');
    expect(chip?.textContent).toContain('Work');
    expect(chip?.getAttribute('aria-expanded')).toBe('false');
    expect(q('account-card')).toBeNull();
    await click('share-cluster-account');
    expect(q('account-card')).not.toBeNull();
    expect(chip?.getAttribute('aria-expanded')).toBe('true');
    expect(q('account-card-foot')?.textContent).toBe(
      'Kept on this Mac — Alligators brand opens as Work next time.'
    );
    expect(q('account-card-signout')?.textContent).toContain(`Sign out of ${email}…`);
  });

  test('Sign in as another account… runs the shell’s own handler and closes the card', async () => {
    const { q, click, calls } = await mount();
    await click('share-cluster-account');
    await click('account-card-switch');
    expect(calls).toEqual(['switch']);
    expect(q('account-card')).toBeNull();
  });

  test('sign-out asks first, then calls the existing path once; cancel signs nothing out', async () => {
    const { q, click, calls } = await mount();
    await click('share-cluster-account');
    await click('account-card-signout');
    expect(calls).toEqual([]); // pressing the row only asks
    expect(q('account-card-confirm')?.textContent).toContain(`Sign out of ${email}?`);
    await click('account-card-signout-cancel');
    expect(calls).toEqual([]);
    expect(q('account-card-confirm')).toBeNull();
    await click('account-card-signout');
    await click('account-card-signout-confirm');
    expect(calls).toEqual(['signout']);
    expect(q('account-card')).toBeNull();
  });

  test('esc closes the card', async () => {
    const { q, click } = await mount();
    await click('share-cluster-account');
    await act(async () => {
      q('account-card')?.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })
      );
    });
    expect(q('account-card')).toBeNull();
  });
});

describe('the Share cluster carries the chip first', () => {
  test('accountSlot renders before the faces; absent slot changes nothing', async () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    const ctx = menuCtx({ native: true, canvasOpen: true });
    const status = saveStatus({
      linked: true,
      online: true,
      phase: 'synced',
      pending: 0,
      writeFailed: null,
    });
    await act(async () => {
      root?.render(
        <ShareCluster
          faces={[{ initials: 'M', name: 'Michal', you: true }]}
          status={status}
          ctx={ctx}
          run={() => {}}
          accountSlot={<span data-testid="share-cluster-account">Work</span>}
        />
      );
    });
    const cluster = host.querySelector('[data-testid="share-cluster"]') as HTMLElement;
    expect((cluster.firstElementChild as HTMLElement).getAttribute('data-testid')).toBe(
      'share-cluster-account'
    );
    await act(async () => {
      root?.render(
        <ShareCluster
          faces={[{ initials: 'M', name: 'Michal', you: true }]}
          status={status}
          ctx={ctx}
          run={() => {}}
        />
      );
    });
    expect(host.querySelector('[data-testid="share-cluster-account"]')).toBeNull();
  });
});
