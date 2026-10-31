// r1-format-ds (Michal rc.1, item 1) — a PARKED link (gate-b-sec4: a committed `linkedHub` that was
// never linked on this Mac) and the format update. Boot parks the claim (context.ts
// parkUnconfirmedLink) and the studio runs solo, but the migrator read the raw committed claim: with no
// credential handed to it, the dry run refused `no-sign-in` and the banner said "this Mac isn't signed
// in" with a Sign in button — even on a Mac that holds an owner sign-in for that hub. The way out of a
// parked claim is Connect (the Share sheet's "This project says it syncs with <host>. Connect?"), so the
// migrator names the parked state (`link-unconfirmed`) and the callout offers Connect.

import { afterEach, describe, expect, test } from 'bun:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { OLDER_COPY, olderGateState, RECHECK_KINDS } from '../client/v2/shell/format-update.js';
import { FORMAT_COPY } from '../format.ts';
import { planMigration } from '../migrate/engine.ts';
import { createProjectFormatRoutes } from '../routes/project-format.ts';
import { fixtureProject, opts, type Project } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const HUB = 'https://hub.example';

function linkedFixture(): Project {
  p = fixtureProject();
  const cfgPath = path.join(p.design, 'config.json');
  const cfg = JSON.parse(readFileSync(cfgPath, 'utf8'));
  writeFileSync(cfgPath, `${JSON.stringify({ ...cfg, linkedHub: { url: HUB, linkedAt: 1 } })}\n`);
  return p;
}

const codes = (r: { refusals: { code?: string }[] }) => r.refusals.map((x) => x.code);

describe('the migrator reads the parked claim like the rest of the server', () => {
  test('a parked claim refuses `link-unconfirmed`, never `no-sign-in`', async () => {
    const proj = linkedFixture();
    const r = await planMigration(opts(proj, { hub: null, parkedHub: HUB }));
    expect(codes(r)).toEqual(['link-unconfirmed']);
    expect(r.project.linked).toMatchObject({ hub: HUB, role: 'unknown' });
    // a trailing slash on either side is the same hub
    const r2 = await planMigration(opts(proj, { hub: null, parkedHub: `${HUB}/` }));
    expect(codes(r2)).toEqual(['link-unconfirmed']);
  });

  test('a confirmed link with no credential still says `no-sign-in`', async () => {
    const proj = linkedFixture();
    expect(codes(await planMigration(opts(proj, { hub: null })))).toEqual(['no-sign-in']);
    // a parked claim for ANOTHER hub does not hide this one's link
    expect(
      codes(await planMigration(opts(proj, { hub: null, parkedHub: 'https://other.example' })))
    ).toEqual(['no-sign-in']);
  });

  test('the route hands the parked claim to the dry run', async () => {
    const proj = linkedFixture();
    const [, migrate] = createProjectFormatRoutes({
      repoRoot: proj.repo,
      designRel: '.design',
      hub: () => null,
      parkedHub: () => HUB,
      formatView: () => ({}),
      autoConvert: () => ({ allowed: true }),
      engine: { liveStudio: () => false, dsEmitter: null },
    });
    const res = await migrate.handle(
      new Request('http://localhost/_api/project/migrate', {
        method: 'POST',
        body: JSON.stringify({ direction: 'forward' }),
      }),
      {}
    );
    expect(res.status).toBe(409);
    expect(codes((await res.json()) as { refusals: { code?: string }[] })).toEqual([
      'link-unconfirmed',
    ]);
  });
});

describe('the callout for a parked claim offers Connect', () => {
  const older = {
    formatGate: { projectFormat: 1, supported: 2, source: 'config' },
    readOnly: true,
    readOnlyReason: 'format',
  };
  const plan = {
    exitCode: 11,
    dryRun: true,
    project: { linked: { hub: HUB, role: 'unknown', hubFormat: null, capabilities: [] } },
    refusals: [{ path: '', reason: 'x', code: 'link-unconfirmed' }],
    steps: [],
  };

  test('line + action', () => {
    expect(olderGateState({ cfg: older, plan })).toEqual({
      kind: 'link-unconfirmed',
      line: OLDER_COPY.olderLinkUnconfirmed,
      action: 'connect',
      hub: HUB,
    });
    // the Share sheet's Connect may answer it too: a focus / timer re-check picks that up
    expect(RECHECK_KINDS.has('link-unconfirmed')).toBe(true);
  });

  test('the words are FORMAT_COPY’s, CONTRACT §4 voice', () => {
    expect(OLDER_COPY.olderLinkUnconfirmed).toBe(FORMAT_COPY.olderLinkUnconfirmed);
    expect(OLDER_COPY.connectAction).toBe(FORMAT_COPY.connectAction);
    expect(OLDER_COPY.olderLinkUnconfirmed).toMatch(/^View only — /);
    expect(OLDER_COPY.olderLinkUnconfirmed).not.toMatch(/signed in|\bwe\b|\bI\b/);
  });
});
