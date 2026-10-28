// Michal 2A (2026-10-28) — the v2 side of the format gate, as the app draws it: a format-1 project is
// view only and offers ONE button, Update project, to whoever may press it. Who sees what (lead decision):
// local / unlinked / the owner (or hub admin) on a v2 hub → Update project · anyone else → the owner line ·
// the owner on a 1.x hub → the team-server line + how to update it · the owner offline → the offline line.
// The words are FORMAT_COPY's (CONTRACT §4) — one set, pinned here.

import { describe, expect, test } from 'bun:test';

import {
  applyFailureLine,
  isOlderGate,
  OLDER_COPY,
  olderGateState,
  teamServerCommand,
} from '../client/v2/shell/format-update.js';
import { FORMAT_COPY } from '../format.ts';

const older = {
  formatGate: { projectFormat: 1, supported: 2, source: 'config' },
  readOnly: true,
  readOnlyReason: 'format',
};
const linked = (role: string, codes: string[] = []) => ({
  exitCode: codes.length ? 11 : 0,
  dryRun: true,
  project: { linked: { hub: 'https://team.example', role, hubFormat: 1, capabilities: [] } },
  refusals: codes.map((code) => ({ path: '', reason: code, code })),
  steps: [],
});

describe('the older-project callout', () => {
  test('the words are FORMAT_COPY’s (one set)', () => {
    for (const [k, v] of Object.entries(OLDER_COPY)) {
      const want = (FORMAT_COPY as Record<string, unknown>)[k];
      if (typeof v === 'function') {
        expect(v('Alligators brand')).toBe((want as (n: string) => string)('Alligators brand'));
      } else {
        expect({ k, v }).toEqual({ k, v: want });
      }
    }
    expect(OLDER_COPY.dialogTitle('Alligators brand')).toBe(
      'Update "Alligators brand" for Maude 2?'
    );
  });

  test('not an older project → no callout (format 2, a newer one, no gate)', () => {
    expect(olderGateState({ cfg: { formatGate: null }, plan: undefined })).toBe(null);
    expect(
      olderGateState({
        cfg: { formatGate: { projectFormat: 3, supported: 2, source: 'hub' } },
        plan: undefined,
      })
    ).toBe(null);
    expect(isOlderGate(older)).toBe(true);
  });

  test('a local project: view only + Update project', () => {
    expect(olderGateState({ cfg: older, plan: { exitCode: 0, refusals: [], steps: [] } })).toEqual({
      kind: 'owner',
      line: 'View only — this project still uses Maude 1.',
      action: 'update',
    });
    // while the dry run is in flight: the line, no button yet
    expect(olderGateState({ cfg: older, plan: undefined })).toMatchObject({ action: null });
  });

  test('a linked project on a v2 hub: the owner and the hub admin get the button', () => {
    expect(olderGateState({ cfg: older, plan: linked('owner') })?.action).toBe('update');
    expect(olderGateState({ cfg: older, plan: linked('admin') })?.action).toBe('update');
  });

  test('someone else: the owner line, no button', () => {
    for (const plan of [linked('member', ['not-owner']), linked('member', ['no-sign-in'])]) {
      expect(olderGateState({ cfg: older, plan })).toEqual({
        kind: 'non-owner',
        line: "View only — the owner hasn't updated this project for Maude 2 yet.",
        action: null,
      });
    }
    // a viewer (role read-only) never gets it either
    expect(
      olderGateState({ cfg: { ...older, readOnlyReason: 'role' }, plan: linked('owner') })?.kind
    ).toBe('non-owner');
  });

  test('the owner on a 1.x hub: the team-server line + how to update it; others the owner line', () => {
    expect(olderGateState({ cfg: older, plan: linked('owner', ['hub-too-old']) })).toEqual({
      kind: 'hub-too-old',
      line: 'View only — the team server needs an update before this project can move to Maude 2.',
      action: 'team-server',
    });
    expect(olderGateState({ cfg: older, plan: linked('member', ['hub-too-old']) })?.kind).toBe(
      'non-owner'
    );
  });

  test('the owner offline: the offline line, no button', () => {
    expect(olderGateState({ cfg: older, plan: linked('owner', ['offline']) })).toEqual({
      kind: 'offline',
      line: 'View only — updating the project needs the team server, and this Mac is offline.',
      action: null,
    });
  });

  test('the team-server command names this release; a refused apply says what stopped it', () => {
    expect(teamServerCommand('2.0.0-rc.1')).toBe('maude hub workspace-up --image-tag 2.0.0-rc.1');
    expect(teamServerCommand('evil; rm -rf /')).toBe('maude hub workspace-up --image-tag latest');
    expect(
      applyFailureLine({ refusals: [{ path: 'x', reason: 'a board would drop elements' }] })
    ).toBe('The project was not updated — a board would drop elements. Nothing in it changed.');
  });
});
