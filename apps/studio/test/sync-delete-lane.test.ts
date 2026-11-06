// Issue #207 (2.0.7 fix #7b) — the sync delete lane, against a REAL hub.
//
//   1. `linkedHub.propagateDeletes` is read every pass, not once at boot: flipping it in config.json
//      and pressing Resync applies at the next pass.
//   2. A file deleted on BOTH sides leaves Sync details — it is not "only on this Mac".
//   3. "Deleted on this Mac, held": its own state, a Sync details row, and two answers — Delete on
//      the hub too (the door, or the owner's confirmed purge past the door's budget; a member past it
//      gets an honest no) and Keep on the hub (no delete proposal, no re-download).

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane } from '../sync/file-plane.ts';
import { DELETED_HERE_HELD_REASON } from '../sync/seed-progress.ts';
import { livePropagateDeletes } from '../sync/settings.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));

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
let hub: Hub;
let ledger: FileLedger;
beforeEach(async () => {
  work = mkdtempSync(join(tmpdir(), 'delete-lane-'));
  root = join(work, 'design');
  mkdirSync(root, { recursive: true });
  mkdirSync(join(work, 'hubrepo', '.design'), { recursive: true });
  if (HUB_READY) hub = await startHub(join(work, 'hub'), join(work, 'hubrepo'));
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB_READY ? hub.http : 'http://x' });
}, 30_000);
afterEach(() => {
  if (HUB_READY) hub.proc.kill('SIGTERM');
  rmSync(work, { recursive: true, force: true });
});

const frame = (i: number) => `renders/flythrough/${String(i).padStart(4, '0')}.png`;
const writeFrame = (i: number) => {
  mkdirSync(join(root, 'renders', 'flythrough'), { recursive: true });
  writeFileSync(join(root, frame(i)), randomBytes(4096));
};
const onHub = (rel: string) => existsSync(join(work, 'hubrepo', '.design', rel));

/** Real fetch, counting the downloads the plane asks for. */
function counting() {
  const gets: string[] = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/_project-file/')) gets.push(u.pathname);
    return fetch(url, init);
  }) as unknown as typeof fetch;
  return { fetchImpl, gets };
}

const plane = (
  fetchImpl: typeof fetch,
  propagateDeletes: boolean | (() => boolean) = true,
  token = 'owner'
) =>
  createFilePlane({
    designRoot: root,
    hubUrl: hub.http,
    token: () => hub.tokens[token] as string,
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    propagateDeletes,
    fetchImpl,
    log: { log() {}, warn() {} },
  });

// ── 1. propagateDeletes is read every pass ─────────────────────────────────

test.skipIf(!HUB_READY)(
  'propagateDeletes flipped between two passes applies at the next pass — no restart',
  async () => {
    for (let i = 0; i < 4; i += 1) writeFrame(i);
    let propagate = false;
    const p = plane(counting().fetchImpl, () => propagate);
    await p.reconcile();
    rmSync(join(root, frame(0)));

    const off = await p.reconcile();
    expect(off.deleted).toEqual([]);
    expect(onHub(frame(0))).toBe(true);
    expect(ledger.row(frame(0))?.reason).toBe(DELETED_HERE_HELD_REASON);

    propagate = true; // the person turned delete sync back on; the same plane, the next pass
    const on = await p.reconcile();
    expect(on.deleted.map((d) => d.rel)).toEqual([frame(0)]);
    expect(onHub(frame(0))).toBe(false);
  },
  60_000
);

test('livePropagateDeletes reads config.json on every call', () => {
  const repo = mkdtempSync(join(tmpdir(), 'live-propagate-'));
  try {
    mkdirSync(join(repo, '.design'), { recursive: true });
    const cfg = join(repo, '.design', 'config.json');
    const write = (hub: Record<string, unknown>) =>
      writeFileSync(cfg, JSON.stringify({ linkedHub: { url: 'https://hub.test', ...hub } }));
    write({});
    expect(livePropagateDeletes(repo, false)).toBe(true);
    write({ propagateDeletes: false });
    expect(livePropagateDeletes(repo, true)).toBe(false);
    write({});
    expect(livePropagateDeletes(repo, false)).toBe(true);
    // No hub in the config (a cell's pairing): the caller's own reading answers.
    writeFileSync(cfg, '{}');
    expect(livePropagateDeletes(repo, false)).toBe(false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('the runtime hands the plane a getter, not the boot-time value', () => {
  const src = readFileSync(join(import.meta.dir, '..', 'sync', 'index.ts'), 'utf8');
  expect(src.includes('propagateDeletes: linkedHub.propagateDeletes !== false,')).toBe(false);
  expect(/propagateDeletes: \(\) =>\s+livePropagateDeletes\(/.test(src)).toBe(true);
});

// ── 2. Deleted on both sides leaves Sync details ───────────────────────────

/** The hub-side delete a teammate would send: CAS on the hash the hub holds now. */
async function hubDelete(rel: string, token = 'alice') {
  const journal = (await (
    await fetch(`${hub.http}/api/journal?since=0`, {
      headers: { authorization: `Bearer ${hub.tokens.owner}` },
    })
  ).json()) as { entries: { path: string; sha256: string | null; deleted?: boolean }[] };
  const live = journal.entries.filter((e) => e.path === rel && !e.deleted).pop();
  const res = await fetch(`${hub.http}/api/file/${rel}`, {
    method: 'DELETE',
    headers: {
      authorization: `Bearer ${hub.tokens[token]}`,
      'x-maude-expect-hash': String(live?.sha256),
    },
  });
  expect(res.ok).toBe(true);
}

test.skipIf(!HUB_READY)(
  'a delete this Mac sent does not come back as "only on this Mac" when its tombstone arrives',
  async () => {
    // Ten tracked, two deleted: under every breaker arm (a quarter of the project is the proportion one).
    for (let i = 0; i < 10; i += 1) writeFrame(i);
    const p = plane(counting().fetchImpl);
    await p.reconcile();
    rmSync(join(root, frame(0)));
    rmSync(join(root, frame(1)));
    const sent = await p.reconcile();
    expect(sent.deleted.map((d) => d.rel).sort()).toEqual([frame(0), frame(1)]);
    // The next passes read the hub's own tombstones for them.
    await p.reconcile();
    await p.reconcile();
    expect(ledger.row(frame(0))).toBeNull();
    expect(p.doruceka()[frame(0)]).toBeUndefined();
    expect(p.doruceka()[frame(1)]).toBeUndefined();
    expect(p.doruceka()[frame(2)]).toBe('on-hub');
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'a file deleted here (delete sync off) and then on the hub leaves Sync details',
  async () => {
    for (let i = 0; i < 4; i += 1) writeFrame(i);
    const p = plane(counting().fetchImpl, false);
    await p.reconcile();
    rmSync(join(root, frame(0)));
    await p.reconcile();
    expect(ledger.row(frame(0))?.state).toBe('stuck');
    await hubDelete(frame(0));
    await p.reconcile();
    await p.reconcile();
    expect(ledger.row(frame(0))).toBeNull();
    expect(p.doruceka()[frame(0)]).toBeUndefined();
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'the other direction: a teammate deletes a file, this Mac quarantines it, and the row leaves',
  async () => {
    for (let i = 0; i < 4; i += 1) writeFrame(i);
    const p = plane(counting().fetchImpl);
    await p.reconcile();
    await hubDelete(frame(3));
    const res = await p.reconcile();
    expect(res.deleted.map((d) => d.rel)).toEqual([frame(3)]);
    await p.reconcile();
    expect(existsSync(join(root, frame(3)))).toBe(false);
    expect(p.doruceka()[frame(3)]).toBeUndefined();
  },
  60_000
);
