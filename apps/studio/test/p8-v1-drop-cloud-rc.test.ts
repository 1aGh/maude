// p8-v1-drop (decision maude/v2-michal-drop-v1-auto-convert) — a Maude Cloud project is NEVER converted
// unasked during the rc: cells run studio 1.x until a stable tag rolls the fleet, so a cloud project raised
// to format 2 would be view only in the cloud tab for everyone. The policy (format.ts autoConvertPolicy),
// the route's answer (`autoConvert` on every report) and the route's own refusal of an automatic apply
// (no `confirmCloud` → 409, nothing written) are pinned here. A local project converts on open with a
// backup in `_history/_migrate/`.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { autoConvertPolicy, isCloudHubUrl, isStableV2 } from '../format.ts';
import { createProjectFormatRoutes, defaultAutoConvert } from '../routes/project-format.ts';
import { matchRoute } from '../routes/table.ts';
import { fakeHub, fixtureProject, type Project } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const CLOUD = 'https://cloud.maude.sh';
const CELL = 'https://alligators-7f3.cloud.maude.sh';
const TEAM = 'https://hub.team.example';
const FROM_WINDOW = { 'sec-fetch-site': 'same-origin' };

describe('autoConvertPolicy — the rc never converts a cloud project unasked', () => {
  test('stable v2 only', () => {
    expect(isStableV2('2.0.0')).toBe(true);
    expect(isStableV2('2.3.1')).toBe(true);
    for (const v of ['2.0.0-rc.1', '2.0.0-rc.9', '1.10.0', '', 'nonsense', null])
      expect(isStableV2(v as string)).toBe(false);
  });

  test('the cloud host and the cells under it are Maude Cloud; a team server is not', () => {
    expect(isCloudHubUrl(CELL, CLOUD)).toBe(true);
    expect(isCloudHubUrl(CLOUD, CLOUD)).toBe(true);
    expect(isCloudHubUrl(TEAM, CLOUD)).toBe(false);
    expect(isCloudHubUrl('https://evilcloud.maude.sh.example', CLOUD)).toBe(false);
    expect(isCloudHubUrl(null, CLOUD)).toBe(false);
  });

  test('every rc version: a cell, or a desktop project linked to a cell → held', () => {
    for (const version of ['2.0.0-rc.1', '2.0.0-rc.4', '1.10.0']) {
      expect(
        autoConvertPolicy({ version, workspaceMode: false, hubUrl: CELL, cloudUrl: CLOUD })
      ).toEqual({ allowed: false, why: 'cloud-rc' });
      expect(
        autoConvertPolicy({ version, workspaceMode: true, hubUrl: null, cloudUrl: CLOUD })
      ).toEqual({ allowed: false, why: 'cloud-rc' });
      // a team server or a local project converts
      expect(
        autoConvertPolicy({ version, workspaceMode: false, hubUrl: TEAM, cloudUrl: CLOUD })
      ).toEqual({ allowed: true });
      expect(
        autoConvertPolicy({ version, workspaceMode: false, hubUrl: null, cloudUrl: CLOUD })
      ).toEqual({ allowed: true });
    }
    // the stable 2.0.0 rolls the fleet: then a cloud project converts like any other
    expect(
      autoConvertPolicy({ version: '2.0.0', workspaceMode: false, hubUrl: CELL, cloudUrl: CLOUD })
    ).toEqual({ allowed: true });
  });

  test('this build is an rc, so its default policy holds a cell-linked project', () => {
    const prev = process.env.MAUDE_CLOUD_URL;
    process.env.MAUDE_CLOUD_URL = CLOUD;
    try {
      expect(defaultAutoConvert(CELL)).toEqual({ allowed: false, why: 'cloud-rc' });
      expect(defaultAutoConvert(TEAM)).toEqual({ allowed: true });
      expect(defaultAutoConvert(null)).toEqual({ allowed: true });
    } finally {
      if (prev === undefined) delete process.env.MAUDE_CLOUD_URL;
      else process.env.MAUDE_CLOUD_URL = prev;
    }
  });
});

function link(project: Project, url: string) {
  const f = path.join(project.design, 'config.json');
  const cfg = JSON.parse(readFileSync(f, 'utf8'));
  writeFileSync(f, `${JSON.stringify({ ...cfg, linkedHub: { url, linkedAt: 1 } }, null, 2)}\n`);
}
const localFormat = (project: Project) =>
  JSON.parse(readFileSync(path.join(project.design, 'config.json'), 'utf8')).formatVersion ?? 1;

async function post(project: Project, body: unknown, hubUrl: string | null) {
  const hub = fakeHub({ formatVersion: 1 });
  const specs = createProjectFormatRoutes({
    repoRoot: project.repo,
    designRel: '.design',
    hub: () => (hubUrl ? { url: hubUrl, token: 't', role: 'owner' } : null),
    formatView: () => ({}),
    autoConvert: (linked) =>
      autoConvertPolicy({
        version: '2.0.0-rc.1',
        workspaceMode: false,
        hubUrl: linked,
        cloudUrl: CLOUD,
      }),
    engine: { liveStudio: () => true, dsEmitter: null, hubClient: hubUrl ? hub.client : null },
  });
  const m = matchRoute(specs, 'POST', '/_api/project/migrate');
  if (!m) throw new Error('no route');
  const res = await m.spec.handle(
    new Request('http://localhost/_api/project/migrate', {
      method: 'POST',
      headers: FROM_WINDOW,
      body: JSON.stringify(body),
    }),
    m.params
  );
  return {
    status: res.status,
    body: (await res.json()) as Record<string, unknown> & {
      autoConvert?: unknown;
      error?: string;
      exitCode?: number;
    },
    hub,
  };
}

describe('the route during the rc', () => {
  test('a cloud project: the dry run says held; an apply without confirmCloud writes nothing', async () => {
    p = fixtureProject();
    link(p, CELL);
    const dry = await post(p, { direction: 'forward' }, CELL);
    expect(dry.status).toBe(200);
    expect(dry.body.autoConvert).toEqual({ allowed: false, why: 'cloud-rc' });
    const auto = await post(p, { direction: 'forward', apply: true }, CELL);
    expect(auto.status).toBe(409);
    expect(auto.body.error).toBe('confirm-cloud');
    expect(localFormat(p)).toBe(1);
    expect(auto.hub.calls.filter((c) => c.op === 'setFormat')).toHaveLength(0);
    expect(existsSync(path.join(p.design, '_history', '_migrate'))).toBe(false);
    // the owner's own Update project, past the warning, still converts it
    const manual = await post(p, { direction: 'forward', apply: true, confirmCloud: true }, CELL);
    expect(manual.status).toBe(200);
    expect(localFormat(p)).toBe(2);
  });

  test('a local project: the dry run says go; the apply converts with a backup', async () => {
    p = fixtureProject();
    const dry = await post(p, { direction: 'forward' }, null);
    expect(dry.body.autoConvert).toEqual({ allowed: true });
    const applied = await post(p, { direction: 'forward', apply: true }, null);
    expect(applied.status).toBe(200);
    expect(localFormat(p)).toBe(2);
    const snaps = readdirSync(path.join(p.design, '_history', '_migrate'));
    expect(snaps.length).toBe(1);
    expect(snaps[0]).toMatch(/^v2-/);
    expect(existsSync(path.join(p.design, '_history', '_migrate', snaps[0], 'report.json'))).toBe(
      true
    );
  });

  test('a team-server project (owner, v2 hub): converts unasked, with the hub flipped', async () => {
    p = fixtureProject();
    link(p, TEAM);
    const dry = await post(p, { direction: 'forward' }, TEAM);
    expect(dry.body.autoConvert).toEqual({ allowed: true });
    expect(dry.body.exitCode).toBe(0);
  });
});
