// Issue #207 (2.0.7) — files that leave this Mac while (or after) they sync, against a REAL hub.
//
// Michal moved 6 555 unused renders (1.1 GB) out of a project mid-upload. The uploads already
// decided kept re-reading the vanished files (`could not read from disk — ENOENT … trying again
// in 5s`, 951 retrying), and a file this Mac had synced and then deleted must become a delete
// proposal — held for one confirm when the batch is large — never a re-download. A file this Mac
// never had stays incoming. Both directions.

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane } from '../sync/file-plane.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
const MIB = 1024 * 1024;

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<string, string>;
}

function startHub(dataDir: string, repoDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--asset-write-rate-limit', '100000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, MAUDE_WORKSPACE_MODE: '1', MAUDE_REPO_DIR: repoDir },
    });
    let buf = '';
    const timer = setTimeout(() => reject(new Error(`hub did not start: ${buf}`)), 20_000);
    proc.stdout?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
      for (const line of buf.split('\n')) {
        if (!line.startsWith('{')) continue;
        clearTimeout(timer);
        const info = JSON.parse(line);
        resolve({ proc, http: info.http, tokens: info.tokens });
        return;
      }
    });
    proc.stderr?.on('data', (c: Buffer) => {
      buf += c.toString('utf8');
    });
  });
}

let work: string;
let root: string;
let away: string;
let hub: Hub;
let ledger: FileLedger;
beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'plane-vanished-'));
  root = join(work, 'design');
  away = join(work, 'moved-out');
  mkdirSync(root, { recursive: true });
  mkdirSync(away, { recursive: true });
  mkdirSync(join(work, 'hubrepo', '.design'), { recursive: true });
  if (HUB_READY) hub = await startHub(join(work, 'hub'), join(work, 'hubrepo'));
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB_READY ? hub.http : 'http://x' });
}, 30_000);
afterEach(() => {
  if (HUB_READY) hub.proc.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
});

const frame = (i: number) => `renders/flythrough/${String(i).padStart(4, '0')}.png`;
const writeFrame = (i: number, size = 2 * MIB) => {
  mkdirSync(join(root, 'renders', 'flythrough'), { recursive: true });
  writeFileSync(join(root, frame(i)), randomBytes(size));
};
const moveOut = (i: number) => renameSync(join(root, frame(i)), join(away, `${i}.png`));
const onHub = (rel: string) => existsSync(join(work, 'hubrepo', '.design', rel));

/** Real fetch, counting what the plane asks for; `afterPut` runs once a PUT has been answered. */
function counting(afterPut?: (n: number) => void) {
  const puts: string[] = [];
  const gets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    const res = await fetch(url, init);
    if (u.pathname.startsWith('/api/file/') && init?.method === 'PUT') {
      puts.push(decodeURIComponent(u.pathname.slice('/api/file/'.length)));
      afterPut?.(puts.length);
    }
    if (u.pathname.startsWith('/_project-file/')) gets.push(u.pathname);
    return res;
  }) as unknown as typeof fetch;
  return { fetchImpl, puts, gets };
}

const plane = (fetchImpl: typeof fetch, token = 'owner') =>
  createFilePlane({
    designRoot: root,
    hubUrl: hub.http,
    token: () => hub.tokens[token] as string,
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    propagateDeletes: true,
    fetchImpl,
    log: { log() {}, warn() {} },
  });

test.skipIf(!HUB_READY)(
  'a file moved out mid-upload is cancelled and leaves the queue — no ENOENT retry, no backoff',
  async () => {
    for (let i = 0; i < 12; i += 1) writeFrame(i);
    // After the first upload lands, six frames still waiting leave the project (the moved-out
    // renders) — their uploads were already decided this pass.
    const moved: number[] = [];
    const c = counting((n) => {
      if (n !== 1) return;
      for (let i = 0; i < 12 && moved.length < 6; i += 1) {
        if (c.puts.includes(frame(i))) continue;
        moveOut(i);
        moved.push(i);
      }
    });
    const res = await plane(c.fetchImpl).reconcile();
    expect(moved).toHaveLength(6);
    expect(res.failed).toEqual([]);
    expect(res.gone).toBe(6);
    for (const i of moved) {
      expect(c.puts).not.toContain(frame(i));
      expect(ledger.isBackedOff(frame(i), Date.now())).toBe(false);
      expect(ledger.row(frame(i))?.state).not.toBe('stuck');
      expect(onHub(frame(i))).toBe(false);
    }
    // The next pass has nothing to do for them: no upload, no download, no failure.
    const again = counting();
    const res2 = await plane(again.fetchImpl).reconcile();
    expect(again.puts).toEqual([]);
    expect(again.gets).toEqual([]);
    expect(res2.failed).toEqual([]);
    expect(res2.pulled).toEqual([]);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'synced renders moved out locally are a held delete proposal — never downloaded again',
  async () => {
    for (let i = 0; i < 30; i += 1) writeFrame(i, 64 * 1024);
    const first = await plane(counting().fetchImpl).reconcile();
    expect(first.pushed).toHaveLength(30);
    for (let i = 0; i < 25; i += 1) moveOut(i);

    for (let pass = 0; pass < 2; pass += 1) {
      const c = counting();
      const res = await plane(c.fetchImpl).reconcile();
      expect(c.gets).toEqual([]);
      expect(res.pulled).toEqual([]);
      // Over the breaker: one hold, for a person to confirm — never silent, never a download.
      expect(res.deleteHeld).toMatchObject({ direction: 'out', count: 25 });
    }
    for (let i = 0; i < 25; i += 1) {
      expect(existsSync(join(root, frame(i)))).toBe(false);
      expect(onHub(frame(i))).toBe(true); // nothing deleted anywhere without the confirm
    }
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'a few synced files deleted here are deleted on the hub; a file this Mac never had still comes down',
  async () => {
    for (let i = 0; i < 20; i += 1) writeFrame(i, 64 * 1024);
    await plane(counting().fetchImpl).reconcile();
    // Another peer adds a file this Mac never had.
    const theirs = 'blender/scene.png';
    const put = await fetch(`${hub.http}/api/file/blender/scene.png`, {
      method: 'PUT',
      headers: {
        authorization: `Bearer ${hub.tokens.alice}`,
        'content-type': 'application/octet-stream',
        'x-maude-expect-hash': 'none',
      },
      body: randomBytes(1024),
    });
    expect(put.ok).toBe(true);
    for (let i = 0; i < 2; i += 1) rmSync(join(root, frame(i)));

    const res = await plane(counting().fetchImpl).reconcile();
    expect(res.deleteHeld).toBeUndefined();
    expect(res.deleted.map((d) => d.rel).sort()).toEqual([frame(0), frame(1)]);
    expect(res.pulled).toEqual([theirs]);
    expect(existsSync(join(root, theirs))).toBe(true);
    expect(onHub(frame(0))).toBe(false);
    expect(onHub(frame(2))).toBe(true);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'the other direction: a peer deleting a synced file removes it here, a big batch is held',
  async () => {
    for (let i = 0; i < 20; i += 1) writeFrame(i, 64 * 1024);
    await plane(counting().fetchImpl).reconcile();
    const del = (rel: string) =>
      fetch(`${hub.http}/api/file/${rel}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${hub.tokens.owner}`, 'x-maude-expect-hash': '*' },
      });
    // `*` is not a hash: ask the hub for the current one, as a peer would have it.
    const { readFileSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const sha = (rel: string) =>
      createHash('sha256')
        .update(readFileSync(join(root, rel)))
        .digest('hex');
    const delExact = (rel: string) =>
      fetch(`${hub.http}/api/file/${rel}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${hub.tokens.owner}`, 'x-maude-expect-hash': sha(rel) },
      });
    void del;
    expect((await delExact(frame(0))).ok).toBe(true);
    const small = await plane(counting().fetchImpl).reconcile();
    expect(small.deleteHeld).toBeUndefined();
    expect(existsSync(join(root, frame(0)))).toBe(false);

    for (let i = 1; i < 16; i += 1) expect((await delExact(frame(i))).ok).toBe(true);
    const bigIn = await plane(counting().fetchImpl).reconcile();
    expect(bigIn.deleteHeld).toMatchObject({ direction: 'in', count: 15 });
    for (let i = 1; i < 16; i += 1) expect(existsSync(join(root, frame(i)))).toBe(true);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'renders whose upload landed while its answer was lost, then moved out: held for confirm, not re-downloaded',
  async () => {
    for (let i = 0; i < 30; i += 1) writeFrame(i, 64 * 1024);
    // The hub stores every body and every answer is lost on the way back (a timeout on a slow
    // link): this Mac records no ancestor for any of them.
    const lossy = (async (url: string | URL | Request, init?: RequestInit) => {
      const res = await fetch(url, init);
      if (init?.method === 'PUT') throw new Error('The operation timed out.');
      return res;
    }) as unknown as typeof fetch;
    await plane(lossy).reconcile();
    expect(onHub(frame(0))).toBe(true);
    expect(ledger.ancestorOf(frame(0))).toBeNull();
    // Moved out of the project before a later pass could agree with the hub; the watcher saw
    // each move, so the stat cache is dropped (the observation is not).
    for (let i = 0; i < 25; i += 1) {
      moveOut(i);
      ledger.noteChanged(frame(i));
    }
    const c = counting();
    const res = await plane(c.fetchImpl).reconcile();
    expect(c.gets).toEqual([]);
    expect(res.pulled).toEqual([]);
    expect(res.deleteHeld).toMatchObject({ direction: 'out', count: 25 });
    for (let i = 0; i < 25; i += 1) {
      expect(existsSync(join(root, frame(i)))).toBe(false);
      expect(onHub(frame(i))).toBe(true);
    }
  },
  60_000
);
