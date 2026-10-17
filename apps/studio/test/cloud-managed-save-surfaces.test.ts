// DDR-218's withdrawal, applied to EVERY surface that reports a save state.
//
// The decision withdrew the working-tree half of the Changes surface whenever
// somebody else commits this project — a cloud cell (`historyOnly`, `cfg.cloud`)
// or the cell behind a linked+credentialed desktop repo (`cloudManaged`). It
// landed in GitPanel only. `app.jsx` went on computing the dirty count a second
// time, ungated, and handing it to the toolbar menu and the status-bar chip, so
// both shells kept rendering "N unsaved" — the exact claim the withdrawal exists
// to delete. Reported again 2026-08-14 ("89 unsaved changes on the cloud, 36 on
// the desktop"), which is what these assertions are here to stop.
//
// Source-level (sync-panel-surface style): what they pin is what would regress —
// someone re-deriving the posture at a call site, or adding a THIRD surface that
// reads `gitStatus.files.length` directly.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clientMatches, clientSource } from './_client-source.ts';

const STUDIO = join(import.meta.dir, '..');
// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const APP = clientSource();
const PANEL = readFileSync(join(STUDIO, 'client', 'panels', 'GitPanel.jsx'), 'utf8');

describe('one expression owns "who is saving this project"', () => {
  test('both postures are named once, at the top level', () => {
    expect(APP).toContain('const cellManaged = !!cfg.cloud;');
    expect(APP).toContain('const cloudManaged = !cfg.cloud && !!cloudLinkedHub?.credentialed;');
    expect(APP).toContain('const savingIsManaged = cellManaged || cloudManaged;');
  });

  test('the GitPanel call site consumes those names rather than re-deriving them', () => {
    // Re-deriving is how the two halves drift apart in the first place.
    expect(APP).toContain('historyOnly={cellManaged}');
    expect(APP).toContain('cloudManaged={cloudManaged}');
  });
});

describe('the dirty COUNT is withheld wherever saving is managed', () => {
  test('unsavedCount is gated, not raw', () => {
    expect(APP).toContain(
      'const unsavedCount = savingIsManaged ? 0 : gitStatus?.files?.length || 0;'
    );
  });

  test('no surface reads the raw file count for display', () => {
    // Exactly one `gitStatus?.files?.length` may exist, and it is the gated one
    // above. A second occurrence is a new leak by construction — counted across
    // every client module, so a surface split out of app.jsx is still counted.
    const raw = clientMatches(/gitStatus\?\.files\?\.length/g);
    expect(raw.length).toBe(1);
  });

  test('every changesCount consumer is fed the gated value', () => {
    // (None may be left at all: V2-4.8b removed the status-bar chip, V2-4.8a removes the menubar.)
    const feeds = clientMatches(/changesCount=\{[^}]+\}/g);
    for (const feed of feeds) expect(feed).toBe('changesCount={unsavedCount}');
  });
});

describe('no surface re-derives a save count the posture withdrew', () => {
  // The status-bar chip ("N unsaved" / "N to publish" / "cloud saving") left with the bar in
  // V2-4.8b. What it said lives on: a project somebody else saves reads Saved / Syncing… in the
  // Share cluster (save-status.js), and the Changes panel itself names the mechanism (below).
  test('the chip and its posture props are gone', () => {
    expect(APP).not.toContain("'cloud saving'");
    expect(APP).not.toMatch(/unpushed=\{/);
  });
});

describe('the panel half of DDR-218 is still intact', () => {
  test('withdrawal covers both postures', () => {
    expect(PANEL).toContain('const withdrawn = historyOnly || cloudManaged;');
  });

  test('the panel badge stays gated on it', () => {
    expect(PANEL).toMatch(/!withdrawn && count > 0/);
  });

  test('the cloud-managed note keeps its testid and names the live mechanism', () => {
    expect(PANEL).toContain('data-testid="git-cloud-managed"');
    expect(PANEL).toMatch(/Cloud is saving/);
  });
});
