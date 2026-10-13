// home-page-model — the Home page's merge (V2-1.1 §5.6 step 4) as a pure function: Pinned,
// Recent canvases by openedAt, and Projects grouped by profile = local registry entries ∪ cloud
// projects without a local copy (matched by hub URL or managed key).

import { describe, expect, test } from 'bun:test';

import {
  buildHomeModel,
  cloudRoleWord,
  managedKey,
  relativeTime,
  rowSlug,
} from '../client/home/home-model.js';

const P1 = 'l0000000000000001';
const P2 = 'l0000000000000002';
const P3 = 'l0000000000000003';

const canvas = (rel: string, extra: Record<string, unknown> = {}) => ({
  rel,
  name: rel
    .split('/')
    .pop()
    ?.replace(/\.tsx$/, ''),
  folder: rel.split('/').slice(0, -1).join('/'),
  kind: 'tsx',
  ds: null,
  mtimeMs: 1,
  artboards: [],
  dynamic: false,
  cover: null,
  madeByAi: false,
  pinnedAt: null,
  openedAt: null,
  ...extra,
});

function fixtures() {
  const shell = {
    projects: [
      {
        pid: P1,
        root: '/Users/x/Maude/alligators',
        name: 'Alligators brand',
        profile: 'work',
        place: 'tab',
        focused: false,
        linkedHub: { url: 'https://alligators.cloud.maude.sh/' },
        // the shell's own binding (a managed copy it made) — what dedupes the cloud row
        hub: 'https://alligators.cloud.maude.sh/',
      },
      {
        pid: P2,
        root: '/Users/x/Maude/studio',
        name: 'Studio site',
        profile: 'default',
        place: 'closed',
        focused: false,
      },
      {
        pid: P3,
        root: '/Users/x/gone',
        name: 'Portfolio 2026',
        profile: 'default',
        place: 'closed',
        focused: false,
      },
    ],
    profiles: [
      { id: 'default', label: 'Personal', email: 'you@gmail.com' },
      { id: 'work', label: 'Work', email: 'you@work-studio.cz' },
    ],
    recent: [P2, P1, P3],
  };
  const index = {
    v: 1,
    projects: [
      {
        pid: P1,
        state: 'ok',
        stale: false,
        project: {
          root: '/Users/x/Maude/alligators',
          name: 'Alligators brand',
          label: null,
          formatVersion: 1,
          linkedHub: { url: 'https://alligators.cloud.maude.sh' },
          managed: false,
        },
        counts: { canvases: 3, artboards: 4, byKind: {} },
        canvases: [
          canvas('ui/2026/combine/Combine-kampan.tsx', { pinnedAt: 100, openedAt: 300 }),
          canvas('ui/2026/dresy/Uniformy-2027.tsx', { openedAt: 500, pinnedAt: 200 }),
          canvas('ui/never/Opened.tsx'),
        ],
      },
      {
        pid: P2,
        state: 'ok',
        stale: true,
        project: {
          root: '/Users/x/Maude/studio',
          name: 'Studio site',
          label: null,
          formatVersion: 1,
          linkedHub: null,
          managed: false,
        },
        counts: { canvases: 1, artboards: 1, byKind: {} },
        canvases: [
          canvas('ui/Homepage.tsx', {
            openedAt: 400,
            cover: { key: 'abcd1234', w: 320, h: 200, fresh: true },
          }),
        ],
      },
      { pid: P3, state: 'gone', stale: false, project: { name: 'Portfolio 2026' } },
    ],
  };
  const clouds = [
    {
      ok: true,
      profile: 'work',
      signedIn: true,
      account: { email: 'you@work-studio.cz' },
      projects: [
        // same hub as P1 (trailing slash + case differ) → NOT a cloud-only row
        {
          id: 'alligators',
          name: 'Alligators brand',
          role: 'owner',
          url: 'HTTPS://Alligators.cloud.maude.sh',
          updatedAt: 1,
        },
        // a managed copy on this Mac, matched by the shell's binding (`hub`)
        {
          id: 'sponzori',
          name: 'Sponzoři 2027',
          role: 'member',
          url: 'https://sponzori.cloud.maude.sh',
          updatedAt: 2,
        },
        // not on this Mac
        {
          id: 'nabor-2027',
          name: 'Nábor 2027',
          role: 'viewer',
          ownerName: 'Tereza',
          url: 'https://nabor.cloud.maude.sh',
          updatedAt: 3,
        },
      ],
      shared: [],
      fetchedAt: 0,
    },
  ];
  // the managed copy lives in the registry with a root named by managed_key
  shell.projects.push({
    pid: 'l0000000000000004',
    root: `/Users/x/Library/Application Support/sh.maude/projects/${managedKey('https://sponzori.cloud.maude.sh', 'sponzori')}`,
    name: 'Sponzoři 2027',
    profile: 'work',
    place: 'resting',
    focused: false,
    hub: 'https://sponzori.cloud.maude.sh',
  });
  return { shell, index, clouds };
}

describe('buildHomeModel', () => {
  // V2-3.6 N-M4: a project's committed linkedHub is a display hint, never proof that a cloud
  // project is on this Mac — only the shell's binding (`hub`, same profile) hides the cloud row.
  test('a self-claimed linkedHub does not hide the cloud row; the shell binding does', () => {
    const f = fixtures();
    const claimer = f.shell.projects.find((p) => p.pid === P2);
    if (claimer) claimer.linkedHub = { url: 'https://nabor.cloud.maude.sh' };
    const nabor = f.index.projects.find((p) => p.pid === P2)?.project;
    if (nabor) nabor.linkedHub = { url: 'https://nabor.cloud.maude.sh' };
    const cloudIds = (m: ReturnType<typeof buildHomeModel>) =>
      m.groups
        .flatMap((g) => g.rows)
        .filter((r) => r.kind === 'cloud')
        .map((r) => r.projectId);
    expect(cloudIds(buildHomeModel(f))).toContain('nabor-2027');
    // bound in ANOTHER profile (P2 is default; the listing is work's) — still shown
    if (claimer) claimer.hub = 'https://nabor.cloud.maude.sh';
    expect(cloudIds(buildHomeModel(f))).toContain('nabor-2027');
    if (claimer) claimer.profile = 'work';
    expect(cloudIds(buildHomeModel(f))).not.toContain('nabor-2027');
  });

  test('Pinned is every pinned row, most recently pinned first', () => {
    const m = buildHomeModel(fixtures());
    expect(m.pinned.map((r) => r.rel)).toEqual([
      'ui/2026/dresy/Uniformy-2027.tsx',
      'ui/2026/combine/Combine-kampan.tsx',
    ]);
    expect(m.pinned[0]?.projectName).toBe('Alligators brand');
  });

  test('Recent canvases are the opened rows across projects by openedAt, newest first', () => {
    const m = buildHomeModel(fixtures());
    expect(m.recent.map((r) => `${r.pid}:${r.rel}`)).toEqual([
      `${P1}:ui/2026/dresy/Uniformy-2027.tsx`,
      `${P2}:ui/Homepage.tsx`,
      `${P1}:ui/2026/combine/Combine-kampan.tsx`,
    ]);
    // a row never opened on this Mac is not "recent"
    expect(m.recent.some((r) => r.rel === 'ui/never/Opened.tsx')).toBe(false);
    expect(m.recent[1]?.thumb).toBe(`/_home/thumb/${P2}/abcd1234.jpg`);
  });

  test('the project filter narrows Recent to one pid', () => {
    const m = buildHomeModel({ ...fixtures(), filterPid: P2 });
    expect(m.recent.map((r) => r.pid)).toEqual([P2]);
    // the filter list names only projects that have recent rows
    expect(buildHomeModel(fixtures()).recentProjects.map((p) => p.pid)).toEqual([P1, P2]);
  });

  test('Projects group by profile; local rows say where they are', () => {
    const m = buildHomeModel(fixtures());
    expect(m.groups.map((g) => g.profile.id)).toEqual(['default', 'work']);
    const personal = m.groups[0];
    // MRU order from shell.recent
    expect(personal?.rows.map((r) => r.pid)).toEqual([P2, P3]);
    expect(personal?.rows[0]?.status).toBe('mac');
    expect(personal?.rows[1]?.status).toBe('gone');
    const work = m.groups[1];
    const p1 = work?.rows.find((r) => r.pid === P1);
    expect(p1?.status).toBe('tab');
    expect(p1?.canvasCount).toBe(3);
  });

  test('a cloud project without a local copy is a "not on this Mac yet" row; matched ones are not', () => {
    const m = buildHomeModel(fixtures());
    const work = m.groups.find((g) => g.profile.id === 'work');
    const cloudRows = work?.rows.filter((r) => r.kind === 'cloud') ?? [];
    expect(cloudRows.map((r) => r.projectId)).toEqual(['nabor-2027']);
    expect(cloudRows[0]?.status).toBe('cloud');
    expect(cloudRows[0]?.role).toBe('viewer');
    expect(cloudRows[0]?.profile).toBe('work');
  });

  test('a cloud listing for a profile the shell does not name still gets its own group', () => {
    const f = fixtures();
    f.clouds.push({ ...f.clouds[0], profile: 'other' } as (typeof f.clouds)[number]);
    const m = buildHomeModel(f);
    expect(m.groups.map((g) => g.profile.id)).toContain('other');
  });

  test('no shell state (a browser): index rows still render, every project in one group', () => {
    const f = fixtures();
    const m = buildHomeModel({ shell: null, index: f.index, clouds: [] });
    expect(m.recent.length).toBe(3);
    expect(m.groups.length).toBe(1);
    expect(m.groups[0]?.rows.map((r) => r.pid).sort()).toEqual([P1, P2, P3].sort());
  });

  test('empty inputs give an empty model, never a throw', () => {
    const m = buildHomeModel({ shell: null, index: null, clouds: null });
    expect(m.pinned).toEqual([]);
    expect(m.recent).toEqual([]);
    expect(m.groups).toEqual([]);
  });
});

describe('helpers', () => {
  test('rowSlug follows the canvas-row testid rule', () => {
    expect(rowSlug('ui/2026/combine/Combine-kampan.tsx')).toBe('ui-2026-combine-combine-kampan');
  });

  test('managedKey mirrors managed.rs managed_key', () => {
    expect(managedKey('https://nabor.cloud.maude.sh', 'nabor-2027')).toBe(
      'nabor.cloud.maude.sh--nabor-2027'
    );
    expect(managedKey('http://127.0.0.1:8787', 'x y')).toBe('127.0.0.1-8787--x-y');
  });

  test('cloud roles read as people permissions', () => {
    expect(cloudRoleWord('owner')).toBe('Can edit');
    expect(cloudRoleWord('member')).toBe('Can edit');
    expect(cloudRoleWord('viewer')).toBe('Can comment');
    expect(cloudRoleWord('observer')).toBe('Can view');
  });

  test('relative times read like CONTRACT §4', () => {
    const now = new Date(2026, 9, 13, 15, 0).getTime(); // Tue 13 Oct 2026, 15:00
    expect(relativeTime(now - 20_000, now)).toBe('just now');
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe('2 h ago');
    expect(relativeTime(new Date(2026, 9, 12, 9, 0).getTime(), now)).toBe('yesterday');
    expect(relativeTime(new Date(2026, 9, 9, 9, 0).getTime(), now)).toBe('Friday');
    expect(relativeTime(new Date(2026, 8, 6, 9, 0).getTime(), now)).toBe('6 Sep');
    expect(relativeTime(new Date(2025, 8, 6, 9, 0).getTime(), now)).toBe('6 Sep 2025');
  });
});
