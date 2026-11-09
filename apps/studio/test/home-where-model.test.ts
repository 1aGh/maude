// 2.1.1 B4 — artboard 14 (Home): every project row says WHERE it lives (which account, or which of
// the places) and carries the same connection badge as the project window. Pure model; the account
// and server health come from what Home already reads (`/_home/cloud`, `/_home/accounts`).

import { describe, expect, test } from 'bun:test';

import { buildHomeModel } from '../client/home/home-model.js';
import { CONN_WORDS, tildePath } from '../client/home/home-where-model.js';

const CLOUD = 'https://cloud.maude.sh';
const APP = '/Users/x/Library/Application Support/com.maude.app/projects';

const proj = (pid: string, over: Record<string, unknown>) => ({
  pid,
  name: pid,
  root: `/Users/x/git/${pid}`,
  profile: 'default',
  place: 'closed',
  focused: false,
  ...over,
});

const shell = {
  profiles: [
    { id: 'default', label: 'Alice', email: 'alice@example.com' },
    { id: 'bright', label: 'Brightside', email: 'hello@brightside.example' },
    { id: 'srv', label: 'Design server', email: 'alice@example.com' },
  ],
  projects: [
    // Maude Cloud, in a folder the person chose
    proj('brand', { linkedHub: { url: 'https://brand.cloud.maude.sh/' } }),
    // Maude Cloud, the copy Maude keeps itself
    proj('brightside', {
      profile: 'bright',
      root: `${APP}/brightside.cloud.maude.sh--brightside`,
      hub: 'https://brightside.cloud.maude.sh/',
      linkedHub: { url: 'https://brightside.cloud.maude.sh/' },
    }),
    // a team server, in a folder
    proj('website', { profile: 'srv', linkedHub: { url: 'https://design.example.com/' } }),
    // no account: a folder, and a project Maude keeps
    proj('logo', { root: '/Users/x/git/logo-ideas' }),
    proj('moodboard', { root: `${APP}/moodboard` }),
  ],
  recent: [],
};
const listing = (profile: string, over: Record<string, unknown> = {}) => ({
  profile,
  signedIn: true,
  account: { email: shell.profiles.find((p) => p.id === profile)?.email },
  projects: [],
  ...over,
});

function rows(over: Record<string, unknown> = {}) {
  const m = buildHomeModel({
    shell,
    index: { v: 1, projects: [] },
    clouds: [listing('default'), listing('bright')],
    hubAccounts: { srv: { 'https://design.example.com': 'alice@example.com' } },
    hubStates: { srv: { 'https://design.example.com': 'ok' } },
    cloudUrl: CLOUD,
    ...over,
  });
  return Object.fromEntries(
    m.groups.flatMap((g) => g.rows.filter((r) => r.pid).map((r) => [r.pid, r]))
  );
}

describe('where — one of four places, and the account when there is one', () => {
  test('Maude Cloud in a folder: the account’s e-mail and the folder’s path', () => {
    expect(rows().brand?.where).toEqual({
      kind: 'cloud',
      label: 'alice@example.com',
      path: '~/git/brand',
    });
  });

  test('Maude Cloud, kept by Maude: the e-mail, no path to manage', () => {
    expect(rows().brightside?.where).toEqual({
      kind: 'cloud',
      label: 'hello@brightside.example',
      path: null,
    });
  });

  test('your server: its host (and the folder when the person chose one)', () => {
    expect(rows().website?.where).toEqual({
      kind: 'server',
      label: 'design.example.com',
      path: '~/git/website',
    });
  });

  test('no account: “Your folder” with its path, or “Kept by Maude” with none', () => {
    expect(rows().logo?.where).toEqual({
      kind: 'folder',
      label: 'Your folder',
      path: '~/git/logo-ideas',
    });
    expect(rows().moodboard?.where).toEqual({ kind: 'kept', label: 'Kept by Maude', path: null });
  });

  test('a project the shell has no proof of (a claim in its own config) is not called a server', () => {
    // the control plane is not known yet: Maude Cloud must not turn into "your server"
    expect(rows({ cloudUrl: null }).brand?.where.kind).toBe('folder');
  });

  test('the path is shortened to ~ under the home folder', () => {
    expect(tildePath('/Users/x/git/brand', '/Users/x')).toBe('~/git/brand');
    expect(tildePath('/Users/x', '/Users/x')).toBe('~');
    expect(tildePath('/Volumes/Work/brand', '/Users/x')).toBe('/Volumes/Work/brand');
    // Home does not know the home folder: a /Users/<name> or /home/<name> prefix is guessed
    expect(tildePath('/Users/x/git/brand')).toBe('~/git/brand');
    expect(tildePath('/home/ann/git/brand')).toBe('~/git/brand');
  });

  test('a cloud project that is not on this Mac yet says which account it is on', () => {
    const m = buildHomeModel({
      shell,
      index: { v: 1, projects: [] },
      clouds: [
        listing('default', {
          projects: [{ id: 'far', name: 'Far', url: 'https://far.cloud.maude.sh/' }],
        }),
      ],
      cloudUrl: CLOUD,
    });
    const far = m.groups.flatMap((g) => g.rows).find((r) => r.projectId === 'far');
    expect(far?.where).toEqual({ kind: 'cloud', label: 'alice@example.com', path: null });
  });
});

describe('connection — the project window’s badge, from what Home knows', () => {
  const state = (pid: string, over: Record<string, unknown> = {}) => rows(over)[pid]?.conn?.state;

  test('connected, and nothing to connect for a project only on this Mac', () => {
    expect(state('brand')).toBe('ok');
    expect(state('website')).toBe('ok');
    expect(state('logo')).toBe('local');
    expect(rows().logo?.conn?.word).toBe('Only on this Mac');
    expect(CONN_WORDS.ok).toBe('Connected');
  });

  test('Maude Cloud: the control plane not answering reads offline; a refused sign-in reads stopped', () => {
    expect(state('brand', { clouds: [listing('default', { offline: true })] })).toBe('offline');
    expect(
      state('brand', { clouds: [listing('default', { signedIn: false, rejected: true })] })
    ).toBe('rejected');
    expect(
      rows({ clouds: [listing('default', { signedIn: false, rejected: true })] }).brand?.conn?.word
    ).toBe('Sign-in stopped working');
    // signed out of their own accord (no credential): sign-in missing
    expect(state('brand', { clouds: [listing('default', { signedIn: false })] })).toBe('missing');
  });

  test('your server: refused → stopped working; no answer → server unreachable; no credential → missing', () => {
    const on = (s: string) => ({ hubStates: { srv: { 'https://design.example.com': s } } });
    expect(state('website', on('rejected'))).toBe('rejected');
    expect(state('website', on('unreachable'))).toBe('unreachable');
    expect(state('website', on('unknown'))).toBe('ok');
    expect(rows(on('unreachable')).website?.conn?.word).toBe('Server unreachable');
    expect(state('website', { hubAccounts: { srv: {} }, hubStates: { srv: {} } })).toBe('missing');
  });

  test('nothing is guessed before the answers are in', () => {
    expect(rows({ clouds: null }).brand?.conn).toBeNull();
    expect(rows({ hubAccounts: null, hubStates: null }).website?.conn).toBeNull();
  });

  test('the badge wears the account’s face: a letter, a server tile, or a laptop', () => {
    expect(rows().brand?.conn?.face).toMatchObject({ kind: 'cloud', initial: 'A' });
    expect(rows().website?.conn?.face).toMatchObject({ kind: 'server' });
    expect(rows().logo?.conn?.face).toMatchObject({ kind: 'local' });
  });
});
