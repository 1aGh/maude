// DDR-218 (fix 8, sync RCA 2026-08-10) — the cloud-managed GitPanel posture.
//
// Source-level assertions, the cloud-shell-surfaces pattern: what these pin is
// exactly what would regress — someone gating the withdrawal on `historyOnly`
// alone (dropping the desktop half), breaking the live connect/disconnect
// reaction, or wiring `cloudManaged` from something other than the
// CORROBORATED link (`credentialed` — config.json alone is attacker-authorable,
// B2).

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { clientSource } from './_client-source.ts';

const STUDIO = join(import.meta.dir, '..');
// The shell's code, whichever client file it lives in (app.jsx before the
// V2-0.2 split, its modules after) — see `_client-source.ts`.
const APP = clientSource();
const GIT_PANEL = readFileSync(join(STUDIO, 'client', 'panels', 'GitPanel.jsx'), 'utf8');
const CLOUD_BAR = readFileSync(join(STUDIO, 'client', 'panels', 'CloudBar.jsx'), 'utf8');

describe('a cloud-linked repo shows ONE save mechanism (DDR-218)', () => {
  test('cloudManaged withdraws exactly like the cell-side historyOnly', () => {
    expect(GIT_PANEL).toContain('const withdrawn = historyOnly || cloudManaged;');
    // Every render gate the working-tree half hides behind must read the
    // merged flag — a `!historyOnly` guard reintroduces the desktop leak.
    expect(GIT_PANEL).toMatch(/\{!withdrawn && \(\s*<div className="gp-tabs"/);
    expect(GIT_PANEL).toContain("{tab === 'changes' && !withdrawn ? (");
  });

  test('the posture reacts LIVE to connect/disconnect, not only at mount', () => {
    // The initial useState alone would leave a freshly-linked panel on Changes.
    expect(GIT_PANEL).toMatch(/useEffect\(\(\) => \{\s*if \(withdrawn\) setTab\('history'\);/);
  });

  test('the note names the active mechanism, and only in the desktop posture', () => {
    expect(GIT_PANEL).toContain('data-testid="git-cloud-managed"');
    expect(GIT_PANEL).toMatch(/\{cloudManaged && \(\s*<div className="gp-cloud-note"/);
    expect(GIT_PANEL).toContain('Cloud is saving');
  });

  test('the app gate is the CORROBORATED link, and the cell posture is untouched', () => {
    // Hoisted to a single top-level definition (2026-08-14) so the toolbar and
    // status bar read the SAME posture the panel does — see
    // cloud-managed-save-surfaces.test.ts. The gate itself is unchanged, and
    // `credentialed` is the load-bearing half: config.json alone is
    // attacker-authorable (B2), so a link claim without corroboration must
    // never reach this posture.
    expect(APP).toContain('const cloudManaged = !cfg.cloud && !!cloudLinkedHub?.credentialed;');
    expect(APP).toContain('const cellManaged = !!cfg.cloud;');
    // …and the panel is fed from those names, not a re-derivation.
    expect(APP).toContain('cloudManaged={cloudManaged}');
    expect(APP).toContain('historyOnly={cellManaged}');
  });

  test('CloudBar lifts every link change the posture depends on', () => {
    // status resolve + attach + detach — the three places the link changes.
    const lifts = CLOUD_BAR.match(/onLinkedHub\?\.\(/g) ?? [];
    expect(lifts.length).toBeGreaterThanOrEqual(3);
    expect(APP).toContain('onLinkedHub={setCloudLinkedHub}');
  });
});
