// V2-2.4b — `maude design comments list [--open|--mine|--all] [<canvas>]` (contract V2-1.11 §5.3).
// Read-only (effect none → auto). Reply / resolve / add under AI authorship are S9's (shared →
// prompt) and are NOT here: the verb refuses every other sub-verb.

import { afterEach, describe, expect, test } from 'bun:test';

import { fakeStudio, json, type Seen } from './_fake-studio.ts';

const c = (
  id: string,
  author: string,
  status: 'open' | 'resolved',
  text: string,
  file: string
) => ({
  id,
  file,
  author,
  status,
  text,
  created: '2026-10-10T10:00:00.000Z',
  resolved_at: null,
  thread: [{ author: 'Bo', body: 'agreed' }],
  mentions: [],
});
const HOME = '.design/ui/home.tsx';
const ALL = {
  [HOME]: [
    c('c1', 'Ada', 'open', 'Tighten the hero', HOME),
    c('c2', 'Bo', 'resolved', 'Old note', HOME),
    c('c3', 'Bo', 'open', 'line one\u001b]0;pwned\u0007', HOME),
  ],
  '.design/ui/about.tsx': [c('c4', 'Ada', 'resolved', 'Done', '.design/ui/about.tsx')],
};

const handler = (s: Seen) => {
  if (s.path === '/_comments-all') return json(ALL);
  if (s.path === '/_comments')
    return json({ file: s.query.file, comments: ALL[s.query.file as keyof typeof ALL] ?? [] });
  if (s.path === '/_api/git-user') return json({ name: 'Ada' });
};

let studio: ReturnType<typeof fakeStudio> | null = null;
afterEach(() => {
  studio?.stop();
  studio = null;
});
const ids = (stdout: string) =>
  (JSON.parse(stdout).comments as { id: string }[]).map((x) => x.id).sort();

describe('maude design comments list', () => {
  test('default: open threads across the project', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('comments', ['list', '--json']);
    expect(r.code).toBe(0);
    expect(ids(r.stdout)).toEqual(['c1', 'c3']);
    expect(studio.seen.map((s) => s.path)).toEqual(['/_comments-all']);
  });

  test('--all includes resolved; a canvas scopes to its file', async () => {
    studio = fakeStudio(handler);
    expect(ids((await studio.run('comments', ['list', '--all', '--json'])).stdout)).toEqual([
      'c1',
      'c2',
      'c3',
      'c4',
    ]);
    const r = await studio.run('comments', ['list', 'ui/home.tsx', '--all', '--json']);
    expect(ids(r.stdout)).toEqual(['c1', 'c2', 'c3']);
    expect(studio.seen.at(-1)?.query.file).toBe(HOME);
  });

  test('--mine keeps the comments this user wrote (the studio’s git-user name)', async () => {
    studio = fakeStudio(handler);
    expect(
      ids((await studio.run('comments', ['list', '--mine', '--all', '--json'])).stdout)
    ).toEqual(['c1', 'c4']);
    expect(ids((await studio.run('comments', ['list', '--mine', '--json'])).stdout)).toEqual([
      'c1',
    ]);
  });

  test('text output names file, author, status and thread size; peer text is stripped of control characters', async () => {
    studio = fakeStudio(handler);
    const r = await studio.run('comments', ['list']);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('ui/home.tsx');
    expect(r.stdout).toContain('Tighten the hero');
    expect(r.stdout).toContain('1 repl');
    const control = [...r.stdout].filter((ch) => {
      const n = ch.charCodeAt(0);
      return (n < 32 && n !== 10) || (n >= 127 && n < 160);
    });
    expect(control).toEqual([]);
  });

  test('read-only: no other sub-verb, no write flag, no request on a usage error', async () => {
    studio = fakeStudio(handler);
    for (const args of [
      ['reply', 'c1', 'hi'],
      ['resolve', 'c1'],
      ['add', '--as-ai'],
      ['list', '--resolve'],
      ['list', 'a.tsx', 'b.tsx'],
      ['list', '--open', '--all'],
      [],
    ]) {
      const r = await studio.run('comments', args);
      expect({ args, code: r.code }).toEqual({ args, code: 2 });
    }
    expect(studio.seen).toEqual([]);
    expect((await studio.run('comments', ['--help'])).code).toBe(0);
    expect(studio.seen.filter((s) => s.method !== 'GET')).toEqual([]);
  });
});
