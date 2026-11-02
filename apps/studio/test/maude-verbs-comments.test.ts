// V2-2.4b — `maude design comments list [--open|--mine|--all] [<canvas>]` (contract V2-1.11 §5.3).
// `list` is read-only (effect none → auto). S9.7b: reply / resolve / reopen / add --as-ai post
// through `POST /_api/comments/op` (shared → prompt) — the second describe below.

import { afterEach, describe, expect, test } from 'bun:test';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

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

  test('--resolved lists the resolved threads only (S9.22: the panel’s Resolved filter)', async () => {
    studio = fakeStudio(handler);
    expect(ids((await studio.run('comments', ['list', '--resolved', '--json'])).stdout)).toEqual([
      'c2',
      'c4',
    ]);
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

  test('list stays read-only: no write flag, no request on a usage error', async () => {
    studio = fakeStudio(handler);
    for (const args of [
      ['reply', 'c1', 'hi'],
      ['reply', 'c1'],
      ['resolve'],
      ['resolve', 'c1', 'c2'],
      ['resolve', '../x'],
      ['add', 'ui/home.tsx', '--text', 'x'],
      ['add', '--as-ai', 'ui/home.tsx'],
      ['add', '--as-ai', 'ui/home.tsx', '--text', 'x', '--t', '2'],
      ['add', '--as-ai', 'ui/home.tsx', '--text', 'x', '--author', 'Mallory'],
      ['delete-own', 'c1'],
      ['list', '--resolve'],
      ['list', 'a.tsx', 'b.tsx'],
      ['list', '--open', '--all'],
      ['list', '--resolved', '--all'],
      ['list', '--resolved', '--open'],
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

// S9.7b — the write sub-verbs: one `POST /_api/comments/op` each, always `as: 'ai'`, never an
// author (the studio stamps its session's). Effect shared → prompt (verbs.ts).
describe('maude design comments reply | resolve | reopen | add --as-ai', () => {
  let n = 0;
  const opHandler = (s: Seen) => {
    if (s.path !== '/_api/comments/op' || s.method !== 'POST') return handler(s);
    const b = s.body as { op: string; id?: string };
    if (b.id === 'c_gone') return json({ error: 'not-in-scope', reason: 'not-in-scope' }, 403);
    const id = b.op === 'add' ? `c_new${++n}` : b.id;
    return json({ id, comment: { id, text: 'someone else’s words \u001b]0;x\u0007' } });
  };
  const ops = (s: ReturnType<typeof fakeStudio>) =>
    s.seen.filter((x) => x.path === '/_api/comments/op').map((x) => x.body);

  test('reply / resolve / reopen post one op by id, as the AI; output is the id only', async () => {
    studio = fakeStudio(opHandler);
    const reply = await studio.run('comments', ['reply', 'c1', '--text', ' Fixed in v2 ']);
    expect([reply.code, reply.stdout]).toEqual([0, 'Replied to c1.\n']);
    expect((await studio.run('comments', ['resolve', 'c1'])).stdout).toBe('Resolved c1.\n');
    expect((await studio.run('comments', ['reopen', 'c1', '--json'])).stdout).toBe(
      `${JSON.stringify({ ok: true, ids: ['c1'] })}\n`
    );
    expect(ops(studio)).toEqual([
      { op: 'reply', id: 'c1', body: 'Fixed in v2', as: 'ai' },
      { op: 'resolve', id: 'c1', as: 'ai' },
      { op: 'reopen', id: 'c1', as: 'ai' },
    ]);
  });

  test('add --as-ai --text carries the canvas and the artboard / t / mm anchors', async () => {
    n = 0;
    studio = fakeStudio(opHandler);
    const r = await studio.run('comments', [
      'add',
      '--as-ai',
      'ui/home.tsx',
      '--text',
      'Contrast 3.1:1',
      '--artboard',
      'hero',
      '--t',
      '1.5',
      '--mm',
      '3,4',
    ]);
    expect([r.code, r.stdout]).toEqual([0, 'Added c_new1 on ui/home.tsx.\n']);
    expect(ops(studio)).toEqual([
      {
        op: 'add',
        file: HOME,
        text: 'Contrast 3.1:1',
        artboard: 'hero',
        t: 1.5,
        mm: { x: 3, y: 4 },
        as: 'ai',
      },
    ]);
  });

  test('add --as-ai --findings posts one comment per finding (a critic round in one call)', async () => {
    n = 0;
    studio = fakeStudio(opHandler);
    const file = join(studio.root, 'findings.json');
    writeFileSync(
      file,
      JSON.stringify({
        findings: [{ text: 'Too tight', artboard: 'hero' }, { text: 'Low contrast' }],
      })
    );
    const r = await studio.run('comments', [
      'add',
      '--as-ai',
      'ui/home.tsx',
      '--findings',
      file,
      '--json',
    ]);
    expect(r.code).toBe(0);
    expect(JSON.parse(r.stdout)).toEqual({ ok: true, ids: ['c_new1', 'c_new2'] });
    expect(ops(studio)).toEqual([
      { op: 'add', file: HOME, text: 'Too tight', artboard: 'hero', as: 'ai' },
      { op: 'add', file: HOME, text: 'Low contrast', as: 'ai' },
    ]);
    writeFileSync(file, JSON.stringify([{ text: 'x', t: 2 }]));
    expect(
      (await studio.run('comments', ['add', '--as-ai', 'ui/home.tsx', '--findings', file])).code
    ).toBe(2);
  });

  test('a refusal exits 1 and names the studio’s reason; no peer text reaches stdout', async () => {
    studio = fakeStudio(opHandler);
    const r = await studio.run('comments', ['resolve', 'c_gone']);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain('HTTP 403: not-in-scope');
    expect(r.stdout).toBe('');
  });
});
