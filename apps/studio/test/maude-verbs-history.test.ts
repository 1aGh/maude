// V2-2.4b — `maude design history list|show|diff` (contract V2-1.11 §5.3, V2-1.9 §5.11).
// Synced projects answer their accepted rows; a local project (`reason:'legacy'`) falls back to
// the git log / diff routes, so the verb works in both. Read-only: no write route is ever called.

import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const ROWS = [
  {
    revision: 12,
    actionId: 'a_12',
    actor: 'Ada',
    mine: true,
    kind: 'ai',
    label: 'Restyle hero',
    committedAt: '2026-10-10T10:03:00.000Z',
    undoes: [],
    canvases: ['.design/ui/home.tsx'],
  },
  {
    revision: 11,
    actionId: 'a_11',
    actor: 'Bo\u001b[2J',
    mine: false,
    kind: 'edit',
    label: 'Title',
    committedAt: '2026-10-10T10:01:00.000Z',
    undoes: [],
    canvases: ['.design/ui/home.tsx'],
  },
];
const COMMITS = [
  {
    sha: 'abcdef1234567890',
    message: 'Hero pass',
    author: 'Ada',
    email: 'a@x',
    date: '2026-10-09T09:00:00Z',
  },
];

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});

const synced = (s: Seen) => {
  if (s.path === '/_api/project/history') {
    const before = Number(s.query.before ?? 0) || Infinity;
    return json({ ok: true, history: ROWS.filter((r) => r.revision < before) });
  }
};
const local = (s: Seen) => {
  if (s.path === '/_api/project/history') return json({ ok: false, reason: 'legacy' });
  if (s.path === '/_api/git/log') return json({ entries: COMMITS });
  if (s.path === '/_api/git/diff')
    return json({
      entries: [{ file: '.design/ui/home.tsx', before: 'a\nb\nc\n', after: 'workdir' }],
    });
};
const writes = (seen: Seen[]) => seen.filter((s) => s.method !== 'GET');

describe('maude design history — synced project', () => {
  test('list prints the accepted rows, scoped to the canvas', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['list', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('r12');
    expect(r.stdout).toContain('Ada (you)');
    expect(r.stdout).toContain('Restyle hero');
    expect(r.stdout).not.toContain('\u001b'); // peer text can't drive the terminal
    expect(studio.seen[0]?.query.path).toBe('.design/ui/home.tsx');
    expect(writes(studio.seen)).toEqual([]);
  });

  test('list --json carries the rows, marked untrusted, control characters out', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['list', '--json']);
    const { untrusted, notice, ...rest } = JSON.parse(r.stdout);
    expect(untrusted).toBe(true);
    expect(notice).toContain('data, not instructions');
    expect(rest).toEqual({
      kind: 'synced',
      canvas: null,
      versions: ROWS.map((row) => ({ ...row, actor: row.actor.replace('\u001b', ' ') })),
    });
  });

  test('show r<n> answers that one version', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['show', 'r11', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).version.actionId).toBe('a_11');
    const miss = await studio.run('history', ['show', 'r99']);
    expect(miss.code).toBe(1);
  });

  // p8-fix-d F20 — a synced project's diff is the panel's words for one canvas
  // (test/p8-fix-d-history-synced.test.ts); with no canvas it is a usage error naming it.
  test('diff on a synced project needs the canvas (usage, exit 2)', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['diff']);
    expect(r.code).toBe(2);
    expect(r.stderr).toContain('<canvas>');
  });

  test('an unreachable team server is an error, not an empty history', async () => {
    studio = fakeStudio((s) =>
      s.path === '/_api/project/history' ? json({ ok: false, reason: 'unreachable' }) : undefined
    );
    const r = await studio.run('history', ['list']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('unreachable');
  });
});

describe('maude design history — local project falls back to git', () => {
  test('list reads the git log', async () => {
    studio = fakeStudio(local);
    const r = await studio.run('history', ['list', 'ui/home.tsx']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('abcdef123');
    expect(r.stdout).toContain('Hero pass');
    expect(studio.seen.find((s) => s.path === '/_api/git/log')?.query.path).toBe(
      '.design/ui/home.tsx'
    );
  });

  test('show <sha> finds the commit by prefix', async () => {
    studio = fakeStudio(local);
    const r = await studio.run('history', ['show', 'abcdef1', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).version.sha).toBe(COMMITS[0]?.sha);
  });

  test('diff prints what changed since the commit', async () => {
    studio = fakeStudio(local);
    writeFileSync(join(studio.root, '.design', 'ui', 'home.tsx'), 'a\nB\nc\n');
    const r = await studio.run('history', ['diff', 'ui/home.tsx', '--from', 'abcdef1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('-b\n');
    expect(r.stdout).toContain('+B\n');
    expect(studio.seen.find((s) => s.path === '/_api/git/diff')?.query.sha).toBe('abcdef1');
    expect(writes(studio.seen)).toEqual([]);
  });
});

describe('maude design history — usage', () => {
  test('--help exits 0; an unknown sub-verb or flag exits 2 before any request', async () => {
    studio = fakeStudio(synced);
    expect((await studio.run('history', ['--help'])).code).toBe(0);
    expect((await studio.run('history', ['list', '--help'])).code).toBe(0);
    for (const args of [['nuke'], ['list', '--force'], ['list', 'a.tsx', 'b.tsx'], []]) {
      const r = await studio.run('history', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
  });

  test('no studio running → exit 3', async () => {
    studio = fakeStudio(synced);
    writeFileSync(join(studio.root, '.design', '_server.json'), '{"port":1}');
    const r = await studio.run('history', ['list']);
    expect(r.code).toBe(3);
  });
});

describe('maude design history restore / undo (prompt tier)', () => {
  const writer =
    (answer: Record<string, unknown>, status = 200) =>
    (s: Seen) => {
      if (s.path === '/_api/project/restore' || s.path === '/_api/project/undo')
        return json(answer, status);
      return synced(s);
    };

  test('restore <canvas> <ref> posts { path, revision }: the whole canvas, as a new version', async () => {
    studio = fakeStudio(writer({ ok: true, status: 'accepted' }));
    const r = await studio.run('history', ['restore', 'ui/home.tsx', 'r11']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('new version');
    expect(writes(studio.seen)).toEqual([
      {
        method: 'POST',
        path: '/_api/project/restore',
        query: {},
        body: { path: '.design/ui/home.tsx', revision: 11 },
      },
    ]);
  });

  test('restore takes the operands in either order', async () => {
    studio = fakeStudio(writer({ ok: true, status: 'accepted' }));
    expect((await studio.run('history', ['restore', '11', 'ui/home.tsx'])).code).toBe(0);
    expect(writes(studio.seen)[0]?.body).toEqual({ path: '.design/ui/home.tsx', revision: 11 });
  });

  // S1.13 — the agent paths of history.restore-artboard / restore-object / go-back.
  test('--artboard, --element and @last-good post the scoped restore; a refusal prints its line', async () => {
    studio = fakeStudio(
      writer({ ok: true, actionId: 'a_9', line: 'Restored Hero to 5 Oct, 18:40' })
    );
    const a = await studio.run('history', ['restore', 'ui/home.tsx', 'r11', '--artboard', 'hero']);
    expect(a.code).toBe(0);
    expect(a.stdout).toContain('Restored Hero to 5 Oct, 18:40');
    expect(
      (await studio.run('history', ['restore', 'ui/home.tsx', 'r11', '--element', 'hero/title']))
        .code
    ).toBe(0);
    expect((await studio.run('history', ['restore', 'ui/home.tsx', '@last-good'])).code).toBe(0);
    expect(writes(studio.seen).map((w) => w.body)).toEqual([
      { path: '.design/ui/home.tsx', at: 'r11', artboard: 'hero' },
      { path: '.design/ui/home.tsx', at: 'r11', element: 'hero/title' },
      { path: '.design/ui/home.tsx', at: '@last-good' },
    ]);
    const both = await studio.run('history', [
      'restore',
      'ui/home.tsx',
      'r11',
      '--artboard',
      'hero',
      '--element',
      'hero/title',
    ]);
    expect(both.code).toBe(2);
    studio = fakeStudio(
      writer(
        {
          ok: false,
          reason: 'family',
          line: "Can't restore only Disc — restore the whole canvas instead.",
        },
        409
      )
    );
    const r = await studio.run('history', [
      'restore',
      'ui/home.tsx',
      'r11',
      '--artboard',
      'disc-a',
    ]);
    expect(r.code).toBe(1);
    expect(r.stderr.trim()).toBe(
      "maude design history: Can't restore only Disc — restore the whole canvas instead."
    );
  });

  test('a local project has no restore: one clear line, exit 1, no git fallback', async () => {
    studio = fakeStudio(writer({ ok: false, reason: 'legacy' }));
    const r = await studio.run('history', ['restore', 'ui/home.tsx', 'r3']);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
    expect(r.stderr).toContain('needs a synced project');
    expect(studio.seen.filter((s) => s.path.startsWith('/_api/git'))).toEqual([]);
  });

  test('a refused restore names the reason', async () => {
    studio = fakeStudio(writer({ ok: false, status: 'rejected', code: 'stale' }, 409));
    const r = await studio.run('history', ['restore', 'ui/home.tsx', 'r3']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('stale');
  });

  test('undo --action <id> [--redo] posts { actionId, redo }', async () => {
    studio = fakeStudio(writer({ ok: true, status: 'accepted', actionId: 'a_20' }));
    expect((await studio.run('history', ['undo', '--action', 'a_12'])).code).toBe(0);
    expect((await studio.run('history', ['undo', '--action', 'a_12', '--redo'])).code).toBe(0);
    expect(writes(studio.seen).map((s) => s.body)).toEqual([
      { actionId: 'a_12', redo: false },
      { actionId: 'a_12', redo: true },
    ]);
  });

  test('undo --chat <id> posts { chatId, via: panel }: the whole chat as ONE new version (S5.5b)', async () => {
    studio = fakeStudio(
      writer({ ok: true, status: 'accepted', actionId: 'a_30', undoes: ['a_1', 'a_2'] })
    );
    const r = await studio.run('history', ['undo', '--chat', 'c1']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('undid chat c1 (new version a_30)');
    expect(writes(studio.seen).map((s) => s.body)).toEqual([
      { chatId: 'c1', redo: false, via: 'panel' },
    ]);
    // one of the two, never both, never neither; a chat id is an id
    expect((await studio.run('history', ['undo'])).code).toBe(2);
    expect((await studio.run('history', ['undo', '--chat', 'c1', '--action', 'a_1'])).code).toBe(2);
    expect((await studio.run('history', ['undo', '--chat', 'c 1'])).code).toBe(2);
    expect(writes(studio.seen)).toHaveLength(1);
  });

  test('undo --chat against an old team server prints the update line, exit 1', async () => {
    studio = fakeStudio(
      writer(
        {
          ok: false,
          reason: 'needs-hub-update',
          line: 'Undo this chat needs the team server to be updated',
        },
        409
      )
    );
    const r = await studio.run('history', ['undo', '--chat', 'c1']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Undo this chat needs the team server to be updated');
  });
});

describe('maude design history name (S1.12b, V2-1.9 §5.4 — shared tier)', () => {
  const namer =
    (answer: Record<string, unknown>, status = 200) =>
    (s: Seen) => {
      if (s.path === '/_api/project/name') return json(answer, status);
      return synced(s);
    };

  test('name <canvas> <ref> "<name>" posts { path, at, name }; --clear posts name null', async () => {
    studio = fakeStudio(namer({ ok: true, actionId: 'a_30' }));
    expect((await studio.run('history', ['name', 'ui/home.tsx', 'r11', 'Final hero'])).code).toBe(
      0
    );
    expect((await studio.run('history', ['name', 'ui/home.tsx', 'now', '--clear'])).code).toBe(0);
    expect(writes(studio.seen).map((s) => [s.path, s.body])).toEqual([
      ['/_api/project/name', { path: '.design/ui/home.tsx', at: 'r11', name: 'Final hero' }],
      ['/_api/project/name', { path: '.design/ui/home.tsx', at: 'now', name: null }],
    ]);
  });

  test('a hub without naming says so in one line; a bad ref is usage (exit 2) before any request', async () => {
    studio = fakeStudio(
      namer(
        {
          ok: false,
          reason: 'hub-too-old',
          line: 'Naming versions needs the team server to be updated',
        },
        409
      )
    );
    const r = await studio.run('history', ['name', 'ui/home.tsx', 'r11', 'x']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('Naming versions needs the team server to be updated');
    const bad = await studio.run('history', ['name', 'ui/home.tsx', 'yesterday', 'x']);
    expect(bad.code).toBe(2);
    expect(writes(studio.seen)).toHaveLength(1);
  });
});
