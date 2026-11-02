// feature-sync-progress-modal — the Sync panel surface (the HUB SYNC chip left with the status bar, V2-4.8b).
//
// Source-level assertions (cloud-shell-surfaces style): what these pin is
// exactly what would regress — someone dropping the linked-only gate (a solo
// project would get a dock tab that opens onto nothing), rewiring the chip
// away from the dock helpers (breaking the one-panel-per-side invariant), or
// the panel inventing sync vocabulary / dropping the a11y live region the
// CloudBar note established.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clientSource } from './_client-source.ts';

const STUDIO = join(import.meta.dir, '..');
// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const APP = clientSource();
// V2-4.7b: Resync and Download all moved into one module Menu › Diagnostics › Advanced
// both call; the route and the 409 wording are asserted there.
const SYNC_ACTIONS = readFileSync(
  join(STUDIO, 'client', 'v2', 'diagnostics', 'sync-actions.js'),
  'utf8'
);

describe('the dock no longer has a Sync panel (S11.12b); Sync details is the way in', () => {
  test('sync stays a dock id with a right-side default, so a remembered panel side still parses', () => {
    expect(APP).toContain("{ id: 'sync', label: 'Sync' }");
    expect(APP).toMatch(/sync: 'right'/);
  });

  test('panelAvailable never offers it — and the dock hook mounts no SyncPanel', () => {
    // V2-4.9 put the rule in the pure client/v2/shell/panel-availability.js (shared with the shell parity
    // table); S11.12b retired the panel itself and V2-8.0 deleted SyncPanel.jsx (SourceConflictPanel.jsx stays
    // for its `lineDiff`, mounted nowhere).
    expect(APP).toContain("if (id === 'sync') return false;");
    expect(APP).not.toContain('hasSync');
    const hook = readFileSync(
      join(STUDIO, 'client', 'hooks', 'use-palette-and-panels.jsx'),
      'utf8'
    );
    expect(hook).not.toMatch(/<SyncPanel\b/);
    expect(hook).not.toContain("panels/SyncPanel.jsx'");
    expect(hook).not.toMatch(/<SourceConflictPanel\b/);
  });

  test('the status-bar chip is gone — Details and Menu › Diagnostics › Sync are the way in (V2-4.8b)', () => {
    // The chip was the one button that toggled the dock's Sync panel. Its message moved: the Share
    // cluster word says the state, a sync callout's one action (Details) and the Diagnostics row open
    // today's Sync panel, whole, through the Diagnostics sheet.
    expect(APP).not.toContain('data-testid="open-sync"');
    expect(APP).not.toContain("onOpenSync={syncStatus ? () => toggleRightPanel('sync')");
    expect(APP).toContain("openDiagnostics('sync')");
    expect(APP).toContain("'diag.sync': () => open('sync')");
  });
});

// feature-sync-resync-and-out-of-process-sweep — the one control the whole feature exists for. What
// is pinned here is the property that makes it safe to press, on the module Menu › Diagnostics calls:
// it re-runs the WHOLE sync (not just assets), and a 409 is "already restarting", never a failure.
// (The v1 Sync panel's own markup guards left with the panel, V2-8.0; the v2 Sync details sheet has its
// own tests.)
describe('the Resync control', () => {
  test('it calls the whole-sync route, not an asset-only one', () => {
    expect(SYNC_ACTIONS).toContain("'/_api/sync/resync'");
  });

  test('a 409 reads as "already restarting", never as a failure', () => {
    expect(SYNC_ACTIONS).toMatch(/res\.status === 409/);
  });
});
