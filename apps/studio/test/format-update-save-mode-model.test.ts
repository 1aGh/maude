// p8-update-to-accepted — the Update project offer's SECOND trigger (Michal, decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`): a linked format-2 project that still
// saves the old way switches to accepted revisions BY ITSELF for its owner (p8-v1-drop — it was an
// opt-in offer with a dialog before); a cloud tab points the owner to the dashboard. Pure model —
// client/v2/shell/format-update.js.

import { describe, expect, test } from 'bun:test';

import {
  applyOutcome,
  isSaveModeOffer,
  OLDER_COPY,
  olderGateState,
  SAVE_COPY,
  saveModeState,
} from '../client/v2/shell/format-update.js';

const fmt2Legacy = { formatGate: null, formatVersion: 2, saveMode: 'legacy', readOnlyReason: null };
const older = {
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  formatVersion: 1,
  saveMode: 'legacy',
  readOnlyReason: 'format',
};

const plan = (role: string, linked: Record<string, unknown> = {}, refusals: unknown[] = []) => ({
  exitCode: refusals.length ? 11 : 0,
  dryRun: true,
  project: {
    formatBefore: 2,
    formatAfter: 2,
    linked: { hub: 'https://team.example', role, hubFormat: 2, capabilities: [], ...linked },
  },
  refusals,
  steps: [],
});

describe('the save-mode trigger (format 2 + legacy)', () => {
  test('offered only for a linked, editable, format-2 project that saves the old way', () => {
    expect(isSaveModeOffer(fmt2Legacy)).toBe(true);
    expect(isSaveModeOffer({ ...fmt2Legacy, saveMode: 'accepted' })).toBe(false);
    expect(isSaveModeOffer({ ...fmt2Legacy, saveMode: null })).toBe(false); // solo: nothing syncs
    expect(isSaveModeOffer({ ...fmt2Legacy, readOnlyReason: 'role' })).toBe(false);
    expect(isSaveModeOffer(older)).toBe(false); // the older-project callout owns that one
  });

  test('the owner switches unasked once the dry run says the switch is due', () => {
    expect(saveModeState({ cfg: fmt2Legacy, plan: undefined })?.kind).toBe('checking'); // view only meanwhile
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('owner', { modeDue: true }) })).toEqual({
      kind: 'ready',
      line: SAVE_COPY.updating,
      action: null,
    });
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('admin', { modeDue: true }) })?.kind).toBe(
      'ready'
    );
  });

  test('owner only; anyone else, or a hub that cannot switch it now, gets the view-only line (p8-v1-drop)', () => {
    // editing the old way is gone: the project is view only until it switches, so a non-owner is told why
    // (was: nothing — the project stayed editable the old way)
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('member', { modeDue: true }) })).toEqual({
      kind: 'non-owner',
      line: SAVE_COPY.nonOwner,
      action: null,
    });
    const blocked = plan('owner', { modeBlocker: 'store-not-durable' }, [
      { path: '', reason: 'x', code: 'store-not-durable' },
    ]);
    expect(saveModeState({ cfg: fmt2Legacy, plan: blocked })).toMatchObject({
      kind: 'server-setup',
      line: SAVE_COPY.serverSetup,
    });
    expect(saveModeState({ cfg: fmt2Legacy, plan: { error: true } })?.kind).toBe('failed');
    expect(
      saveModeState({ cfg: fmt2Legacy, plan: plan('owner', { mode: 'transactions' }) })?.kind
    ).toBe('checking');
  });

  test('a cloud tab: the owner is pointed to the dashboard, nobody else sees anything', () => {
    const cloud = {
      ...fmt2Legacy,
      cloud: { dashboardUrl: 'https://cloud.example', role: 'owner' },
    };
    expect(isSaveModeOffer(cloud)).toBe(true);
    expect(saveModeState({ cfg: cloud, plan: undefined })).toEqual({
      kind: 'save-mode-cloud',
      line: SAVE_COPY.cloudStatus,
      action: 'dashboard',
      href: 'https://cloud.example',
    });
    // p8-v1-drop: anyone else sees the view-only line (was: nothing)
    expect(
      saveModeState({
        cfg: { ...cloud, cloud: { ...cloud.cloud, role: 'editor' } },
        plan: undefined,
      })?.kind
    ).toBe('non-owner');
    // a self-hosted workspace has no dashboard to send anyone to
    expect(
      saveModeState({ cfg: { ...cloud, cloud: { role: 'owner' } }, plan: undefined })?.kind
    ).toBe('non-owner');
  });

  test('the older-project callout is unchanged by the second trigger', () => {
    expect(olderGateState({ cfg: fmt2Legacy, plan: plan('owner', { modeDue: true }) })).toBe(null);
  });
});

describe('the dialog and the outcome', () => {
  test('outcomes: both, format only (switch failed), mode only, importing, a failed mode-only run', () => {
    const rep = (formatBefore: number, linked: Record<string, unknown>, notes: string[] = []) => ({
      dryRun: false,
      exitCode: 0,
      project: { formatBefore, formatAfter: 2, linked: { role: 'owner', ...linked } },
      refusals: [],
      steps: [],
      notes,
    });
    expect(applyOutcome(rep(1, { modeDue: true, modeSwitched: true }))).toEqual({
      done: true,
      toast: SAVE_COPY.toastBoth,
    });
    expect(applyOutcome(rep(1, { modeDue: true, modeSwitched: false }))).toEqual({
      done: true,
      toast: SAVE_COPY.toastFormatOnly,
    });
    expect(applyOutcome(rep(1, {}))).toEqual({ done: true, toast: OLDER_COPY.toastUpdated });
    expect(applyOutcome(rep(2, { modeDue: true, modeSwitched: true }))).toEqual({
      done: true,
      toast: SAVE_COPY.toastSwitched,
    });
    expect(
      applyOutcome(rep(2, { modeDue: true, modeSwitched: true, modeImporting: true })).toast
    ).toBe(SAVE_COPY.toastImporting);
    expect(applyOutcome(rep(2, { modeDue: true, modeSwitched: false }))).toEqual({
      done: false,
      error: SAVE_COPY.switchFailed,
    });
    expect(applyOutcome({ exitCode: 11, refusals: [{ reason: 'x' }], steps: [] }).done).toBe(false);
  });

  test('the words keep the contract voice: no we / I, no exclamation marks', () => {
    for (const v of Object.values(SAVE_COPY)) {
      const s = typeof v === 'function' ? v('Studio site') : v;
      expect(s).not.toMatch(/\b(we|I|our)\b|!/);
    }
  });
});
