// 2.0.5 W4b — Home's avatar: every profile on this Mac by its label, with the accounts it is signed
// in with (Maude Cloud, team servers, GitHub), a sign-out per account where Home has a path for it,
// and add / switch. Pure model; no dead buttons — a row gets a button only where its path exists.

import { describe, expect, test } from 'bun:test';

import { homeAccounts } from '../client/home/home-accounts-model.js';

const shell = {
  projects: [],
  profiles: [
    { id: 'default', label: 'Default', email: 'm.dovrtel@gmail.com', github: 'iagh' },
    { id: 'studyfi', label: 'StudyFi', email: 'michal@studyfi.com' },
    { id: 'empty', label: 'Spare' },
  ],
  recent: [],
};
const clouds = [
  { profile: 'default', signedIn: true, account: { email: 'm.dovrtel@gmail.com' } },
  { profile: 'studyfi', signedIn: false },
];
const hubProfiles = [
  { id: 'studyfi', hubs: [{ url: 'https://design.studyfi.com', account: 'michal@studyfi.com' }] },
];

describe('homeAccounts', () => {
  test('each profile by its label, with its accounts', () => {
    const m = homeAccounts({ native: true, shell, clouds, hubProfiles });
    expect(m.profiles.map((p) => p.label)).toEqual(['Default', 'StudyFi', 'Spare']);
    const [def, sf, spare] = m.profiles;
    expect(def?.accounts.map((a) => [a.kind, a.who])).toEqual([
      ['cloud', 'm.dovrtel@gmail.com'],
      ['github', '@iagh'],
    ]);
    // a signed-out cloud profile has no cloud row; its team server does
    expect(sf?.accounts.map((a) => [a.kind, a.host, a.who])).toEqual([
      ['team', 'design.studyfi.com', 'michal@studyfi.com'],
    ]);
    expect(spare?.accounts).toEqual([]);
  });

  test('sign out per account where Home has the path; GitHub signs out in its project', () => {
    const [def, sf] = homeAccounts({ native: true, shell, clouds, hubProfiles }).profiles;
    expect(def?.accounts[0]?.signOut).toMatchObject({
      path: 'cloud-signout',
      profile: 'default',
      label: 'Sign out of m.dovrtel@gmail.com…',
    });
    expect(def?.accounts[1]?.signOut).toBeNull();
    expect(sf?.accounts[0]?.signOut).toMatchObject({
      path: 'hub-signout',
      profile: 'studyfi',
      url: 'https://design.studyfi.com',
      label: 'Sign out of design.studyfi.com…',
    });
    expect(sf?.accounts[0]?.signOut?.confirm?.title).toBe('Sign out of design.studyfi.com?');
  });

  test('a profile with no GitHub login can sign in to GitHub; one with it cannot twice', () => {
    const [def, sf] = homeAccounts({ native: true, shell, clouds, hubProfiles }).profiles;
    expect(def?.githubSignIn).toBe(false);
    expect(sf?.githubSignIn).toBe(true);
  });

  test('add / switch: a new Maude Cloud account and a team server', () => {
    const m = homeAccounts({ native: true, shell, clouds, hubProfiles });
    expect(m.add).toEqual({
      cloud: 'Add a Maude Cloud account…',
      team: 'Connect to a team server…',
    });
  });

  test('a browser has no shell: facts only, no buttons', () => {
    const m = homeAccounts({ native: false, shell: null, clouds, hubProfiles });
    expect(m.add).toBeNull();
    for (const p of m.profiles) {
      expect(p.githubSignIn).toBe(false);
      for (const a of p.accounts) expect(a.signOut).toBeNull();
    }
  });

  test('the face: the first profile with an account (its label’s initial, accountFace), else the first', () => {
    const m = homeAccounts({ native: true, shell, clouds, hubProfiles });
    expect(m.face?.initial).toBe('D');
    expect(m.face?.title).toBe('Default · m.dovrtel@gmail.com');
    const noGh = { ...shell, profiles: shell.profiles.map((x) => ({ ...x, github: undefined })) };
    const sfOnly = homeAccounts({ native: true, shell: noGh, clouds: [], hubProfiles });
    expect(sfOnly.face?.initial).toBe('S');
    const none = homeAccounts({
      native: true,
      shell: { ...shell, profiles: [{ id: 'default', label: 'Default' }] },
      clouds: [],
      hubProfiles: [],
    });
    expect(none.face?.initial).toBe('D');
    expect(
      homeAccounts({ native: false, shell: null, clouds: [], hubProfiles: [] }).face
    ).toBeNull();
  });
});
