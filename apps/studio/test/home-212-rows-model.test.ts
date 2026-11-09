// 2.1.2 Home declutter (plan feature-home-declutter-2.1.2, H1 audit #3 + #5, canvas 17 artboards
// 15/16/19) — the Projects list as the page draws it: one flat list (live rows by last use, then the
// Maude Cloud projects not on this Mac, then the folders that moved), each row slim — where it lives
// in one word, a state only when it isn't fine, a quiet last-opened time — and a gone managed copy
// folded into its live twin instead of an "isn't where it was" row of its own.

import { describe, expect, test } from 'bun:test';

import { buildHomeModel, managedKey } from '../client/home/home-model.js';

const APP = '/Users/x/Library/Application Support/com.maude.app/projects';
const CLOUD = 'https://cloud.maude.sh';
const TEAM = 'https://design.example.com';

const okIx = (pid: string, root: string, extra: Record<string, unknown> = {}) => ({
  pid,
  state: 'ok',
  stale: false,
  designReal: `${root}/.design`,
  project: {
    root,
    name: root.split('/').pop(),
    label: null,
    formatVersion: 2,
    linkedHub: null,
    managed: false,
  },
  counts: { canvases: 2, artboards: 3, byKind: {} },
  canvases: [],
  ...extra,
});
const goneIx = (pid: string) => ({ pid, state: 'gone', stale: false });
const proj = (pid: string, root: string, extra: Record<string, unknown> = {}) => ({
  pid,
  root,
  name: root.split('/').pop(),
  profile: 'default',
  place: 'closed',
  focused: false,
  ...extra,
});

type Input = Parameters<typeof buildHomeModel>[0];
const build = (i: Record<string, unknown>) =>
  buildHomeModel({ cloudUrl: CLOUD, ...i } as unknown as Input);
const pids = (m: ReturnType<typeof buildHomeModel>) =>
  m.projects.map((r: { pid: string | null; projectId?: string }) => r.pid ?? r.projectId);

// The keeper's Home (H1 #4): the StudyFi folder links design.studyfi.com; the app's copy of that
// project (`design.studyfi.com--local`) is gone from disk.
function studyfi() {
  const hub = 'https://design.studyfi.example';
  const copyRoot = `${APP}/${managedKey(hub, 'local')}`;
  return {
    shell: {
      projects: [
        proj('l00000000000000a1', '/Users/x/git/studyfi-design', { name: 'StudyFi' }),
        proj('l00000000000000a2', copyRoot, { name: 'design.studyfi.example', hub }),
      ],
      profiles: [{ id: 'default', label: 'Personal' }],
      recent: ['l00000000000000a1', 'l00000000000000a2'],
    },
    index: {
      v: 1,
      projects: [
        okIx('l00000000000000a1', '/Users/x/git/studyfi-design', {
          project: {
            root: '/Users/x/git/studyfi-design',
            name: 'StudyFi',
            label: null,
            formatVersion: 2,
            linkedHub: { url: hub },
            managed: false,
          },
        }),
        goneIx('l00000000000000a2'),
      ],
    },
    hub,
    copyRoot,
  };
}

describe('2.1.2 — a gone managed copy folds into its live twin (H1 #3)', () => {
  test('the folder that links the same hub keeps the row; no "isn’t where it was" row', () => {
    const f = studyfi();
    const m = build(f);
    expect(pids(m)).toEqual(['l00000000000000a1']);
    expect(m.projects.some((r: { status: string }) => r.status === 'gone')).toBe(false);
    expect(m.projectCount).toBe(1);
  });

  test('a live copy of the same project id hides the gone one', () => {
    const f = studyfi();
    const live = `${APP}/work@${managedKey(f.hub, 'local')}`;
    f.shell.projects = [
      f.shell.projects[1],
      proj('l00000000000000a3', live, { name: 'StudyFi', hub: f.hub }),
    ];
    f.index.projects = [goneIx('l00000000000000a2'), okIx('l00000000000000a3', live)];
    f.shell.recent = ['l00000000000000a3'];
    expect(pids(build(f))).toEqual(['l00000000000000a3']);
  });

  test('another profile’s copy, or a hub whose project cannot be told, never folds', () => {
    const f = studyfi();
    (f.shell.projects[1] as { profile: string }).profile = 'work';
    expect(pids(build(f))).toEqual(['l00000000000000a1', 'l00000000000000a2']);

    // two projects on one team server + one folder linked to it: whose copy is gone is unknown
    const g = studyfi();
    g.shell.projects.push(
      proj('l00000000000000a4', `${APP}/${managedKey(g.hub, 'other')}`, { hub: g.hub })
    );
    g.index.projects.push(goneIx('l00000000000000a4'));
    const ids = pids(build(g));
    expect(ids).toContain('l00000000000000a2');
    expect(ids).toContain('l00000000000000a4');
  });

  test('a lone orphan shows ONCE, after the live rows, carrying every pid it stands for', () => {
    const f = studyfi();
    f.shell.projects = f.shell.projects.filter((p) => p.pid !== 'l00000000000000a1');
    f.index.projects = f.index.projects.filter((p) => p.pid !== 'l00000000000000a1');
    // a second registry entry for the same copy (profile-prefixed folder name), also gone
    f.shell.projects.push(
      proj('l00000000000000a5', `${APP}/default@${managedKey(f.hub, 'local')}`, { hub: f.hub })
    );
    f.index.projects.push(goneIx('l00000000000000a5'));
    f.shell.projects.push(proj('l00000000000000a6', '/Users/x/Design/live'));
    f.index.projects.push(okIx('l00000000000000a6', '/Users/x/Design/live'));
    const m = build(f);
    expect(pids(m)).toEqual(['l00000000000000a6', 'l00000000000000a2']);
    const orphan = m.projects[1] as { status: string; pids: string[] };
    expect(orphan.status).toBe('gone');
    expect(orphan.pids.sort()).toEqual(['l00000000000000a2', 'l00000000000000a5']);
  });
});

describe('2.1.2 — one flat list of slim rows (artboards 15/16/19)', () => {
  function world(twoClouds = false) {
    const shell = {
      projects: [
        proj('l0000000000000b01', '/Users/x/Design/logo', { name: 'Logo ideas', lastOpenedAt: 50 }),
        proj('l0000000000000b02', `${APP}/${managedKey('https://brand.cloud.maude.sh', 'brand')}`, {
          name: 'Brand site',
          place: 'tab',
          ai: { running: 1, awaiting: 0 },
          hub: 'https://brand.cloud.maude.sh',
          profile: 'default',
        }),
        proj('l0000000000000b03', '/Users/x/git/website', {
          name: 'Website 2027',
          profile: 'work',
          place: 'resting',
        }),
        proj('l0000000000000b04', '/Users/x/Design/moved', { name: 'Landing 2025' }),
      ],
      profiles: [
        { id: 'default', label: 'Personal', email: 'alice@example.com' },
        { id: 'work', label: 'Work', email: 'hana@example.com' },
      ],
      recent: ['l0000000000000b02', 'l0000000000000b03', 'l0000000000000b01', 'l0000000000000b04'],
    };
    const index = {
      v: 1,
      projects: [
        okIx('l0000000000000b01', '/Users/x/Design/logo', {
          canvases: [
            { rel: 'a.tsx', name: 'a', openedAt: 10, pinnedAt: null },
            { rel: 'b.tsx', name: 'b', openedAt: 90, pinnedAt: null },
          ],
        }),
        okIx('l0000000000000b02', shell.projects[1].root),
        okIx('l0000000000000b03', '/Users/x/git/website', {
          project: {
            root: '/Users/x/git/website',
            name: 'Website 2027',
            label: null,
            formatVersion: 2,
            linkedHub: { url: TEAM },
            managed: false,
          },
          canvases: [{ rel: 'w.tsx', name: 'w', openedAt: 70, pinnedAt: null }],
        }),
        goneIx('l0000000000000b04'),
      ],
    };
    const clouds = [
      {
        ok: true,
        profile: 'default',
        signedIn: true,
        account: { email: 'alice@example.com' },
        projects: [
          {
            id: 'winter',
            name: 'Winter catalogue',
            role: 'owner',
            url: 'https://winter.cloud.maude.sh',
            updatedAt: 1,
          },
        ],
        shared: [],
      },
      ...(twoClouds
        ? [
            {
              ok: true,
              profile: 'work',
              signedIn: true,
              account: { email: 'hana@example.com' },
              projects: [],
              shared: [],
            },
          ]
        : []),
    ];
    const hubStates = { work: { [TEAM]: 'rejected' } };
    return { shell, index, clouds, hubStates };
  }

  test('live rows by last use, then the cloud projects not on this Mac, then the moved folder', () => {
    const m = build(world());
    expect(pids(m)).toEqual([
      'l0000000000000b02',
      'l0000000000000b03',
      'l0000000000000b01',
      'winter',
      'l0000000000000b04',
    ]);
  });

  test('where a row lives is one word: Maude Cloud · the host · Your folder · Kept by Maude', () => {
    const m = build(world());
    const by = (id: string) =>
      m.projects.find(
        (r: { pid: string | null; projectId?: string }) => (r.pid ?? r.projectId) === id
      );
    expect(by('l0000000000000b02').lives).toEqual({
      kind: 'cloud',
      word: 'Maude Cloud',
      face: null,
    });
    expect(by('l0000000000000b03').lives).toEqual({
      kind: 'server',
      word: 'design.example.com',
      face: null,
    });
    expect(by('l0000000000000b01').lives).toEqual({
      kind: 'folder',
      word: 'Your folder',
      face: null,
    });
    expect(by('winter').lives).toEqual({ kind: 'cloud', word: 'Maude Cloud', face: null });
  });

  test('an account face shows only when this Mac has two Maude Cloud accounts', () => {
    const m = build(world(true));
    const brand = m.projects.find((r: { pid: string | null }) => r.pid === 'l0000000000000b02');
    expect(brand.lives.face).toEqual(expect.objectContaining({ initial: 'A' }));
    const server = m.projects.find((r: { pid: string | null }) => r.pid === 'l0000000000000b03');
    expect(server.lives.face).toBeNull();
  });

  test('a state only when it isn’t fine: AI working · Needs you · a broken sign-in · not on this Mac yet', () => {
    const w = world();
    const m = build(w);
    const flag = (id: string) =>
      m.projects.find(
        (r: { pid: string | null; projectId?: string }) => (r.pid ?? r.projectId) === id
      ).flag;
    expect(flag('l0000000000000b02')).toEqual({ kind: 'ai', word: 'AI working' });
    expect(flag('l0000000000000b03')).toEqual({ kind: 'signin', word: 'Sign-in stopped working' });
    expect(flag('l0000000000000b01')).toBeNull();
    expect(flag('winter')).toEqual({ kind: 'away', word: 'Not on this Mac yet' });

    // Needs you wins over AI working; a working sign-in, Resting or Offline say nothing
    w.shell.projects[1].ai = { running: 1, awaiting: 1 };
    w.hubStates = { work: { [TEAM]: 'ok' } };
    const n = build(w);
    expect(n.projects[0].flag).toEqual({ kind: 'needs', word: 'Needs you' });
    expect(n.projects[1].flag).toBeNull();
  });

  test('last opened: the registry’s time, else the newest canvas opened', () => {
    const m = build(world());
    const at = (id: string) =>
      m.projects.find((r: { pid: string | null }) => r.pid === id).lastOpenedAt;
    expect(at('l0000000000000b01')).toBe(50);
    expect(at('l0000000000000b03')).toBe(70);
    expect(at('l0000000000000b02')).toBeNull();
  });
});

describe('2.1.2 — Pinned joined Recent canvases', () => {
  test('the cards are the pinned ones first (newest pin), then the opened ones; the filter narrows both', () => {
    const shell = {
      projects: [proj('l0000000000000c01', '/Users/x/a'), proj('l0000000000000c02', '/Users/x/b')],
      profiles: [],
      recent: [],
    };
    const index = {
      v: 1,
      projects: [
        okIx('l0000000000000c01', '/Users/x/a', {
          canvases: [
            { rel: 'p1.tsx', name: 'p1', openedAt: null, pinnedAt: 5 },
            { rel: 'o1.tsx', name: 'o1', openedAt: 40, pinnedAt: null },
          ],
        }),
        okIx('l0000000000000c02', '/Users/x/b', {
          canvases: [
            { rel: 'p2.tsx', name: 'p2', openedAt: 99, pinnedAt: 9 },
            { rel: 'o2.tsx', name: 'o2', openedAt: 60, pinnedAt: null },
          ],
        }),
      ],
    };
    const m = build({ shell, index });
    expect(m.cards.map((c: { name: string }) => c.name)).toEqual(['p2', 'p1', 'o2', 'o1']);
    const f = build({ shell, index, filterPid: 'l0000000000000c01' });
    expect(f.cards.map((c: { name: string }) => c.name)).toEqual(['p1', 'o1']);
  });
});
