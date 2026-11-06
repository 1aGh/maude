// Issue #207 — a folder the project does not sync (`linkedHub.ignoreFolders`), and the notice for a
// long run of pictures going up. Server half: the plane, the progress count, the cleaning of a
// committed list. Both directions: an ignored folder neither uploads nor downloads.

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import {
  createFilePlane,
  isIgnoredRel,
  LARGE_SEQUENCE_FILES,
  normalizeIgnoreFolders,
} from '../sync/file-plane.ts';
import { computeSeedProgress } from '../sync/seed-progress.ts';

const HUB = 'https://hub.test';
let root: string;
let ledger: FileLedger;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-plane-ignore-'));
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

const put = (rel: string, body: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

/** A hub holding `remote` (rel → body); records every upload and download it is asked for. */
function hub(remote: Record<string, string> = {}) {
  const puts: string[] = [];
  const gets: string[] = [];
  const sha = (s: string) => createHash('sha256').update(s).digest('hex');
  const entries = Object.entries(remote).map(([path, body], i) => ({
    seq: i + 1,
    path,
    sha256: sha(body),
    size: body.length,
    mtimeMs: 0,
    class: 'inert-media',
  }));
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      return Response.json({ epoch: 'e1', head: entries.length, entries, truncated: false });
    }
    if (u.pathname.startsWith('/api/file/') && init.method === 'PUT') {
      puts.push(decodeURIComponent(u.pathname.slice('/api/file/'.length)));
      return Response.json({ ok: true, seq: 100 + puts.length });
    }
    if (u.pathname.startsWith('/_project-file/')) {
      const rel = decodeURIComponent(u.pathname.slice('/_project-file/'.length));
      gets.push(rel);
      return new Response(remote[rel] ?? '', { status: remote[rel] ? 200 : 404 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, puts, gets };
}

const plane = (fetchImpl: typeof fetch, ignoreFolders?: () => readonly string[]) =>
  createFilePlane({
    designRoot: root,
    hubUrl: HUB,
    token: () => 'tok',
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    fetchImpl,
    log: { log() {}, warn() {} },
    ...(ignoreFolders ? { ignoreFolders } : {}),
  });

test('an ignored folder is not uploaded, and its files are counted as ignored — not waiting', async () => {
  put('renders/draft1/0001.png', 'frame-1');
  put('renders/draft1/0002.png', 'frame-2');
  put('assets/logo.png', 'logo');
  const h = hub();
  const res = await plane(h.fetchImpl, () => ['renders']).reconcile();

  expect(h.puts).toEqual(['assets/logo.png']);
  expect(res.ignored).toBe(2);
  expect(ledger.row('renders/draft1/0001.png')?.state).toBe('ignored');
  const progress = computeSeedProgress({ rows: ledger.rows(), now: Date.now() });
  expect(progress.ignored).toBe(2);
  expect(progress.remaining).toBe(0);
});

test('an ignored folder does not download either; the rest still does', async () => {
  const h = hub({ 'renders/0001.png': 'theirs-1', 'assets/photo.png': 'photo' });
  const res = await plane(h.fetchImpl, () => ['renders']).reconcile();
  expect(h.gets).toEqual(['assets/photo.png']);
  expect(res.pulled).toEqual(['assets/photo.png']);
});

test('the list is read every pass: leaving a folder out mid-upload stops it at the next pass', async () => {
  for (let i = 0; i < 3; i += 1) put(`renders/${i}.png`, `f${i}`);
  let list: string[] = [];
  const h = hub();
  const p = plane(h.fetchImpl, () => list);
  list = ['renders'];
  await p.reconcile();
  expect(h.puts).toEqual([]);
  list = [];
  await p.reconcile();
  expect(h.puts.sort()).toEqual(['renders/0.png', 'renders/1.png', 'renders/2.png']);
});

test('a long run of pictures in one folder is named for the panel; a short one is not', async () => {
  for (let i = 0; i <= LARGE_SEQUENCE_FILES; i += 1) {
    put(`ideas/flythrough/${String(i).padStart(4, '0')}.png`, `frame-${i}`);
  }
  put('assets/a.png', 'a');
  const res = await plane(hub().fetchImpl).reconcile();
  expect(res.largeSequences?.map((s) => [s.folder, s.files])).toEqual([
    ['ideas/flythrough', LARGE_SEQUENCE_FILES + 1],
  ]);
});

test('a committed list is cleaned: no escapes, no absolute paths, slashes trimmed', () => {
  expect(
    normalizeIgnoreFolders(['renders/', '/etc', '../up', 'a/../..', 'C:\\x', '', 3, 'renders'])
  ).toEqual(['renders']);
  expect(normalizeIgnoreFolders('renders')).toEqual([]);
  expect(isIgnoredRel('renders/a.png', ['renders'])).toBe(true);
  expect(isIgnoredRel('renders-old/a.png', ['renders'])).toBe(false);
});
