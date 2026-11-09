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
import { createFilePlane, DELETE_HELD_REASON, heldSetDigest } from '../sync/file-plane.ts';
import { createHeldDeletes, heldDeleteDetail } from '../sync/held-deletes.ts';
import { computeSeedProgress, DELETED_HERE_HELD_REASON } from '../sync/seed-progress.ts';
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

// ── 3. Deleted on this Mac, held — its own row and two answers ─────────────

const FOLDER = 'renders/flythrough';

/** 30 synced renders, 25 then deleted on this Mac: over the outbound breaker. */
async function heldBatch(token = 'projectOwner') {
  for (let i = 0; i < 30; i += 1) writeFrame(i);
  const p = plane(counting().fetchImpl, true, token);
  await p.reconcile();
  for (let i = 0; i < 25; i += 1) rmSync(join(root, frame(i)));
  const res = await p.reconcile();
  // 2.1.1 N4 — the digest of the held batch, as Sync details shows it (the answers carry it back)
  return { p, res, shown: res.deleteHeld?.digest ?? '' };
}

const control = (
  p: ReturnType<typeof plane>,
  o: { owner: boolean; sent?: number; token?: string }
) =>
  createHeldDeletes({
    plane: () => p,
    sentInWindow: () => o.sent ?? 0,
    isOwner: () => o.owner,
    hubUrl: hub.http,
    token: () => hub.tokens[o.token ?? 'projectOwner'] as string,
    runPass: async () => {
      await p.reconcile();
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, Math.min(ms, 50))),
    log: { log() {}, warn() {} },
  });

test.skipIf(!HUB_READY)(
  'a 25-file local delete is held as its own state, named by folder and count',
  async () => {
    const { p, res } = await heldBatch();
    expect(res.deleteHeld).toMatchObject({
      direction: 'out',
      count: 25,
      folders: [{ folder: FOLDER, count: 25 }],
    });
    // 2.1.1 N4 — the pass names the batch an answer would cover
    expect(res.deleteHeld?.digest).toBe(heldSetDigest(p.heldDeletes().paths));
    expect(ledger.row(frame(0))?.state).toBe('delete-held');
    expect(ledger.row(frame(0))?.reason).toBe(DELETE_HELD_REASON);
    expect(p.doruceka()[frame(0)]).toBe('delete-held');
    expect(p.heldDeletes()).toMatchObject({ count: 25, folders: [{ folder: FOLDER, count: 25 }] });
    const progress = computeSeedProgress({ rows: ledger.rows(), now: Date.now() });
    expect(progress.heldDeleteAsk).toBe(25);
    expect(progress.remaining).toBe(0);
    // Asked again on the next pass: never sent, never downloaded.
    const c = counting();
    const again = await plane(c.fetchImpl).reconcile();
    expect(again.deleteHeld?.count).toBe(25);
    expect(c.gets).toEqual([]);
    expect(onHub(frame(0))).toBe(true);
    // A new delete joins the question instead of slipping out under the limit beside it.
    rmSync(join(root, frame(25)));
    const joined = await plane(counting().fetchImpl).reconcile();
    expect(joined.deleted).toEqual([]);
    expect(joined.deleteHeld?.count).toBe(26);
    expect(heldDeleteDetail(26, [{ folder: FOLDER, count: 26 }])).toBe(
      '26 files deleted on this Mac in renders/flythrough — more than sync deletes on the hub without asking. They are still on the hub. Delete them on the hub too, or keep them there.'
    );
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'Delete on the hub too, within the door budget: one confirmed batch through the door',
  async () => {
    const { p, shown } = await heldBatch();
    const answer = await control(p, { owner: true }).answer('delete', FOLDER, shown);
    expect(answer).toEqual({ ok: true, how: 'door', count: 25 });
    await p.reconcile();
    for (let i = 0; i < 25; i += 1) expect(onHub(frame(i))).toBe(false);
    expect(onHub(frame(25))).toBe(true);
    await p.reconcile();
    expect(ledger.row(frame(0))).toBeNull();
    expect(p.heldDeletes().count).toBe(0);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'Delete on the hub too, past the door budget: the owner purge, dry run then confirm',
  async () => {
    const { p, shown } = await heldBatch();
    const c = control(p, { owner: true, sent: 190 });
    const answer = await c.answer('delete', null, shown);
    expect(answer).toEqual({ ok: true, how: 'purge', count: 25 });
    // While it runs the row is not asked again.
    expect(c.view().count).toBe(0);
    await c.idle();
    expect(c.view().purge).toBeNull();
    for (let i = 0; i < 25; i += 1) expect(onHub(frame(i))).toBe(false);
    expect(onHub(frame(26))).toBe(true);
    const audit = readFileSync(join(work, 'hub', 'purge-audit.jsonl'), 'utf8');
    expect(audit).toContain('"event":"purge-done"');
    await p.reconcile();
    expect(ledger.row(frame(0))).toBeNull();
    expect(Object.keys(p.doruceka()).filter((r) => r.startsWith(FOLDER))).toHaveLength(5);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'a member past the budget gets an honest no; nothing is deleted and the row still asks',
  async () => {
    const { p, shown } = await heldBatch('alice');
    const answer = await control(p, { owner: false, sent: 5, token: 'alice' }).answer(
      'delete',
      FOLDER,
      shown
    );
    expect(answer).toEqual({
      ok: false,
      reason: 'not-owner',
      detail:
        'Only the project owner can delete this many at once — ask them, or keep them on the hub.',
    });
    await p.reconcile();
    for (let i = 0; i < 25; i += 1) expect(onHub(frame(i))).toBe(true);
    expect(p.heldDeletes().count).toBe(25);
    // The hub agrees: its confirmed purge is the owner's alone.
    const purge = await fetch(`${hub.http}/api/file-purge`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${hub.tokens.alice}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ prefix: `${FOLDER}/`, dryRun: true }),
    });
    expect(purge.status).toBe(403);
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'Keep on the hub: no delete proposal, never downloaded again; a teammate’s delete still lands',
  async () => {
    const { p, shown } = await heldBatch();
    const answer = await control(p, { owner: true }).answer('keep', FOLDER, shown);
    expect(answer).toEqual({ ok: true, how: 'keep', count: 25 });
    for (let pass = 0; pass < 2; pass += 1) {
      const c = counting();
      const res = await plane(c.fetchImpl).reconcile();
      expect(c.gets).toEqual([]);
      expect(res.pulled).toEqual([]);
      expect(res.deleted).toEqual([]);
      expect(res.deleteHeld).toBeUndefined();
    }
    for (let i = 0; i < 25; i += 1) {
      expect(onHub(frame(i))).toBe(true);
      expect(existsSync(join(root, frame(i)))).toBe(false);
    }
    expect(p.doruceka()[frame(0)]).toBe('hub-only');
    const progress = computeSeedProgress({ rows: ledger.rows(), now: Date.now() });
    expect(progress.remaining).toBe(0);
    expect(progress.heldDeletedHere).toBe(25);
    // Kept across a restart: a new plane over the same ledger file.
    ledger.flush();
    ledger = createFileLedger({ designRoot: root, hubUrl: hub.http });
    const c = counting();
    await plane(c.fetchImpl).reconcile();
    expect(c.gets).toEqual([]);
    expect(ledger.row(frame(0))?.state).toBe('hub-only');
    // A teammate deletes one on the hub: deleted on both sides, so it leaves Sync details.
    await hubDelete(frame(0));
    await plane(counting().fetchImpl).reconcile();
    await plane(counting().fetchImpl).reconcile();
    expect(ledger.row(frame(0))).toBeNull();
  },
  60_000
);

test.skipIf(!HUB_READY)(
  'the other direction: the owner’s purge reaches a teammate’s Mac as a held inbound batch',
  async () => {
    const { p, shown } = await heldBatch();
    // A second Mac with its own copy of the project.
    const rootB = join(work, 'design-b');
    mkdirSync(rootB, { recursive: true });
    const ledgerB = createFileLedger({ designRoot: rootB, hubUrl: hub.http });
    const planeB = createFilePlane({
      designRoot: rootB,
      hubUrl: hub.http,
      token: () => hub.tokens.bob as string,
      ledger: ledgerB,
      allowCodeModules: false,
      label: 'b',
      propagateDeletes: true,
      log: { log() {}, warn() {} },
    });
    await planeB.reconcile();
    expect(existsSync(join(rootB, frame(26)))).toBe(true);
    const c = control(p, { owner: true, sent: 190 });
    await c.answer('delete', FOLDER, shown);
    await c.idle();
    const inbound = await planeB.reconcile();
    // The inbound breaker is unchanged: a hub-ordered mass delete is held on every peer.
    expect(inbound.deleteHeld).toMatchObject({ direction: 'in', count: 25 });
    expect(existsSync(join(rootB, frame(0)))).toBe(true);
  },
  60_000
);
