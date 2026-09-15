// Large media through the file plane — plan T18, against a REAL hub.
//
// A 100 MiB video (past the 95 MiB single-PUT door) goes up as a resumable
// upload session: an interrupted upload resumes by sending only the parts the
// hub does not hold, the hub lands it only whole and verified, and a second
// peer downloads it streamed — resuming from a partial download with a byte
// range. Nothing here holds the video in memory.

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync, writeSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { createFileLedger } from '../sync/file-ledger.ts';
import { createFilePlane, sha256File } from '../sync/file-plane.ts';

const HUB_DIR = resolve(import.meta.dir, '../../hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
const MIB = 1024 * 1024;
const SIZE = 100 * MIB;

function startHub(dataDir: string, repoDir: string): Promise<{ proc: ChildProcess; http: string; token: string }> {
  return new Promise((ok, fail) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, HUB_WORKSPACE_MODE: '1', MAUDE_REPO_DIR: repoDir },
    });
    let buf = '';
    const timer = setTimeout(() => fail(new Error(`hub did not start: ${buf}`)), 30_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      const line = buf.split('\n').find((l) => l.startsWith('{'));
      if (!line) return;
      clearTimeout(timer);
      const info = JSON.parse(line);
      ok({ proc, http: info.http.replace(/\/$/, ''), token: info.tokens.alice });
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

/** A deterministic, non-sparse video-sized file, written 1 MiB at a time. */
function writeVideo(abs: string, size: number): string {
  mkdirSync(join(abs, '..'), { recursive: true });
  const fd = openSync(abs, 'w');
  const hash = createHash('sha256');
  try {
    for (let off = 0; off < size; off += MIB) {
      const chunk = Buffer.alloc(Math.min(MIB, size - off), (off / MIB) % 251);
      chunk.writeUInt32BE(off / MIB, 0);
      writeSync(fd, chunk);
      hash.update(chunk);
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest('hex');
}

describe.skipIf(!HUB_READY)('large media over the file plane (real hub)', () => {
  let root: string;
  let hub: { proc: ChildProcess; http: string; token: string };
  let repo: string;

  beforeAll(async () => {
    root = mkdtempSync(join(tmpdir(), 'large-media-'));
    repo = join(root, 'repo');
    mkdirSync(join(repo, '.design', 'assets'), { recursive: true });
    writeFileSync(join(repo, '.design', 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    hub = await startHub(join(root, 'hub'), repo);
  }, 60_000);

  afterAll(async () => {
    await new Promise<void>((r) => {
      if (hub.proc.exitCode !== null) return r();
      hub.proc.once('exit', () => r());
      hub.proc.kill('SIGTERM');
    });
    rmSync(root, { recursive: true, force: true });
  });

  const plane = (designRoot: string, fetchImpl?: typeof fetch, later = 0) => {
    // `later`: a restarted app past the failed path's backoff.
    const now = () => Date.now() + later;
    return createFilePlane({
      designRoot,
      hubUrl: hub.http,
      token: () => hub.token,
      ledger: createFileLedger({ designRoot, hubUrl: hub.http, now, flushMs: 0 }),
      allowCodeModules: false,
      label: 'test',
      now,
      ...(fetchImpl ? { fetchImpl } : {}),
      log: { log() {}, warn() {} },
    });
  };

  test('an interrupted 100 MiB upload resumes with only the missing parts, and lands whole', async () => {
    const a = join(root, 'a', '.design');
    mkdirSync(a, { recursive: true });
    writeFileSync(join(a, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    const sha = writeVideo(join(a, 'assets', 'shoot.mp4'), SIZE);

    // Pass 1: the connection dies at part 5, every attempt.
    const parts1: number[] = [];
    const flaky = (async (url: string | URL, init?: RequestInit) => {
      const m = /\/api\/file-uploads\/up_[0-9a-f]+\/(\d+)$/.exec(String(url));
      if (m && init?.method === 'PUT') {
        parts1.push(Number(m[1]));
        if (Number(m[1]) === 5) throw new TypeError('fetch failed');
      }
      return fetch(url, init);
    }) as typeof fetch;
    await plane(a, flaky).reconcile();
    expect(existsSync(join(repo, '.design', 'assets', 'shoot.mp4'))).toBe(false); // never half
    expect(parts1.filter((n) => n < 5)).toEqual([0, 1, 2, 3, 4]);

    // Pass 2 (a restarted app): only parts 5.. go up.
    const parts2: number[] = [];
    const counting = (async (url: string | URL, init?: RequestInit) => {
      const m = /\/api\/file-uploads\/up_[0-9a-f]+\/(\d+)$/.exec(String(url));
      if (m && init?.method === 'PUT') parts2.push(Number(m[1]));
      return fetch(url, init);
    }) as typeof fetch;
    await plane(a, counting, 15 * 60_000).reconcile();
    expect(parts2.length).toBeGreaterThan(0);
    expect(Math.min(...parts2)).toBe(5);
    expect(sha256File(join(repo, '.design', 'assets', 'shoot.mp4'))).toBe(sha);
  }, 120_000);

  test('a second peer downloads it streamed, resuming a partial download with a byte range', async () => {
    const sha = sha256File(join(repo, '.design', 'assets', 'shoot.mp4'));
    const b = join(root, 'b', '.design');
    mkdirSync(join(b, '_state', 'downloads'), { recursive: true });
    writeFileSync(join(b, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
    // A previous run got the first 10 MiB before the network dropped.
    const partial = join(b, '_state', 'downloads', `${sha}.part`);
    writeVideo(partial, 10 * MIB);
    let ranged: string | null = null;
    const watching = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/_project-file/')) {
        ranged = (init?.headers as Record<string, string> | undefined)?.range ?? null;
      }
      return fetch(url, init);
    }) as typeof fetch;
    await plane(b, watching).reconcile();
    expect(ranged).toBe(`bytes=${10 * MIB}-`);
    expect(sha256File(join(b, 'assets', 'shoot.mp4'))).toBe(sha);
    expect(existsSync(partial)).toBe(false);
  }, 120_000);
});
