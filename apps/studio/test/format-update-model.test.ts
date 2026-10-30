// The v2 side of the format gate, as the app draws it. Since p8-v1-drop (decision
// maude/v2-michal-drop-v1-auto-convert) a format-1 project converts BY ITSELF when this Mac may: local /
// unlinked / the owner (or hub admin) on a v2 hub → 'ready' (the shell applies, unasked) · anyone else →
// the owner line · the owner on a 1.x hub → the team-server line + how to update it · the owner offline →
// the waiting line. (Pinned the opt-in "Update project" button + dialog before p8-v1-drop.)
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
    expect(OLDER_COPY.cloudDialogTitle('Alligators brand')).toBe(
      'Update "Alligators brand" for Maude 2 now?'
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

  test('a local project: it converts now, unasked (no button)', () => {
    expect(olderGateState({ cfg: older, plan: { exitCode: 0, refusals: [], steps: [] } })).toEqual({
      kind: 'ready',
      line: 'Updating this project for Maude 2…',
      action: null,
    });
    // while the dry run is in flight: the line, no button yet
    expect(olderGateState({ cfg: older, plan: undefined })).toMatchObject({ action: null });
  });

  test('a linked project on a v2 hub: the owner and the hub admin convert it', () => {
    expect(olderGateState({ cfg: older, plan: linked('owner') })?.kind).toBe('ready');
    expect(olderGateState({ cfg: older, plan: linked('admin') })?.kind).toBe('ready');
  });

  test('someone else: the owner line, no button', () => {
    for (const plan of [linked('member', ['not-owner']), linked('member', ['no-sign-in'])]) {
      expect(olderGateState({ cfg: older, plan })).toEqual({
        kind: 'non-owner',
        line: 'View only — this project moves to Maude 2 once its owner opens it. Ask the owner.',
        action: null,
      });
    }
    // a viewer (role read-only) never gets it either
    expect(
      olderGateState({ cfg: { ...older, readOnlyReason: 'role' }, plan: linked('owner') })?.kind
    ).toBe('non-owner');
  });

  test('a cloud cell: an editor the door refuses gets the owner line, not the button', () => {
    // The cell's door answers a non-owner's dry run 403 read-only (studio-manifest `delete`).
    const refused = {
      error: 'You can look at this project, but not change it.',
      reason: 'read-only',
    };
    expect(olderGateState({ cfg: older, plan: refused })).toEqual({
      kind: 'non-owner',
      line: 'View only — this project moves to Maude 2 once its owner opens it. Ask the owner.',
      action: null,
    });
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
      line: 'View only — waiting for the connection to the team server. The project moves to Maude 2 by itself once it is back.',
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
