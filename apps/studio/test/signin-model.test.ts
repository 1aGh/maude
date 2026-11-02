// signin-model — S6.8: the sign-in card's state machine (contract S6-S9 §5.1, S6-slices Q1/Q3), pure.
// idle → starting → waiting → done | timeout | idle (cancel); a nudge or an answer for another attempt's
// `state` changes nothing; the card swaps its buttons when the Mac is offline and wakes by itself.

import { describe, expect, test } from 'bun:test';

import {
  cardMode,
  initialSignIn,
  SIGNIN_WAIT_MS,
  STATE_RE,
  signinReducer,
} from '../client/v2/signin/signin-model.js';

const S1 = 'a'.repeat(32);
const S2 = 'b'.repeat(32);
const run = (events: Array<Record<string, unknown>>, from = initialSignIn()) =>
  events.reduce((s, e) => signinReducer(s, e), from);
const waiting = (state = S1, at = 1000) =>
  run([
    { type: 'start' },
    { type: 'started', profile: 'default', userCode: 'ABCD-EFGH', state, at },
  ]);

describe('start', () => {
  test('idle → starting → waiting, with the attempt it is waiting for', () => {
    expect(run([{ type: 'start' }]).phase).toBe('starting');
    const w = waiting();
    expect(w.phase).toBe('waiting');
    expect(w.state).toBe(S1);
    expect(w.userCode).toBe('ABCD-EFGH');
    expect(w.profile).toBe('default');
  });
  test('a second start while one runs is ignored (one attempt at a time)', () => {
    expect(signinReducer(waiting(), { type: 'start' })).toEqual(waiting());
    const starting = run([{ type: 'start' }]);
    expect(signinReducer(starting, { type: 'start' })).toBe(starting);
  });
  test('an answer that comes back after Cancel is dropped', () => {
    const s = run([
      { type: 'start' },
      { type: 'cancel' },
      { type: 'started', profile: 'p', userCode: 'X', state: S1, at: 5 },
    ]);
    expect(s.phase).toBe('idle');
    expect(s.state).toBeNull();
  });
  test('the cloud being unreachable is words, and the card is live again', () => {
    const s = run([
      { type: 'start' },
      { type: 'start-failed', error: 'Maude Cloud could not be reached.' },
    ]);
    expect(s.phase).toBe('failed');
    expect(s.error).toBe('Maude Cloud could not be reached.');
    expect(signinReducer(s, { type: 'start' }).phase).toBe('starting');
  });
});

describe('a nudge or an answer names an attempt', () => {
  test('cancelled with the current state restores the card at once', () => {
    expect(signinReducer(waiting(), { type: 'nudge', kind: 'cancelled', state: S1 }).phase).toBe(
      'idle'
    );
  });
  test('cancelled with a wrong or stale state is ignored', () => {
    const w = waiting();
    expect(signinReducer(w, { type: 'nudge', kind: 'cancelled', state: S2 })).toBe(w);
    expect(signinReducer(w, { type: 'nudge', kind: 'cancelled', state: 'not-hex' })).toBe(w);
    expect(
      signinReducer(initialSignIn(), { type: 'nudge', kind: 'cancelled', state: S1 }).phase
    ).toBe('idle');
  });
  test('a poll answer for another attempt changes nothing', () => {
    const w = waiting();
    expect(signinReducer(w, { type: 'poll', state: S2, status: 'done', email: 'x@y.cz' })).toBe(w);
    expect(signinReducer(w, { type: 'poll', state: S2, status: 'expired' })).toBe(w);
  });
  test('the server saying "stale-state" ends the wait quietly', () => {
    expect(signinReducer(waiting(), { type: 'stale', state: S1 }).phase).toBe('idle');
    const w = waiting();
    expect(signinReducer(w, { type: 'stale', state: S2 })).toBe(w);
  });
  test('STATE_RE is the contract grammar (32 lowercase hex)', () => {
    expect(STATE_RE.test(S1)).toBe(true);
    expect(STATE_RE.test('A'.repeat(32))).toBe(false);
    expect(STATE_RE.test('a'.repeat(31))).toBe(false);
  });
});

describe('poll outcomes', () => {
  test('pending keeps waiting', () => {
    expect(signinReducer(waiting(), { type: 'poll', state: S1, status: 'pending' }).phase).toBe(
      'waiting'
    );
  });
  test('done carries the e-mail and a landing for S6.11', () => {
    const d = signinReducer(waiting(), {
      type: 'poll',
      state: S1,
      status: 'done',
      email: 'me@work.cz',
      landing: { project: 'alligators' },
    });
    expect(d.phase).toBe('done');
    expect(d.email).toBe('me@work.cz');
    expect(d.landing).toEqual({ project: 'alligators' });
  });
  test('expired is the timeout card; cancelled (page Cancel seen by a poll) is the plain card', () => {
    expect(signinReducer(waiting(), { type: 'poll', state: S1, status: 'expired' }).phase).toBe(
      'timeout'
    );
    expect(signinReducer(waiting(), { type: 'poll', state: S1, status: 'cancelled' }).phase).toBe(
      'idle'
    );
  });
  test('after done the card is reset by the caller, not by a stray event', () => {
    const d = signinReducer(waiting(), { type: 'poll', state: S1, status: 'done', email: 'e' });
    expect(signinReducer(d, { type: 'cancel' })).toBe(d);
    expect(signinReducer(d, { type: 'finished' }).phase).toBe('idle');
  });
});

describe('the ten-minute wait', () => {
  test('a tick before the wait ends changes nothing; at 10 minutes it is the timeout card', () => {
    const w = waiting(S1, 1000);
    expect(signinReducer(w, { type: 'tick', now: 1000 + SIGNIN_WAIT_MS - 1 })).toBe(w);
    const t = signinReducer(w, { type: 'tick', now: 1000 + SIGNIN_WAIT_MS });
    expect(t.phase).toBe('timeout');
  });
  test('Cancel is the plain card, and Try again after a timeout starts a new attempt', () => {
    expect(signinReducer(waiting(), { type: 'cancel' }).phase).toBe('idle');
    const t = signinReducer(waiting(), { type: 'poll', state: S1, status: 'expired' });
    expect(signinReducer(t, { type: 'start' }).phase).toBe('starting');
  });
  test('"Use a code instead" shows the code the cloud page asks for, only while waiting', () => {
    expect(signinReducer(waiting(), { type: 'show-code' }).showCode).toBe(true);
    expect(signinReducer(initialSignIn(), { type: 'show-code' }).showCode).toBe(false);
  });
});

describe('what the card shows', () => {
  test('first run, online: both doors, cloud first', () => {
    expect(cardMode(initialSignIn(), true)).toBe('idle');
  });
  test('offline swaps the buttons and wakes by itself when the Mac is back', () => {
    expect(cardMode(initialSignIn(), false)).toBe('offline');
    expect(cardMode(initialSignIn(), true)).toBe('idle');
  });
  test('waiting stays waiting even when the Mac drops offline', () => {
    expect(cardMode(waiting(), false)).toBe('waiting');
  });
  test('timeout and failure show their line; offline outranks them (the button could not work)', () => {
    const t = signinReducer(waiting(), { type: 'poll', state: S1, status: 'expired' });
    expect(cardMode(t, true)).toBe('timeout');
    expect(cardMode(t, false)).toBe('offline');
    const f = run([{ type: 'start' }, { type: 'start-failed', error: 'x' }]);
    expect(cardMode(f, true)).toBe('failed');
  });
  test('starting reads as waiting (the button is spent the moment it is pressed)', () => {
    expect(cardMode(run([{ type: 'start' }]), true)).toBe('waiting');
  });
});
