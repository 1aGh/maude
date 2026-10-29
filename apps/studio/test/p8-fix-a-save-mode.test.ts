// p8-fix-a F19 — `/_config.saveMode` is not `legacy` before the hub has answered, and the cloud tab's
// "switch it in the dashboard" link goes to THIS project's Saving page, not the dashboard root.

import { describe, expect, test } from 'bun:test';

import { isSaveModeOffer, SAVE_COPY, saveModeState } from '../client/v2/shell/format-update.js';
import { projectDashboardUrl, saveModeOf } from '../http.ts';

describe('saveModeOf', () => {
  test('pending while the hub has not answered; a real answer afterwards', () => {
    let known = false;
    let accepted = false;
    const rt = { acceptedMode: () => accepted, acceptedModeKnown: () => known };
    expect(saveModeOf(rt)).toBe('pending');
    known = true;
    expect(saveModeOf(rt)).toBe('legacy');
    accepted = true;
    expect(saveModeOf(rt)).toBe('accepted');
  });

  test('unchanged for a runtime without the known flag, and null in solo', () => {
    expect(saveModeOf({ acceptedMode: () => false })).toBe('legacy');
    expect(saveModeOf({ acceptedMode: () => true })).toBe('accepted');
    expect(saveModeOf({})).toBeNull();
    expect(saveModeOf(null)).toBeNull();
  });
});

describe('the shell offers nothing while the mode is pending', () => {
  const base = { formatGate: null, formatVersion: 2, readOnlyReason: null };
  test('pending is not the old way', () => {
    expect(isSaveModeOffer({ ...base, saveMode: 'pending' })).toBe(false);
    expect(isSaveModeOffer({ ...base, saveMode: 'legacy' })).toBe(true);
    expect(
      saveModeState({
        cfg: {
          ...base,
          saveMode: 'pending',
          cloud: { dashboardUrl: 'https://d.example', role: 'owner' },
        },
        plan: undefined,
      })
    ).toBeNull();
  });
});

describe('the cloud tab links to the project’s own page', () => {
  test('projectDashboardUrl needs both the dashboard and the tenant id', () => {
    expect(
      projectDashboardUrl({
        HUB_DASHBOARD_URL: 'https://cloud.example/',
        MAUDE_TENANT_ID: 'alli gators',
      })
    ).toBe('https://cloud.example/projects/alli%20gators');
    expect(projectDashboardUrl({ HUB_DASHBOARD_URL: 'https://cloud.example' })).toBeNull();
    expect(projectDashboardUrl({ MAUDE_TENANT_ID: 'p1' })).toBeNull();
  });

  test('the owner’s link is the project’s Saving page; without a project id it stays the root', () => {
    const cfg = (cloud: object) => ({
      formatGate: null,
      formatVersion: 2,
      readOnlyReason: null,
      saveMode: 'legacy',
      cloud,
    });
    expect(
      saveModeState({
        cfg: cfg({
          dashboardUrl: 'https://cloud.example',
          projectUrl: 'https://cloud.example/projects/p1',
          role: 'owner',
        }),
        plan: undefined,
      })
    ).toEqual({
      kind: 'save-mode-cloud',
      line: SAVE_COPY.cloudStatus,
      action: 'dashboard',
      href: 'https://cloud.example/projects/p1/saving',
    });
    expect(
      saveModeState({
        cfg: cfg({ dashboardUrl: 'https://cloud.example', role: 'owner' }),
        plan: undefined,
      })?.href
    ).toBe('https://cloud.example');
  });
});
