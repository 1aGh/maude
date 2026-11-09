// 2.1.1 T8 (security) — a server address the repo names, which this Mac never linked or confirmed, is a
// peer's text. It gets its own neutral state: no toast, no broken-link badge, no sign-in with the address
// filled in — only "This project names <host>. Not linked on this Mac." and Review…, which opens the
// consent step. A project this Mac DID link whose sign-in is missing keeps the repair (toast + Sign in).
import { describe, expect, test } from 'bun:test';
import { thisProjectModel } from '../client/v2/settings/this-project-model.js';
import {
  connectionState,
  connectionWords,
  isBrokenSignIn,
  signInToast,
} from '../client/v2/shell/connection-state.js';
import { accountFace, accountMenu } from '../client/v2/shell/project-account-model.js';

const claimed = 'https://planted.example.test';
const cloud = 'https://cloud.maude.sh';
const parked = { url: claimed, credentialed: false, confirmed: false };

describe('an address this Mac never confirmed', () => {
  const c = connectionState({ linkedHub: parked, cloudUrl: cloud });

  test('is its own neutral state: no badge, nothing leaves this Mac', () => {
    expect(c).toMatchObject({ state: 'unconfirmed', kind: 'local', badge: null });
    expect(c.host).toBe('planted.example.test');
    expect(isBrokenSignIn(c)).toBe(false);
  });

  test('never raises the sign-in toast', () => {
    expect(signInToast(c, { project: 'p' })).toBeNull();
  });

  test('is worded as what the repo says, with Review… instead of Sign in', () => {
    const w = connectionWords(c);
    expect(w.line).toBe('This project names planted.example.test. Not linked on this Mac.');
    expect(w.tone).toBe('');
    expect(w.fix).toEqual({ id: 'review-link', label: 'Review…' });
  });

  test('the avatar menu: no red block, no prefilled sign-in, one Review… action', () => {
    const face = accountFace({ conn: c });
    expect(face.badge).toBeNull();
    expect(face.kind).toBe('local');
    const menu = accountMenu({ native: true, conn: c, face, project: 'p' });
    expect(menu.bad).toBe(false);
    expect(menu.fix).toBeNull();
    expect(menu.actions.map((a) => a.id)).toEqual(['review-link']);
    expect(menu.status.text).toBe(
      'This project names planted.example.test. Not linked on this Mac.'
    );
  });

  test('Settings › This project: no Sign in again, no address handed to a sign-in', () => {
    const m = thisProjectModel({
      status: { connected: false, url: cloud, project: 'p', linkedHub: parked },
    });
    expect(m.bad).toBe(false);
    expect(m.fixLabel).toBeNull();
    expect(m.callout).toBeNull();
    expect(m.hubUrl).toBeNull();
    expect(m.unconfirmed).toEqual({
      line: 'This project names planted.example.test. Not linked on this Mac.',
      label: 'Review…',
    });
  });
});

describe('a server this Mac linked, whose sign-in is missing (the repair stays)', () => {
  const linked = { url: claimed, credentialed: false, confirmed: true };
  const c = connectionState({ linkedHub: linked, cloudUrl: cloud });

  test('signin-missing with the broken-link badge and the toast', () => {
    expect(c).toMatchObject({ state: 'signin-missing', kind: 'server', badge: 'broken' });
    expect(signInToast(c, { project: 'p' })?.actionLabel).toBe('Sign in');
  });

  test('the menu and the card prefill the address this Mac linked', () => {
    const menu = accountMenu({ native: true, conn: c, face: accountFace({ conn: c }) });
    expect(menu.fix?.url).toBe(claimed);
    const m = thisProjectModel({ status: { url: cloud, project: 'p', linkedHub: linked } });
    expect(m.hubUrl).toBe(claimed);
    expect(m.fixLabel).toBe('Sign in');
    expect(m.unconfirmed).toBeNull();
  });
});
