// feature-sync-progress-modal — the Sync panel + HUB SYNC chip surface.
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
const PANEL = readFileSync(join(STUDIO, 'client', 'panels', 'SyncPanel.jsx'), 'utf8');

describe('the Sync panel exists only where a hub link exists', () => {
  test('sync is a dock panel with a right-side default', () => {
    expect(APP).toContain("{ id: 'sync', label: 'Sync' }");
    expect(APP).toMatch(/sync: 'right'/);
  });

  test('panelAvailable gates sync on a live syncStatus — solo projects get no tab', () => {
    expect(APP).toContain("if (id === 'sync') return !!syncStatus;");
  });

  test('the chip toggles through the dock helpers, not a raw setState', () => {
    // toggleRightPanel keeps the one-panel-per-side invariant; a bare
    // setSyncPanelOpen(true) here would let Sync render behind an open sibling.
    expect(APP).toMatch(/onOpenSync=\{syncStatus \? \(\) => toggleRightPanel\('sync'\)/);
  });

  test('the chip is a real button with pressed-state semantics', () => {
    expect(APP).toContain('data-testid="open-sync"');
    expect(APP).toMatch(/aria-pressed=\{syncOpen\}/);
  });

  test('the span fallback remains for sessions without a handler', () => {
    // Older wiring / no-handler renders must keep the passive chip rather
    // than a dead button.
    expect(APP).toMatch(/onOpenSync \? \(/);
  });
});

describe('the Sync panel speaks the presentation vocabulary, safely', () => {
  test('the header sentence comes from syncPresentation — the one shared rule', () => {
    expect(PANEL).toContain("from '../../sync/presentation.ts'");
    expect(PANEL).toContain('syncPresentation(status');
  });

  test('rows map DocSyncState onto existing words, never new ones', () => {
    expect(PANEL).toMatch(/pending: 'syncing'/);
    expect(PANEL).toMatch(/connected: 'synced'/);
    expect(PANEL).toMatch(/'auth-rejected': 'refused'/);
  });

  test('every name that reaches the DOM goes through safeName', () => {
    // Slugs and asset keys are local, but the payload is read back off disk —
    // bounded text-only rendering is the house rule (DDR-054).
    expect(PANEL).toContain('import { safeDetail, safeName, syncPresentation }');
    expect(PANEL).not.toMatch(/dangerouslySetInnerHTML/);
  });

  test('the live header is a polite status region (the CloudBar a11y pattern)', () => {
    expect(PANEL).toMatch(/role="status" aria-live="polite"/);
  });

  test('the asset lane renders from the payload, with the retry promise', () => {
    expect(PANEL).toContain('data-testid="sync-assets"');
    expect(PANEL).toContain('retry on the next launch');
  });
});

describe('the panel reads the off-disk payload fail-closed (DDR-102 discipline)', () => {
  test('items, assets and the header counts all pass a readCounts-style gate', () => {
    // `_sync.json` is JSON.parse with no schema — a partial write or older
    // producer must degrade to "nothing to show", never crash or print NaN
    // (security review 2026-08-11, defender W1).
    expect(PANEL).toContain('function readItems(');
    expect(PANEL).toContain('function readAssets(');
    expect(PANEL).toContain('readItems(status?.items)');
    expect(PANEL).toContain('readAssets(status?.assets)');
    expect(PANEL).toMatch(/Number\.isInteger/);
    // The header chip validates the same counts the note fails closed on.
    expect(PANEL).toMatch(
      /\[rawDocs\.synced, rawDocs\.pending, rawDocs\.rejected\]\.every\(isCount\)/
    );
  });
});

// feature-sync-resync-and-out-of-process-sweep — the panel gained the one
// control the whole feature exists for. What is pinned here is not that a
// button renders, but the three properties that make it safe to press: it
// re-runs the WHOLE sync (not just assets), it cannot be spammed, and cancel
// reaches only the sweep.
describe('the Resync control', () => {
  test('it calls the whole-sync route, not an asset-only one', () => {
    expect(PANEL).toContain("fetch('/_api/sync/resync'");
    expect(PANEL).toContain('data-testid="sync-resync"');
  });

  test('it disables itself while running AND during the cooldown', () => {
    // A resync re-authenticates every document against the DDR-102 600/min
    // bucket; without the cooldown an impatient person pins their own hub.
    expect(PANEL).toContain('disabled={resyncing || cooling}');
    expect(PANEL).toMatch(/RESYNC_COOLDOWN_MS = [\d_]+/);
  });

  test('a 409 reads as "already restarting", never as a failure', () => {
    expect(PANEL).toMatch(/res\.status === 409/);
  });

  test('cancel is scoped to the sweep and only offered while one runs', () => {
    expect(PANEL).toContain("fetch('/_api/sync/cancel-assets'");
    expect(PANEL).toContain('data-testid="sync-assets-cancel"');
    expect(PANEL).toMatch(/!assets\.finished && \(/);
  });

  test('the note is sanitized too — server detail is still bounded text', () => {
    expect(PANEL).toContain("safeDetail(note, '')");
  });

  test('it is ABSENT in the cloud — the hub refuses that route on purpose', () => {
    // A cell's sync runtime serves the project to everyone in it, so cycling it
    // is an operator action and the hub refuses the route (v0.60.2). The panel
    // used to render the button regardless, so a cloud member could press a
    // control that cannot work by design and got an error sentence for it.
    // See `.ai/logs/rca/issue-cloud-assets-open-findings.md` §5.
    expect(PANEL).toMatch(/\{!cloud && \(/);
    expect(PANEL).toMatch(/cloud = null,/);
  });
});

describe('a held breaker is visible, because a log line is not a surface', () => {
  // The finding: `deleteHeld` / `firstAnchorHeld` / `reanchorHeld` shipped
  // with no consumer at all — declared, assigned, and read by nothing. So the
  // breakers the release leans on had their entire output in a dev-server
  // console, on a product whose premise (DDR-177) is that the user never opens
  // a terminal. A hold that nobody can see is a stall, not a safety control.
  test('the panel renders every hold the status carries', () => {
    expect(PANEL).toContain('files.held');
    expect(PANEL).toMatch(/data-testid=\{`sync-held-\$\{h\.kind\}`\}/);
  });

  test('it says nothing was removed — the reassurance IS the message', () => {
    expect(PANEL).toContain('nothing was removed');
  });

  test('it names the files, so a person can judge whether it was deliberate', () => {
    expect(PANEL).toMatch(/h\.paths/);
  });
});
