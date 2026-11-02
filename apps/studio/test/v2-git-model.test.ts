// S11.10 — Version history › Advanced, the model (06 · ad-history): what the fold shows for which role and
// posture, the branch list, the unsaved rows, +14 −6, the banners — goldens over today's GitPanel fixtures
// (a canvas with its sidecars, a draft and a teammate's branch, a commit log), plus the pins that make the
// retirement honest: every action names a registry id and a route the role matrix refuses for a viewer, the
// registry knows them, and no v1 GitPanel mount is left.
import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import {
  addToSharedLabel,
  branchModel,
  changedLine,
  commitFor,
  GIT_ACTIONS,
  GIT_HINT,
  GIT_WORDS,
  gitSurface,
  lineDiff,
  outcomeBanner,
  publishLabel,
  relativeTime,
  remoteLabel,
  resumeDraft,
  saveState,
  slugifyBranch,
  tid,
  unitCheck,
  unsavedUnits,
  versionRows,
} from '../client/v2/history/git-model.js';

const STUDIO = join(import.meta.dir, '..');
const read = (...p: string[]) => readFileSync(join(STUDIO, ...p), 'utf8');

// today's GitPanel fixtures
const FILES = [
  { path: '.design/ui/Combine.tsx', status: 'modified' },
  { path: '.design/ui/Combine.meta.json', status: 'modified' },
  { path: '.design/ui-combine.annotations.json', status: 'added' },
  { path: '.design/assets/5c1e9a07.svg', status: 'untracked' },
  { path: 'brief.md', status: 'deleted' },
];
const BRANCHES = [
  { name: 'tereza/uniformy-v2', current: false, updatedAt: 300, where: 'local' },
  { name: 'main', current: true, updatedAt: 100, where: 'both' },
  { name: 'jonas/ads', current: false, updatedAt: 200, where: 'remote' },
  { name: 'old-draft', current: false, updatedAt: 50, where: 'local' },
];

describe('what the fold shows (gitSurface)', () => {
  const base = { native: true, cellManaged: false, cloudManaged: false, repo: true };
  test('Can view and Can comment: hidden, and nothing is claimed about the server', () => {
    for (const role of ['view', 'comment'])
      expect(gitSurface({ ...base, role })).toEqual({
        mode: 'hidden',
        canWrite: false,
        history: false,
        note: null,
      });
  });
  test('an editor on the desktop gets the whole fold; a browser tab is awareness only', () => {
    expect(gitSurface({ ...base, role: 'edit' }).mode).toBe('full');
    expect(gitSurface({ ...base, role: 'owner' }).canWrite).toBe(true);
    const web = gitSurface({ ...base, native: false, role: 'edit' });
    expect(web).toMatchObject({ mode: 'read-only', canWrite: false, history: true });
    expect(web.note).toBe(GIT_WORDS.readOnly);
  });
  test('a cloud tab keeps only the versions; a linked desktop repo names who is saving', () => {
    expect(gitSurface({ ...base, role: 'edit', cellManaged: true })).toMatchObject({
      mode: 'cloud',
      canWrite: false,
      history: true,
    });
    const linked = gitSurface({ ...base, role: 'edit', cloudManaged: true });
    expect(linked.mode).toBe('cloud-saving');
    expect(linked.note).toMatch(/Cloud is saving/);
  });
  test('a folder that is not in git says so; the cloud postures win over it', () => {
    expect(gitSurface({ ...base, role: 'edit', repo: false }).mode).toBe('not-versioned');
    expect(gitSurface({ ...base, role: 'edit', repo: false, cellManaged: true }).mode).toBe(
      'cloud'
    );
  });
});

describe('the Branch select (branchModel)', () => {
  test('the shared line first, then drafts newest first, a teammate’s marked as not downloaded', () => {
    const m = branchModel({ branches: BRANCHES, branch: 'main' });
    expect(m.options.map((o) => o.name)).toEqual([
      'main',
      'tereza/uniformy-v2',
      'jonas/ads',
      'old-draft',
    ]);
    expect(m.options.find((o) => o.name === 'jonas/ads')).toMatchObject({
      remoteOnly: true,
      label: `jonas/ads (${GIT_WORDS.fromTeam})`,
    });
    expect(m.shared).toBe('main');
    expect(m.onShared).toBe(true);
    expect(m.options[0]?.current).toBe(true);
  });
  test('on a draft, the draft is current and "drafts" leaves it out; master counts as shared', () => {
    const m = branchModel({ branches: BRANCHES, branch: 'old-draft' });
    expect(m.onShared).toBe(false);
    expect(m.drafts.map((b) => b.name)).not.toContain('old-draft');
    expect(
      branchModel({ branches: [{ name: 'master', current: true }], branch: 'master' }).shared
    ).toBe('master');
  });
  test('the current branch is listed before the list has loaded', () => {
    expect(branchModel({ branches: [], branch: 'feature' }).options.map((o) => o.name)).toEqual([
      'main',
      'feature',
    ]);
  });
  test('Continue: from main, the newest LOCAL draft; never when dismissed, busy, or already on a draft', () => {
    expect(resumeDraft({ branches: BRANCHES, onShared: true })?.name).toBe('tereza/uniformy-v2');
    expect(resumeDraft({ branches: BRANCHES, onShared: true, dismissed: true })).toBeNull();
    expect(resumeDraft({ branches: BRANCHES, onShared: true, busy: 'x' })).toBeNull();
    expect(resumeDraft({ branches: BRANCHES, onShared: false })).toBeNull();
    expect(
      resumeDraft({
        branches: [{ name: 'jonas/ads', where: 'remote', updatedAt: 9 }],
        onShared: true,
      })
    ).toBeNull();
  });
  test('names: a typed branch becomes a slug, the testid slug is stable', () => {
    expect(slugifyBranch('  Nav Redesign!! ')).toBe('nav-redesign');
    expect(tid('tereza/uniformy-v2')).toBe('tereza-uniformy-v2');
  });
});

describe('the button labels', () => {
  test('Publish N versions', () => {
    expect(publishLabel(2)).toBe('Publish 2 versions');
    expect(publishLabel(1)).toBe('Publish 1 version');
    expect(publishLabel(0)).toBe('Publish');
  });
  test('Add to main · opens a pull request only where a GitHub remote makes one', () => {
    expect(addToSharedLabel({ shared: 'main', remote: 'https://github.com/brno/brand.git' })).toBe(
      'Add to main · opens a pull request'
    );
    expect(addToSharedLabel({ shared: 'main', remote: '/srv/git/brand' })).toBe('Add to main');
    expect(addToSharedLabel({ shared: 'master' })).toBe('Add to master…');
  });
  test('the remote reads without scheme, credentials or .git', () => {
    expect(remoteLabel('https://x-access-token:abc@github.com/brno-alligators/brand.git')).toBe(
      'github.com/brno-alligators/brand'
    );
    expect(remoteLabel('git@github.com:brno-alligators/brand.git')).toBe(
      'github.com/brno-alligators/brand'
    );
    expect(remoteLabel('')).toBe('');
  });
  test('Fetch’s "as of"', () => {
    const now = 1_000_000 * 1000;
    expect(relativeTime(1_000_000 - 30, now)).toBe('just now');
    expect(relativeTime(1_000_000 - 600, now)).toBe('10 min ago');
    expect(relativeTime(0, now)).toBe('');
  });
  test('the fold’s hint is the canvas’s', () => {
    expect(GIT_HINT).toBe('Branch, git, changed files');
  });
});

describe('"Not in a version yet" (unsavedUnits)', () => {
  const units = unsavedUnits(FILES, '.design');
  test('a canvas and its sidecars are ONE row; the rest are their own', () => {
    expect(units.map((u) => [u.name, u.kind, u.badge, u.supporting.length])).toEqual([
      ['Combine', 'canvas', 'M', 2],
      ['5c1e9a07', 'other', 'U', 0],
      ['brief.md', 'other', 'D', 0],
    ]);
    expect(units[0]?.paths).toEqual([
      '.design/ui/Combine.tsx',
      '.design/ui/Combine.meta.json',
      '.design/ui-combine.annotations.json',
    ]);
    expect(units[0]?.comparable).toBe(true);
    expect(units[1]?.comparable).toBe(false);
  });
  test('Save needs a note and a file; Save all needs only the note', () => {
    expect(saveState({ message: '', units }).canSave).toBe(false);
    expect(saveState({ message: ' hi ', units }).canSave).toBe(true);
    const none = new Set(units.flatMap((u) => u.paths));
    expect(saveState({ message: 'hi', units, unchecked: none })).toMatchObject({
      canSave: false,
      canSaveAll: true,
    });
    expect(saveState({ message: 'hi', units, busy: 'save' }).canSaveAll).toBe(false);
  });
  test('a unit shows "some" when only part of it is checked', () => {
    const u = units[0] as (typeof units)[number];
    expect(unitCheck(u, new Set())).toBe('all');
    expect(unitCheck(u, new Set([u.paths[1] as string]))).toBe('some');
    expect(unitCheck(u, new Set(u.paths))).toBe('none');
  });
});

describe('"Changed in this version"', () => {
  const before = ['<div>', '  background: var(--gator-ink);', '  gap: 8px;', '</div>'].join('\n');
  const after = [
    '<div>',
    '  background: var(--gator-green);',
    '  --badge: var(--gator-lime);',
    '  gap: 8px;',
    '</div>',
  ].join('\n');
  test('+2 −1 and the changed lines, context left out', () => {
    const d = lineDiff(before, after);
    expect([d.add, d.del]).toEqual([2, 1]);
    expect(d.lines).toEqual([
      { k: '-', t: '  background: var(--gator-ink);' },
      { k: '+', t: '  background: var(--gator-green);' },
      { k: '+', t: '  --badge: var(--gator-lime);' },
    ]);
  });
  test('the first version is A, a later one M', () => {
    expect(changedLine({ path: 'ui/a.tsx', before: null, after: 'x\ny' })).toMatchObject({
      badge: 'A',
      add: 2,
      del: 0,
    });
    expect(changedLine({ path: 'ui/a.tsx', before, after })).toMatchObject({
      badge: 'M',
      add: 2,
      del: 1,
    });
  });
  test('a rewrite past the cap reports its size as approximate', () => {
    const big = Array.from({ length: 1300 }, (_, i) => `a${i}`).join('\n');
    const other = Array.from({ length: 1300 }, (_, i) => `b${i}`).join('\n');
    expect(lineDiff(big, other)).toMatchObject({ approx: true, add: 1300, del: 1300 });
  });
  test('the git id of a version: the oldest commit made at or after it', () => {
    const log = [
      { sha: 'ccc3333', date: '2026-10-18T14:40:00Z' },
      { sha: 'bbb2222', date: '2026-10-18T14:33:00Z' },
      { sha: 'aaa1111', date: '2026-10-18T14:00:00Z' },
    ];
    const madeAt = Date.parse('2026-10-18T14:32:00Z');
    expect(commitFor({ madeAt }, log)?.sha).toBe('bbb2222');
    expect(commitFor({ madeAt: Date.parse('2026-10-18T15:00:00Z') }, log)).toBeNull();
    expect(commitFor(null, log)).toBeNull();
  });
});

describe('versions with their id (versionRows)', () => {
  const now = Date.parse('2026-10-18T15:00:00Z');
  test('a git commit reads author · 7-char id; a project revision reads author · version N', () => {
    const rows = versionRows(
      [
        {
          sha: 'a41f9c2d77e',
          message: 'Post 1:1 greener',
          author: 'Tereza',
          date: '2026-10-18T14:32:00Z',
        },
        {
          sha: 'r12',
          message: 'Edit canvas',
          author: 'Jonas',
          date: '2026-10-18T14:00:00Z',
          accepted: { revision: 12, actionId: 'act-12', mine: true, undo: false },
        },
      ],
      now
    );
    expect(rows[0]).toMatchObject({
      title: 'Post 1:1 greener',
      meta: 'Tereza · a41f9c2',
      when: '28m ago',
    });
    expect(rows[1]).toMatchObject({
      meta: 'Jonas · version 12',
      accepted: { revision: 12, actionId: 'act-12', mine: true, undone: false },
    });
  });
});

describe('the banners (outcomeBanner)', () => {
  test('ok says what was asked, or nothing', () => {
    expect(
      outcomeBanner('save', { ok: true }, { variant: 'success', text: 'Version saved.' })
    ).toEqual({
      variant: 'success',
      text: 'Version saved.',
    });
    expect(outcomeBanner('discard', { ok: true })).toBeNull();
  });
  test('a publish conflict asks for Get latest; a content conflict points at the window that opened', () => {
    expect(outcomeBanner('publish', { conflict: true })).toMatchObject({
      variant: 'warn',
      getLatest: true,
    });
    const content = outcomeBanner('getLatest', { conflict: true });
    expect(content).toMatchObject({ variant: 'info', title: 'You both changed this' });
    expect(content?.getLatest).toBeUndefined();
  });
  test('sign-in, protected branch, anything else', () => {
    expect(outcomeBanner('publish', { authRequired: true })).toMatchObject({
      variant: 'info',
      text: GIT_WORDS.signIn,
    });
    expect(
      outcomeBanner('publish', { error: 'remote: GH006 Protected branch update failed' })
    ).toMatchObject({
      title: 'This branch is protected',
    });
    expect(outcomeBanner('save', { error: 'nothing to commit' })).toEqual({
      variant: 'error',
      text: 'nothing to commit',
    });
    expect(outcomeBanner('save', {})).toMatchObject({
      variant: 'error',
      text: GIT_WORDS.errGeneric,
    });
  });
});

describe('surface = substrate: each button names its registry action and its route', () => {
  const manifest = JSON.parse(read('actions.manifest.json')) as {
    actions: {
      id: string;
      agent?: { path: string };
      minRole?: string;
      server?: { route: string; method: string };
    }[];
  };
  const http = read('http.ts');
  const matrix = read('test', 'access-role-matrix.test.ts');

  test('every action is in the registry, with an agent path', () => {
    const missing = Object.keys(GIT_ACTIONS).filter(
      (id) => !manifest.actions.some((a) => a.id === id)
    );
    expect(missing).toEqual([]);
    for (const [id, a] of Object.entries(GIT_ACTIONS)) {
      const reg = manifest.actions.find((x) => x.id === id);
      expect({ id, agent: !!reg?.agent?.path }).toEqual({ id, agent: true });
      // the registry pins the route the button calls, and who may make the request
      expect({ id, server: reg?.server }).toEqual({
        id,
        server: { route: a.route, method: a.method },
      });
      expect({ id, minRole: reg?.minRole }).toEqual({ id, minRole: a.write ? 'edit' : undefined });
    }
  });

  test('every route is a real one, registered with that method', () => {
    for (const [id, a] of Object.entries(GIT_ACTIONS)) {
      const table = a.route.startsWith('/_api/git/')
        ? http
        : readdirSync(join(STUDIO, 'routes'))
            .filter((f) => f.endsWith('.ts'))
            .map((f) => read('routes', f))
            .join('\n');
      expect({ id, found: table.includes(`'${a.route}'`) }).toEqual({ id, found: true });
    }
  });

  test('the server refuses a viewer on every write (Hidden ≠ refused — the matrix pins it)', () => {
    for (const [id, a] of Object.entries(GIT_ACTIONS)) {
      const re = new RegExp(
        `path: '${a.route.replace(/\//g, '\\/')}',\\s*viewer: '(refused|allowed)'`
      );
      const m = re.exec(matrix);
      expect({ id, row: !!m }).toEqual({ id, row: true });
      expect({ id, viewer: m?.[1] }).toEqual({ id, viewer: a.write ? 'refused' : 'allowed' });
    }
  });

  test('the closed panel names no git: ids, branches and files are the fold’s alone', () => {
    const panel = read('client', 'v2', 'history', 'history-panel.jsx');
    expect(panel).toContain('hint={GIT_HINT}');
    expect(panel).not.toMatch(/Publish|Fetch|New branch/);
  });
});

describe('the v1 Changes / History panel is retired into the fold', () => {
  const walk = (dir: string, out: string[] = []) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) {
        if (name !== 'node_modules' && name !== 'contracts') walk(p, out);
      } else if (/\.(jsx?|tsx?)$/.test(name)) out.push(p);
    }
    return out;
  };
  const files = walk(join(STUDIO, 'client'));

  test('no file mounts or imports GitPanel', () => {
    const offenders = files
      .filter((f) => {
        const t = readFileSync(f, 'utf8');
        return /from\s+['"][^'"]*panels\/GitPanel(\.jsx)?['"]/.test(t) || /<GitPanel[\s/>]/.test(t);
      })
      .map((f) => f.slice(STUDIO.length + 1));
    expect(offenders).toEqual([]);
  });

  test('the project dock is the way to another project only — no branch UI is left in it', () => {
    const dock = read('client', 'panels', 'RepoBranchSwitcher.jsx');
    for (const gone of [
      'switcher-merge',
      'switcher-fetch',
      'switcher-new-branch',
      'branch-row-',
      'git/checkout',
    ])
      expect(dock).not.toContain(gone);
    // P8 C4: the dock is the project pill's "Switch project" submenu now; the trigger id moved with it
    expect(dock).toContain('repo-switcher-trigger');
    expect(dock).toContain('repo-switcher-popup');
  });

  test('every v1 testid of the two retired surfaces is still emitted by the fold', () => {
    const emitted = ['git-advanced.jsx', 'git-parts.jsx']
      .map((f) => read('client', 'v2', 'history', f))
      .join('\n');
    const kept = [
      'git-panel',
      'git-panel-repo',
      'git-compare',
      'git-discard',
      'git-publish',
      'git-get-latest',
      'git-commit-message',
      'git-save-all',
      'git-cloud-managed',
      'git-history-unreachable',
      'git-history-retry',
      'project-history-row-',
      'project-history-preview-',
      'project-history-restore-',
      'project-history-undo-',
      'switcher-resume',
      'switcher-resume-dismiss',
      'switcher-merge',
      'switcher-merge-confirm',
      'switcher-fetch',
      'switcher-new-branch',
      'switcher-new-branch-input',
      'switcher-new-branch-create',
      'switcher-chat-guard',
      'switcher-chat-guard-cancel',
      'switcher-chat-guard-confirm',
      'switcher-pr-link',
      'switcher-pr-dismiss',
      'branch-row-',
    ];
    expect(kept.filter((id) => !emitted.includes(`${id}`))).toEqual([]);
  });
});
