// p8-update-fails-loud — the words. "Update project did nothing" (the alligators report, 2026-10-29):
// every way the Update can fail ends in a worded state with the action that helps — never a silent
// no-op and never the bare "was not updated". Pure model — client/v2/shell/format-update.js.
// CONTRACT §4 voice: what happened · what is safe · one verb; one action at most; a retry is
// "Retry <name>", pressed by hand.

import { describe, expect, test } from 'bun:test';

import {
  applyFailureState,
  applyResult,
  FAIL_COPY,
  OLDER_COPY,
  olderGateState,
  SAVE_COPY,
  saveModeState,
} from '../client/v2/shell/format-update.js';

const HUB = 'https://alligators.cloud.maude.sh';
const older = {
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  formatVersion: 1,
  readOnlyReason: 'format',
};
const fmt2Legacy = { formatGate: null, formatVersion: 2, saveMode: 'legacy', readOnlyReason: null };

const refused = (code: string | undefined, reason = 'x', role = 'owner') => ({
  format: 'maude.migrate-report',
  exitCode: 11,
  dryRun: false,
  project: { formatBefore: 1, linked: { hub: HUB, role, hubFormat: 2, capabilities: [] } },
  refusals: [{ path: '', reason, ...(code ? { code } : {}) }],
  steps: [],
});
const applied = (formatBefore: number, linked: Record<string, unknown>) => ({
  format: 'maude.migrate-report',
  exitCode: 0,
  dryRun: false,
  project: { formatBefore, linked: { hub: HUB, role: 'owner', ...linked } },
  refusals: [],
  steps: [],
});

describe('the dialog after Update: every failure is worded, with the action that helps', () => {
  test('offline / the team server cannot be reached → says so, Retry update', () => {
    expect(applyFailureState({ status: 409, report: refused('offline') })).toEqual({
      kind: 'offline',
      line: FAIL_COPY.offline,
      action: 'retry',
    });
    expect(FAIL_COPY.offline).toBe(
      "The project was not updated — the team server can't be reached. Nothing in it changed."
    );
  });

  test('not signed in → Sign in', () => {
    expect(applyFailureState({ status: 409, report: refused('no-sign-in') })).toEqual({
      kind: 'no-sign-in',
      line: FAIL_COPY.notSignedIn,
      action: 'sign-in',
      hub: HUB,
    });
  });

  test('the token is rejected (401/403, invalid-token) → Sign in again', () => {
    expect(applyFailureState({ status: 409, report: refused('token-rejected') })).toEqual({
      kind: 'token-rejected',
      line: FAIL_COPY.tokenRejected,
      action: 'sign-in-again',
      hub: HUB,
    });
  });

  test('an older server without the route (404 / 405, or an answer that is no report) → restart Maude', () => {
    for (const status of [404, 405]) {
      expect(applyFailureState({ status, report: null })).toEqual({
        kind: 'old-server',
        line: FAIL_COPY.oldServer,
        action: null,
      });
    }
    // a 200 that is not a migrate report (an older server's fallback page) is the same case
    expect(applyFailureState({ status: 200, report: null }).kind).toBe('old-server');
    expect(applyFailureState({ status: 200, report: { ok: true } }).kind).toBe('old-server');
    expect(FAIL_COPY.oldServer).toContain('Restart Maude');
  });

  test('an unexpected error (500, a dropped connection, a non-JSON answer) → a plain sentence, Retry update', () => {
    for (const r of [
      { status: 500, report: { error: 'migration failed' } },
      { status: 403, report: { error: 'apply runs from the Maude window (Update project)' } },
      { status: 409, report: null },
      { thrown: true },
    ]) {
      expect(applyFailureState(r)).toEqual({
        kind: 'unexpected',
        line: FAIL_COPY.unexpected,
        action: 'retry',
      });
    }
  });

  test('a refusal with its own reason keeps the reason (not the bare "was not updated")', () => {
    expect(
      applyFailureState({ status: 409, report: refused(undefined, 'a board would drop elements') })
    ).toEqual({
      kind: 'refused',
      line: 'The project was not updated — a board would drop elements. Nothing in it changed.',
      action: 'retry',
    });
  });

  test('the team server needs an update → How to update; not the owner → no action', () => {
    expect(applyFailureState({ status: 409, report: refused('hub-too-old') })).toMatchObject({
      kind: 'hub-too-old',
      action: 'team-server',
    });
    expect(
      applyFailureState({ status: 409, report: refused('not-owner', "only the project's owner") })
    ).toMatchObject({ kind: 'not-owner', action: null });
  });

  test('the actions read as CONTRACT §4 words', () => {
    expect(FAIL_COPY.retry).toBe('Retry update');
    expect(FAIL_COPY.signIn).toBe('Sign in');
    expect(FAIL_COPY.signInAgain).toBe('Sign in again'); // the Sync details card's own words
    for (const line of Object.values(FAIL_COPY))
      if (typeof line === 'string') expect(line).not.toMatch(/\b(we|I|Oops)\b|!/);
  });
});

describe('applyResult: one entry for the whole answer', () => {
  test('done keeps the existing toasts', () => {
    expect(applyResult({ status: 200, report: applied(1, {}) })).toEqual({
      done: true,
      toast: OLDER_COPY.toastUpdated,
    });
    expect(
      applyResult({ status: 200, report: applied(1, { modeDue: true, modeSwitched: true }) })
    ).toEqual({ done: true, toast: SAVE_COPY.toastBoth });
  });

  test('half-way (format moved, switch turned down for the sign-in): format-only toast with Sign in again', () => {
    expect(
      applyResult({
        status: 200,
        report: applied(1, { modeDue: true, modeSwitched: false, modeError: 'token-rejected' }),
      })
    ).toEqual({
      done: true,
      toast: FAIL_COPY.toastFormatOnlySignIn,
      action: 'sign-in-again',
      hub: HUB,
    });
    // any other reason keeps the existing honest toast
    expect(
      applyResult({
        status: 200,
        report: applied(1, { modeDue: true, modeSwitched: false, modeError: 'retryable' }),
      })
    ).toEqual({ done: true, toast: SAVE_COPY.toastFormatOnly });
  });

  test('a switch-only Update the hub turned down for the sign-in: not done, Sign in again', () => {
    expect(
      applyResult({
        status: 200,
        report: applied(2, { modeDue: true, modeSwitched: false, modeError: 'token-rejected' }),
      })
    ).toEqual({
      done: false,
      kind: 'switch-token-rejected',
      line: FAIL_COPY.switchTokenRejected,
      action: 'sign-in-again',
      hub: HUB,
    });
    expect(
      applyResult({
        status: 200,
        report: applied(2, { modeDue: true, modeSwitched: false, modeError: 'offline' }),
      })
    ).toEqual({
      done: false,
      kind: 'switch-failed',
      line: SAVE_COPY.switchFailed,
      action: 'retry',
    });
  });

  test('a failure answer goes through applyFailureState', () => {
    expect(applyResult({ status: 404, report: null })).toMatchObject({
      done: false,
      kind: 'old-server',
    });
  });
});

describe('the callout says it before anyone clicks', () => {
  const dry = (code: string, role = 'owner') => ({ ...refused(code, 'x', role), dryRun: true });

  test('format 1, the token is rejected: the owner gets Sign in again', () => {
    expect(olderGateState({ cfg: older, plan: dry('token-rejected') })).toEqual({
      kind: 'token-rejected',
      line: FAIL_COPY.olderTokenRejected,
      action: 'sign-in-again',
      hub: HUB,
    });
    expect(olderGateState({ cfg: older, plan: dry('token-rejected', 'member') })?.kind).toBe(
      'non-owner'
    );
  });

  test('format 1, no sign-in at all for the team server (role unknown): Sign in', () => {
    expect(olderGateState({ cfg: older, plan: dry('no-sign-in', 'unknown') })).toEqual({
      kind: 'no-sign-in',
      line: FAIL_COPY.olderNotSignedIn,
      action: 'sign-in',
      hub: HUB,
    });
  });

  test('format 2, saves the old way, the token is rejected: the quiet offer says why, Sign in again', () => {
    expect(saveModeState({ cfg: fmt2Legacy, plan: dry('token-rejected') })).toEqual({
      kind: 'save-mode-sign-in',
      line: FAIL_COPY.saveModeTokenRejected,
      action: 'sign-in-again',
      hub: HUB,
    });
    expect(saveModeState({ cfg: fmt2Legacy, plan: dry('token-rejected', 'member') })).toBe(null);
  });
});
