// p8-update-to-accepted — the Update project offer's SECOND trigger (Michal, decision
// `maude/v2-michal-update-project-switches-legacy-to-accepted`): a linked format-2 project that still
// saves the old way offers the same Update to its owner, quieter (it is not view only); a format-1 +
// legacy project gets ONE dialog body that names both changes; a cloud tab points the owner to the
// dashboard. Pure model — client/v2/shell/format-update.js.

import { describe, expect, test } from 'bun:test';

import {
  applyOutcome,
  isSaveModeOffer,
  OLDER_COPY,
  olderGateState,
  SAVE_COPY,
  saveModeState,
  updateDialogCopy,
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

  test('the owner gets the quiet line + Update project once the dry run says the switch is due', () => {
    expect(saveModeState({ cfg: fmt2Legacy, plan: undefined })).toBe(null); // quiet: no "checking"
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('owner', { modeDue: true }) })).toEqual({
      kind: 'save-mode',
      line: SAVE_COPY.status,
      action: 'update',
    });
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('admin', { modeDue: true }) })?.action).toBe(
      'update'
    );
  });

  test('owner only, and nothing when the hub cannot switch it now', () => {
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('member', { modeDue: true }) })).toBe(null);
    const blocked = plan('owner', { modeBlocker: 'store-not-durable' }, [
      { path: '', reason: 'x', code: 'store-not-durable' },
    ]);
    expect(saveModeState({ cfg: fmt2Legacy, plan: blocked })).toBe(null);
    expect(saveModeState({ cfg: fmt2Legacy, plan: { error: true } })).toBe(null);
    expect(saveModeState({ cfg: fmt2Legacy, plan: plan('owner', { mode: 'transactions' }) })).toBe(
      null
    );
  });

  test('a cloud tab: the owner is pointed to the dashboard, nobody else sees anything', () => {
    const cloud = { ...fmt2Legacy, cloud: { dashboardUrl: 'https://cloud.example', role: 'owner' } };
    expect(isSaveModeOffer(cloud)).toBe(true);
    expect(saveModeState({ cfg: cloud, plan: undefined })).toEqual({
      kind: 'save-mode-cloud',
      line: SAVE_COPY.cloudStatus,
      action: 'dashboard',
      href: 'https://cloud.example',
    });
    expect(
      saveModeState({ cfg: { ...cloud, cloud: { ...cloud.cloud, role: 'editor' } }, plan: undefined })
    ).toBe(null);
    // a self-hosted workspace has no dashboard to send anyone to
    expect(saveModeState({ cfg: { ...cloud, cloud: { role: 'owner' } }, plan: undefined })).toBe(null);
  });

  test('the older-project callout is unchanged by the second trigger', () => {
    expect(olderGateState({ cfg: fmt2Legacy, plan: plan('owner', { modeDue: true }) })).toBe(null);
  });
});

describe('the dialog and the outcome', () => {
  test('format 1 + legacy: one combined body naming both changes', () => {
    const d = updateDialogCopy({
      older: true,
      plan: plan('owner', { modeDue: true, hubFormat: 1 }),
      name: 'Alligators brand',
    });
    expect(d.title).toBe(OLDER_COPY.dialogTitle('Alligators brand'));
    expect(d.body).toEqual([OLDER_COPY.dialogBody, SAVE_COPY.combinedBody]);
    expect(d.action).toBe('Update project');
  });

  test('format 1 without a switch due: the format body alone', () => {
    const d = updateDialogCopy({ older: true, plan: plan('owner'), name: 'Studio site' });
    expect(d.body).toEqual([OLDER_COPY.dialogBody]);
  });

  test('format 2 + legacy: the save-mode dialog, asked with the button’s verb', () => {
    const d = updateDialogCopy({ older: false, plan: plan('owner', { modeDue: true }), name: 'Studio site' });
    expect(d.title).toBe('Update how "Studio site" saves?');
    expect(d.title.startsWith(d.action.split(' ')[0])).toBe(true);
    expect(d.body).toEqual([SAVE_COPY.dialogBody]);
    // what changes for others, in plain words
    expect(SAVE_COPY.dialogBody).toContain('switches over by themselves');
    expect(SAVE_COPY.dialogBody).toContain('nothing in it is lost');
    expect(SAVE_COPY.dialogBody).toContain('older than 1.3');
  });

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
