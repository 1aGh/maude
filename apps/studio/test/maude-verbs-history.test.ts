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

  test('list --json carries the rows verbatim', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['list', '--json']);
    expect(JSON.parse(r.stdout)).toEqual({ kind: 'synced', canvas: null, versions: ROWS });
  });

  test('show r<n> answers that one version', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['show', 'r11', '--json']);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout).version.actionId).toBe('a_11');
    const miss = await studio.run('history', ['show', 'r99']);
    expect(miss.code).toBe(1);
  });

  test('diff says it is not available for a synced project (exit 1, one line)', async () => {
    studio = fakeStudio(synced);
    const r = await studio.run('history', ['diff']);
    expect(r.code).toBe(1);
    expect(r.stderr.trim().split('\n')).toHaveLength(1);
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
