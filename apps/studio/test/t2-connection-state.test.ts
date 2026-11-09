// 2.1.1 T2 — the connection state of THIS project (canvas 17 · ac-states): one pure module derives the
// seven states from what the page already holds; the chip's badge, the save word, the menu line and the
// once-per-session toast all read it.
import { describe, expect, test } from 'bun:test';
import {
  connectionState,
  connectionWords,
  signInRefused,
  signInToast,
} from '../client/v2/shell/connection-state.js';

const team = 'https://design.example.com';
const cloud = 'https://cloud.maude.sh';
const cell = 'https://p-123.cloud.maude.sh';
const ok = { linkedHub: { url: team, credentialed: true }, cloudUrl: cloud, online: true };

describe('connectionState', () => {
  test('no link: local, a plain laptop, never a badge', () => {
    expect(connectionState({ linkedHub: null })).toEqual({
      state: 'local',
      kind: 'local',
      host: null,
      url: null,
      badge: null,
    });
  });
  test('a link with no sign-in on this Mac: signin-missing, broken link', () => {
    const c = connectionState({ ...ok, linkedHub: { url: team, credentialed: false } });
    expect(c).toMatchObject({ state: 'signin-missing', kind: 'server', badge: 'broken' });
    expect(c.host).toBe('design.example.com');
  });
  test('the server refuses the sign-in: signin-rejected, broken link', () => {
    const accepted = { credentialRefused: true, pending: 2 };
    expect(connectionState({ ...ok, syncStatus: { state: 'online', accepted } })).toMatchObject({
      state: 'signin-rejected',
      badge: 'broken',
    });
    const allInvalid = {
      state: 'online',
      docs: { synced: 0, pending: 0, rejected: 2 },
      items: [
        { slug: 'a', state: 'auth-rejected', reason: 'invalid-token' },
        { slug: 'b', state: 'auth-rejected', reason: 'invalid-token' },
      ],
    };
    expect(connectionState({ ...ok, syncStatus: allInvalid }).state).toBe('signin-rejected');
  });
  test('a rate limit or a partial refusal is not a broken sign-in', () => {
    expect(
      signInRefused({
        docs: { synced: 0, rejected: 1 },
        items: [{ state: 'auth-rejected', reason: 'rate-limit' }],
      })
    ).toBe(false);
    expect(
      signInRefused({
        docs: { synced: 3, rejected: 1 },
        items: [{ state: 'auth-rejected', reason: 'invalid-token' }],
      })
    ).toBe(false);
    expect(signInRefused({ accepted: { credentialRefused: 'yes' } })).toBe(false);
  });
  test('no network: offline (grey); network up but no answer: unreachable (warn)', () => {
    expect(
      connectionState({ ...ok, online: false, syncStatus: { state: 'offline' } })
    ).toMatchObject({ state: 'offline', badge: 'grey' });
    expect(connectionState({ ...ok, syncStatus: { state: 'offline-long' } })).toMatchObject({
      state: 'unreachable',
      badge: 'warn',
    });
    expect(connectionState({ ...ok, phase: 'stalled' }).state).toBe('unreachable');
  });
  test('syncing while a pass runs or changes go out; connected otherwise', () => {
    expect(connectionState({ ...ok, phase: 'syncing' })).toMatchObject({
      state: 'syncing',
      badge: 'ring',
    });
    expect(connectionState({ ...ok, phase: 'synced', pending: 3 }).state).toBe('syncing');
    expect(connectionState({ ...ok, phase: 'synced' })).toMatchObject({
      state: 'connected',
      badge: null,
    });
  });
  test('a Maude Cloud project is told from your own server by the address', () => {
    expect(connectionState({ ...ok, linkedHub: { url: cell, credentialed: true } }).kind).toBe(
      'cloud'
    );
  });
  test('a broken sign-in outranks offline (it is the person’s move either way)', () => {
    const c = connectionState({
      ...ok,
      online: false,
      linkedHub: { url: team, credentialed: false },
    });
    expect(c.state).toBe('signin-missing');
  });
});

describe('connectionWords — the canvas’s copy', () => {
  test('the two sign-in states name the server and the one button', () => {
    const missing = connectionWords(connectionState({ ...ok, linkedHub: { url: team } }));
    expect(missing.word).toBe('Sign in to sync');
    expect(missing.line).toBe('This project is on design.example.com — sign in to sync.');
    expect(missing.fix).toEqual({ id: 'sign-in', label: 'Sign in' });
    const rejected = connectionWords(
      connectionState({ ...ok, syncStatus: { accepted: { credentialRefused: true } } })
    );
    expect(rejected.word).toBe('Sign-in stopped working');
    expect(rejected.line).toBe(
      'Your sign-in to design.example.com stopped working. Changes wait on this Mac.'
    );
    expect(rejected.fix.label).toBe('Sign in again');
  });
  test('offline, unreachable, syncing, local', () => {
    expect(connectionWords({ state: 'offline' }).word).toBe('Offline — changes wait on this Mac');
    expect(connectionWords({ state: 'unreachable', kind: 'server', host: 'h.example' }).word).toBe(
      'Can’t reach h.example'
    );
    expect(connectionWords({ state: 'syncing' }, { pending: 3 }).line).toBe(
      'Syncing · 3 changes going out'
    );
    expect(connectionWords({ state: 'local' }).line).toBe('Nothing leaves this Mac.');
  });
});

describe('signInToast — the two sign-in states only', () => {
  test('a toast for missing and rejected, keyed per project + state', () => {
    const c = connectionState({ ...ok, linkedHub: { url: team } });
    const t = signInToast(c, { project: 'Design system' });
    expect(t).toMatchObject({ actionLabel: 'Sign in', id: 'signin-signin-missing' });
    expect(t?.key).toContain('Design system');
    expect(signInToast(connectionState({ ...ok, phase: 'synced' }))).toBeNull();
    expect(signInToast(connectionState({ linkedHub: null }))).toBeNull();
  });
});
