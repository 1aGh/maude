// The file plane, both directions — Sync v2 Increment 3 (DDR-226 §§3–7).
//
// `decide-file.ts` proves the TABLE and `file-ledger.ts` proves the ORDERING.
// This proves the thing neither can: that a real pass reads a journal, scans a
// real tree, and carries out what the table said — moving bytes the right way,
// parking what must be parked, and refusing what a receiver must refuse.
//
// The hub here is a fixture, not a stub of our own logic: it answers the real
// wire shapes (`GET /api/journal`, `GET /_project-file/`, `PUT /api/file/`)
// and enforces the compare-and-swap, so a client that gets the protocol wrong
// fails here rather than in production.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  ftruncateSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import {
  createFilePlane,
  DEFAULT_HUB_MAX_FILE_BYTES,
  DELETE_BUDGET_PER_WINDOW,
  foldRemote,
  MAX_FILE_BYTES,
  MAX_REQUESTS_PER_PASS,
  MAX_TRUSTED_QUOTA_PAUSE_MS,
  MIN_TRUSTED_MAX_FILE_BYTES,
  REANCHOR_HOLD_RECOVERY_MS,
  REANCHOR_STORM_LIMIT,
  scanLocalFiles,
} from '../sync/file-plane.ts';

const HUB = 'https://hub.test';
const sha = (s: string | Uint8Array) => createHash('sha256').update(s).digest('hex');

let root: string;
let ledger: FileLedger;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-plane-'));
  mkdirSync(join(root, 'system/ds'), { recursive: true });
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'config.json'), '{"canvasGroups":[{"path":"system"},{"path":"ui"}]}');
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0 });
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A hub that answers the real routes and enforces the real preconditions. */
function fakeHub(initial: Record<string, string> = {}) {
  let seq = 0;
  const rows = new Map<
    string,
    { seq: number; sha256: string | null; size: number; body: string; deleted?: boolean }
  >();
  const puts: { rel: string; expect: string | null; body: string }[] = [];
  const deletes: string[] = [];
  let lieAboutSize = false;
  let forceReanchor = false;
  let reanchorBudget = 0;
  let epochValue = 'epoch-1';
  const add = (rel: string, body: string) => {
    seq += 1;
    rows.set(rel, { seq, sha256: sha(body), size: body.length, body });
  };
  for (const [rel, body] of Object.entries(initial)) add(rel, body);

  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      const since = Number(u.searchParams.get('since') ?? '0');
      const askedEpoch = u.searchParams.get('epoch');
      if (reanchorBudget > 0) {
        reanchorBudget -= 1;
        return new Response(JSON.stringify({ epoch: epochValue, head: seq, reanchor: true }), {
          status: 200,
        });
      }
      if (forceReanchor) {
        return new Response(JSON.stringify({ epoch: epochValue, head: seq, reanchor: true }), {
          status: 200,
        });
      }
      if (askedEpoch && askedEpoch !== epochValue) {
        return new Response(JSON.stringify({ epoch: epochValue, head: seq, reanchor: true }), {
          status: 200,
        });
      }
      if (since > seq) {
        return new Response(JSON.stringify({ epoch: epochValue, head: seq, reanchor: true }), {
          status: 200,
        });
      }
      const entries = [...rows.entries()]
        .filter(([, r]) => r.seq > since)
        .map(([path, r]) => ({
          seq: r.seq,
          path,
          sha256: r.sha256,
          size: lieAboutSize ? 0 : r.size,
          mtimeMs: 0,
          class: 'companion-text',
          deleted: r.deleted === true,
        }))
        .sort((a, b) => a.seq - b.seq);
      return new Response(
        JSON.stringify({ epoch: epochValue, head: seq, entries, truncated: false }),
        {
          status: 200,
        }
      );
    }
    if (u.pathname.startsWith('/_project-file/')) {
      const rel = decodeURIComponent(u.pathname.slice('/_project-file/'.length));
      const row = rows.get(rel);
      if (!row) return new Response('nope', { status: 404 });
      return new Response(row.body, { status: 200 });
    }
    if (u.pathname.startsWith('/api/file/') && init?.method === 'DELETE') {
      const rel = u.pathname
        .slice('/api/file/'.length)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
      const headers = new Headers(init.headers as HeadersInit);
      const expect = headers.get('x-maude-expect-hash');
      const current = rows.get(rel)?.sha256 ?? null;
      if (expect && expect !== 'none' && current !== expect) {
        return new Response(JSON.stringify({ error: 'moved', current }), { status: 409 });
      }
      deletes.push(rel);
      seq += 1;
      rows.set(rel, { seq, sha256: null, size: 0, body: '', deleted: true });
      return new Response(JSON.stringify({ ok: true, path: rel, deleted: true, seq }), {
        status: 200,
      });
    }
    if (u.pathname.startsWith('/api/file/') && init?.method === 'PUT') {
      const rel = u.pathname
        .slice('/api/file/'.length)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
      const headers = new Headers(init.headers as HeadersInit);
      const expect = headers.get('x-maude-expect-hash');
      const current = rows.get(rel)?.sha256 ?? null;
      const wantsAbsent = expect === 'none';
      if (expect && !(wantsAbsent ? current === null : current === expect)) {
        return new Response(JSON.stringify({ error: 'moved', current }), { status: 409 });
      }
      const body = Buffer.from(init.body as ArrayBuffer).toString('utf8');
      puts.push({ rel, expect, body });
      add(rel, body);
      return new Response(JSON.stringify({ ok: true, seq, sha256: sha(body) }), { status: 200 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;

  /**
   * A rewind: the log comes back from an older generation. Rows above `to` are
   * gone and the head moves back — which is what makes a peer's cursor
   * unhonourable and forces the re-anchor.
   */
  const rewindTo = (to: number) => {
    for (const [rel, r] of [...rows]) if (r.seq > to) rows.delete(rel);
    seq = to;
  };

  return {
    fetchImpl,
    rows,
    puts,
    add,
    rewindTo,
    deletes,
    /** Tombstone a path hub-side, as another peer's delete would. */
    tombstone: (rel: string) => {
      seq += 1;
      rows.set(rel, { seq, sha256: null, size: 0, body: '', deleted: true });
    },
    epoch: () => epochValue,
    head: () => seq,
    /** Declare every row as costing nothing — the A1 primitive. */
    understateSizes: () => {
      lieAboutSize = true;
    },
    /** Answer `reanchor` to everything — the hostile-hub shape. */
    alwaysReanchor: () => {
      forceReanchor = true;
    },
    /** Answer `reanchor` for the next `n` requests only. */
    reanchorFor: (n: number) => {
      reanchorBudget = n;
    },
    /** A LEGITIMATE epoch rotation (a restore, DDR-226 §3). */
    rotateEpoch: () => {
      epochValue = `epoch-${Math.abs(seq) + 2}`;
    },
  };
}

const plane = (hub: ReturnType<typeof fakeHub>, over = {}) =>
  createFilePlane({
    designRoot: root,
    hubUrl: HUB,
    token: () => 'tok',
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    fetchImpl: hub.fetchImpl,
    log: { log() {}, warn() {} },
    now: () => 1_700_000_000_000,
    ...over,
  });

const read = (rel: string) => readFileSync(join(root, rel), 'utf8');
const write = (rel: string, body: string) => {
  mkdirSync(join(root, rel, '..'), { recursive: true });
  writeFileSync(join(root, rel), body);
};

describe('scanning', () => {
  test('admits the plane and leaves plane A alone', () => {
    write('system/ds/brand.css', ':root{}');
    write('assets/a.png', 'PNG');
    write('ui/home.tsx', 'export default null');
    write('ui/home.meta.json', '{}');
    const found = scanLocalFiles(root, ledger, [{ path: 'system' }, { path: 'ui' }]);
    expect([...found.keys()].sort()).toEqual(['assets/a.png', 'system/ds/brand.css']);
  });

  test('a SETTLED file is answered from the stat cache, unread', () => {
    write('system/ds/brand.css', ':root{}');
    const first = scanLocalFiles(root, ledger);
    const found = first.get('system/ds/brand.css')!;
    // An old mtime is a trustworthy identity: nothing can have changed inside
    // the timestamp's resolution, because the timestamp is not recent.
    // One stamp: two `Date.now()` calls can straddle a millisecond and differ.
    const settled = Date.now() - 60_000;
    ledger.noteLocal('system/ds/brand.css', found.hash, found.size, settled);
    expect(ledger.cachedHash('system/ds/brand.css', found.size, settled)).toBe(found.hash);
  });

  test('a file written MOMENTS ago is re-read, whatever the stamp says', () => {
    // The mtime-granularity trap, and it is not hypothetical: `v1` → `v2` is a
    // same-length edit, and two writes inside the filesystem's timestamp
    // resolution are indistinguishable by `(size, mtime)`. Trusting the cache
    // there means a real edit is never noticed at all.
    write('system/ds/brand.css', 'v1');
    const first = scanLocalFiles(root, ledger);
    const found = first.get('system/ds/brand.css')!;
    expect(ledger.cachedHash('system/ds/brand.css', found.size, found.mtimeMs)).toBeNull();
  });

  test('and the watcher can invalidate a path outright', () => {
    write('system/ds/brand.css', ':root{}');
    const found = scanLocalFiles(root, ledger).get('system/ds/brand.css')!;
    ledger.noteLocal('system/ds/brand.css', found.hash, found.size, Date.now() - 60_000);
    ledger.noteChanged('system/ds/brand.css');
    expect(ledger.cachedHash('system/ds/brand.css', found.size, Date.now() - 60_000)).toBeNull();
  });

  test('never descends into runtime state', () => {
    mkdirSync(join(root, '_history/x'), { recursive: true });
    writeFileSync(join(root, '_history/x/old.css'), 'x');
    mkdirSync(join(root, '_trash'), { recursive: true });
    writeFileSync(join(root, '_trash/dead.css'), 'x');
    expect([...scanLocalFiles(root, ledger).keys()]).toEqual([]);
  });
});

describe('foldRemote', () => {
  test('the newest row per path wins', () => {
    const folded = foldRemote([
      { seq: 1, path: 'a', sha256: 'x', size: 1, mtimeMs: 0, class: '', deleted: false },
      { seq: 5, path: 'a', sha256: 'y', size: 1, mtimeMs: 0, class: '', deleted: false },
      { seq: 3, path: 'a', sha256: 'z', size: 1, mtimeMs: 0, class: '', deleted: false },
    ]);
    expect(folded.get('a')?.sha256).toBe('y');
  });
});

describe('down — the hub has something we do not', () => {
  test('it lands, verified, and the ancestor follows', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': ':root{--a:1}' });
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual(['system/ds/brand.css']);
    expect(read('system/ds/brand.css')).toBe(':root{--a:1}');
    expect(ledger.ancestorOf('system/ds/brand.css')).toBe(sha(':root{--a:1}'));
    expect(ledger.cursor()).toBe(hub.head());
  });

  test('a hub that serves the WRONG bytes lands nothing', async () => {
    // The hub may refuse to serve; it must never be able to substitute.
    const hub = fakeHub({ 'system/ds/brand.css': 'real' });
    hub.rows.set('system/ds/brand.css', {
      ...hub.rows.get('system/ds/brand.css')!,
      body: 'TAMPERED',
    });
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual([]);
    expect(existsSync(join(root, 'system/ds/brand.css'))).toBe(false);
    expect(res.failed[0]?.reason).toContain('hash mismatch');
    expect(ledger.ancestorOf('system/ds/brand.css')).toBeNull();
  });

  test('a code module is REFUSED unless this machine vouches for the hub', async () => {
    const hub = fakeHub({ 'system/ds/preview/_x.ts': 'export const a = 1' });
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual([]);
    expect(res.dropped[0]?.reason).toContain('owner-vouched');
  });

  test('…and lands when it does', async () => {
    const hub = fakeHub({ 'system/ds/preview/_x.ts': 'export const a = 1' });
    const res = await plane(hub, { allowCodeModules: true }).reconcile();
    expect(res.pulled).toEqual(['system/ds/preview/_x.ts']);
  });

  test('a refusal HOLDS on later passes, when the delta no longer mentions it', async () => {
    // The hole this closes had teeth. Admission used to run only for paths the
    // current page carried — but a cursor read is silent about everything that
    // did not just change. So a code module refused on the pass that
    // introduced it sailed through on the very next tick, sourced from the
    // remembered remote with no gate in front of it. Admission belongs to the
    // OFFER, not to the notification.
    const hub = fakeHub({ 'system/ds/preview/_x.ts': 'export const a = 1' });
    const first = await plane(hub).reconcile();
    expect(first.pulled).toEqual([]);
    expect(first.dropped.length).toBe(1);

    const second = await plane(hub).reconcile();
    expect(second.pulled).toEqual([]);
    expect(second.dropped.length).toBe(1);
    expect(existsSync(join(root, 'system/ds/preview/_x.ts'))).toBe(false);

    const third = await plane(hub).reconcile();
    expect(third.pulled).toEqual([]);
  });

  test('a path THIS peer classifies differently is dropped, not negotiated', async () => {
    // `config.json` is `never` here whatever the hub says about it.
    const hub = fakeHub({ 'config.json': '{"evil":true}' });
    const res = await plane(hub).reconcile();
    expect(res.dropped.some((d) => d.rel === 'config.json')).toBe(true);
    expect(read('config.json')).toContain('canvasGroups');
  });

  test('a refused path is reported but never becomes a stored row', async () => {
    // A hostile page used to cost two persistent writes per junk path — one
    // from `noteRemote` before any classifier ran, one from the `stuck` row
    // after — neither pruned by count, both surviving a restart, and both
    // re-walked in the union on every later pass.
    const hub = fakeHub();
    for (let i = 0; i < 200; i++) hub.add(`junk/payload-${i}.exe`, 'x');
    const p = plane(hub);
    const res = await p.reconcile();

    expect(res.dropped.length).toBeGreaterThan(0);
    const receipt = p.doruceka();
    const stored = Object.keys(receipt).filter((k) => k.startsWith('junk/'));
    expect(stored).toEqual([]);
  });
});

describe('up — we have something the hub does not', () => {
  test('it uploads with a "hub must hold nothing" precondition', async () => {
    const hub = fakeHub();
    write('system/ds/brand.css', 'mine');
    const res = await plane(hub).reconcile();
    expect(res.pushed).toEqual(['system/ds/brand.css']);
    expect(hub.puts[0]?.expect).toBe('none');
    expect(ledger.ancestorOf('system/ds/brand.css')).toBe(sha('mine'));
  });

  test('a local edit uploads with the hub state we decided FROM', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile(); // pull v1, ancestor = v1
    write('system/ds/brand.css', 'v2');
    const res = await plane(hub).reconcile();
    expect(res.pushed).toEqual(['system/ds/brand.css']);
    expect(hub.puts.at(-1)?.expect).toBe(sha('v1'));
  });

  test('a hub that LOST a file gets it back — absence is not authority', async () => {
    // The real shape of this, and the reason it needs a rewind rather than a
    // deletion: the journal is APPEND-ONLY, so a hub cannot quietly drop a
    // row. A file vanishes from its side only when the log itself rewinds —
    // a restore from an older generation whose tail could not be replayed.
    // That rewind is exactly what makes our cursor unhonourable, so the pass
    // re-anchors, reads the whole compaction, and only THEN is entitled to
    // conclude the hub no longer has the file.
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    expect(read('system/ds/brand.css')).toBe('v1');

    hub.rewindTo(0); // the generation predates the file entirely
    const res = await plane(hub).reconcile();

    expect(res.reanchored).toBe(true);
    expect(res.pushed).toEqual(['system/ds/brand.css']);
    expect(read('system/ds/brand.css')).toBe('v1');
  });

  test('a DELTA silence is never read as "the hub lost it"', async () => {
    // The counterpart, and the bug this guards: a cursor read returns only
    // what changed. If silence meant absence, every converged file would be
    // re-uploaded on every single pass.
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    const second = await plane(hub).reconcile();
    expect(second.pushed).toEqual([]);
    expect(second.pulled).toEqual([]);
  });
});

describe('the compare-and-swap is what makes concurrency safe', () => {
  test('a push against a moved hub is REFUSED and reported, not forced', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    // Both sides move: we edit, and someone else lands v2 on the hub.
    write('system/ds/brand.css', 'mine');
    hub.add('system/ds/brand.css', 'theirs');
    // Decide from the STALE view by pushing before re-reading.
    const p = plane(hub);
    // First pass sees theirs and conflicts (both moved).
    const res = await p.reconcile();
    expect(res.conflicts.length).toBe(1);
    // The local version is parked where a person can find it…
    const parked = readdirSync(join(root, 'system/ds')).find((n) => n.includes('maude-conflict'));
    expect(parked).toBeDefined();
    expect(readFileSync(join(root, 'system/ds', parked!), 'utf8')).toBe('mine');
    // …and the hub's version is what sits at the canonical path.
    expect(read('system/ds/brand.css')).toBe('theirs');
  });

  test('the conflict copy travels UP, so both ends see it', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    write('system/ds/brand.css', 'mine');
    hub.add('system/ds/brand.css', 'theirs');
    await plane(hub).reconcile();
    const uploaded = hub.puts.find((p) => p.rel.includes('maude-conflict'));
    expect(uploaded?.body).toBe('mine');
  });

  test('a conflict copy is NEVER named like Syncthing’s', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    write('system/ds/brand.css', 'mine');
    hub.add('system/ds/brand.css', 'theirs');
    await plane(hub).reconcile();
    const names = readdirSync(join(root, 'system/ds'));
    expect(names.some((n) => n.includes('maude-conflict'))).toBe(true);
    expect(names.some((n) => n.includes('sync-conflict'))).toBe(false);
  });
});

describe('the converged steady state is free', () => {
  test('a second pass moves nothing and reports agreement', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1', 'assets/a.png': 'PNG' });
    await plane(hub).reconcile();
    const second = await plane(hub).reconcile();
    expect(second.pulled).toEqual([]);
    expect(second.pushed).toEqual([]);
    expect(second.synced).toBeGreaterThan(0);
  });

  test('and it costs ONE journal read, from the cursor', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    const before = ledger.cursor();
    expect(before).toBe(hub.head());
    const asked: string[] = [];
    const counting = (async (url: string, init?: RequestInit) => {
      asked.push(String(url));
      return hub.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    await plane(hub, { fetchImpl: counting }).reconcile();
    expect(asked.filter((u) => u.includes('/api/journal')).length).toBe(1);
    expect(asked.some((u) => u.includes('/_project-file/'))).toBe(false);
  });
});

describe('re-anchoring fails CLOSED', () => {
  test('a foreign epoch re-reads from zero rather than assuming quiet', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    // The hub's log restarted under a new epoch.
    ledger.setPosition('epoch-OLD', 99);
    const res = await plane(hub).reconcile();
    expect(res.reanchored).toBe(true);
    expect(ledger.epoch()).toBe('epoch-1');
  });

  test('a degraded epoch never overwrites local work — it parks theirs beside it', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    write('system/ds/brand.css', 'my unsent work');
    // Pretend our anchor belongs to a log the hub no longer has, WITHOUT
    // going through the reanchor path (the degraded-read case).
    ledger.setPosition('epoch-GONE', 0);
    hub.add('system/ds/brand.css', 'their newer');
    const res = await plane(hub, { fetchImpl: hub.fetchImpl }).reconcile();
    // Either way the local bytes survive; that is the invariant.
    expect(read('system/ds/brand.css')).not.toBe('their newer');
    expect(res.pulled).toEqual([]);
  });
});

describe('the doručenka answers "where is this file"', () => {
  test('a pulled file reads on-hub; an unsent one reads local-only', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    write('assets/local.png', 'only here');
    const p = plane(hub);
    await p.reconcile();
    const states = p.doruceka();
    expect(states['system/ds/brand.css']).toBe('on-hub');
    // It was pushed in the same pass, so it is on the hub too — the point is
    // that NOTHING reads as delivered without having got there.
    expect(['on-hub', 'local-only']).toContain(states['assets/local.png']);
  });

  test('a CONVERGED file reads on-hub, not local-only', async () => {
    // The lie this closes, seen live in a local run: a delta never mentions a
    // settled file, so reading the page instead of the remembered remote made
    // every converged file report `local-only` — a panel saying "not
    // delivered" about files that had been on the hub for hours.
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const p = plane(hub);
    await p.reconcile();
    await p.reconcile(); // the converged pass, where the delta is silent
    expect(p.doruceka()['system/ds/brand.css']).toBe('on-hub');
  });

  test('a REFUSED path says it is refused, not that it is merely local', async () => {
    // A refusal outranks everything (DDR-214). A code module this peer
    // declines is not "local-only" — it is not here, and will not be.
    const hub = fakeHub({ 'system/ds/preview/_x.ts': 'export const a = 1' });
    const p = plane(hub);
    await p.reconcile();
    expect(p.doruceka()['system/ds/preview/_x.ts']).toBe('stuck');
  });

  test('a failure is named, not swallowed', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const broken = (async (url: string, init?: RequestInit) => {
      if (String(url).includes('/_project-file/')) return new Response('no', { status: 500 });
      return hub.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const p = plane(hub, { fetchImpl: broken });
    const res = await p.reconcile();
    expect(res.failed.length).toBe(1);
    expect(p.doruceka()['system/ds/brand.css']).toBe('stuck');
    expect(ledger.row('system/ds/brand.css')?.reason).toContain('500');
  });
});

describe('deletion stays OFF until its breakers ship', () => {
  test('a file deleted here is HELD — neither resurrected nor propagated', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    rmSync(join(root, 'system/ds/brand.css'));
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual([]); // not resurrected
    expect(hub.rows.has('system/ds/brand.css')).toBe(true); // not deleted upstream
    expect(existsSync(join(root, 'system/ds/brand.css'))).toBe(false);
  });

  test('but an EDIT still beats a delete', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    await plane(hub).reconcile();
    rmSync(join(root, 'system/ds/brand.css'));
    hub.add('system/ds/brand.css', 'somebody edited it');
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual(['system/ds/brand.css']);
    expect(read('system/ds/brand.css')).toBe('somebody edited it');
  });
});

describe('the F6 budget applies to this lane too', () => {
  test('a pass stops on bytes and resumes next time', async () => {
    const hub = fakeHub({
      'system/ds/a.css': 'x'.repeat(400),
      'system/ds/b.css': 'y'.repeat(400),
      'system/ds/c.css': 'z'.repeat(400),
    });
    const first = await plane(hub, { maxPassBytes: 900 }).reconcile();
    expect(first.pulled.length).toBe(2);
    expect(first.budgetExhausted).toBe(true);
    const second = await plane(hub, { maxPassBytes: 900 }).reconcile();
    expect(second.pulled.length).toBe(1);
  });

  // The budget caps a TRANSFER, not a claim. `size` is the hub's number, and
  // the hub is untrusted (DDR-054) — a row declaring 0 for a 512 MB body is
  // one field away from landing 100 GB in a pass against a budget that never
  // moved. So the wire is charged, not the row.
  test('an understated size does not buy a bigger transfer', async () => {
    const hub = fakeHub({
      'system/ds/a.css': 'x'.repeat(400),
      'system/ds/b.css': 'y'.repeat(400),
      'system/ds/c.css': 'z'.repeat(400),
    });
    hub.understateSizes();
    const pass = await plane(hub, { maxPassBytes: 900 }).reconcile();
    expect(pass.budgetExhausted).toBe(true);
    expect(pass.pulled.length).toBeLessThan(3);
  });

  test('a body larger than the whole budget is refused before it is buffered', async () => {
    const hub = fakeHub({ 'system/ds/a.css': 'x'.repeat(4000) });
    hub.understateSizes();
    const pass = await plane(hub, { maxPassBytes: 100 }).reconcile();
    expect(pass.pulled.length).toBe(0);
    expect(pass.failed.length + (pass.budgetExhausted ? 1 : 0)).toBeGreaterThan(0);
  });
});

describe("the receiver defends its own root, not just the hub's", () => {
  test('a symlinked intermediate directory cannot land bytes outside the root', async () => {
    // Lexical traversal is refused upstream by the classifier's shape gate, so
    // this is the case that was genuinely uncovered: `writeFileSync` and
    // `renameSync` follow DIRECTORY symlinks happily, and the hub defends this
    // on its own write surfaces while the receiver did not.
    const outside = mkdtempSync(join(tmpdir(), 'plane-outside-'));
    mkdirSync(join(root, 'system'), { recursive: true });
    symlinkSync(outside, join(root, 'system/escaped'), 'dir');

    const hub = fakeHub({ 'system/escaped/stolen.css': 'PAYLOAD' });
    const res = await plane(hub).reconcile();

    expect(existsSync(join(outside, 'stolen.css'))).toBe(false);
    expect(res.pulled).toEqual([]);
    expect(res.failed.length + res.dropped.length).toBeGreaterThan(0);
  });

  test('a pull into directories that do not exist yet keeps its full path', async () => {
    // The fresh-link case, and the bug the containment fix introduced: the
    // deepest EXISTING ancestor of `system/deep/nested/a.css` in an empty tree
    // is the design root itself, so resolving to that and appending the
    // basename produced `<root>/a.css`. Every file in a first sync would have
    // landed flattened at the top level.
    const hub = fakeHub({ 'system/deep/nested/a.css': '.deep{}' });
    const res = await plane(hub).reconcile();

    expect(res.pulled).toEqual(['system/deep/nested/a.css']);
    expect(read('system/deep/nested/a.css')).toBe('.deep{}');
    expect(existsSync(join(root, 'a.css'))).toBe(false);
  });

  test('refuses to replace a directory sitting where a file belongs', async () => {
    mkdirSync(join(root, 'system/ds/brand.css'), { recursive: true });
    const hub = fakeHub({ 'system/ds/brand.css': ':root{}' });
    const res = await plane(hub).reconcile();
    expect(res.pulled).toEqual([]);
    expect(statSync(join(root, 'system/ds/brand.css')).isDirectory()).toBe(true);
  });
});

describe('a hub that re-anchors forever is not obeyed forever', () => {
  test('the storm limit holds the pass instead of parking a copy per tick', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'theirs' });
    write('system/ds/brand.css', 'mine');
    const p = plane(hub);

    // Every request answers `reanchor`, which is the shape a hostile hub uses
    // to keep `degraded` true and make every diverged path park a fresh copy.
    hub.alwaysReanchor();

    let held = false;
    for (let i = 0; i < REANCHOR_STORM_LIMIT + 3; i++) {
      const res = await p.reconcile();
      if (res.reanchorHeld) held = true;
    }
    expect(held).toBe(true);
    expect(read('system/ds/brand.css')).toBe('mine');
  });

  test('F-11: the hold is a window, not a brick — a retry is allowed after recovery', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'theirs' });
    write('system/ds/brand.css', 'mine');
    let clock = 1_700_000_000_000;
    const p = plane(hub, { now: () => clock });
    hub.alwaysReanchor();

    // Drive it into the held state.
    let lastHeld = false;
    for (let i = 0; i < REANCHOR_STORM_LIMIT + 3; i++) {
      lastHeld = (await p.reconcile()).reanchorHeld === true;
    }
    expect(lastHeld).toBe(true);

    // Still inside the window: held again — the storm stays capped.
    clock += 60_000;
    expect((await p.reconcile()).reanchorHeld).toBe(true);

    // Past the window: exactly one fresh attempt happens (not held). The hub
    // still answers reanchor, so nothing lands — but the plane is provably not
    // bricked until a restart, which is what F-11 reported.
    clock += REANCHOR_HOLD_RECOVERY_MS;
    expect((await p.reconcile()).reanchorHeld).not.toBe(true);
  });

  test('the degraded park happens once per remote hash, not once per pass', async () => {
    // Converge first, so there is a real ancestor to be degraded away from.
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const p = plane(hub);
    await p.reconcile();
    expect(read('system/ds/brand.css')).toBe('v1');

    // Now both sides move, and the hub's log restarts — a legitimate event
    // (DDR-226 §3), not only a hostile one. Under `degraded` the ancestor
    // stops being overwrite authority, so their copy is parked beside ours.
    write('system/ds/brand.css', 'mine');
    hub.add('system/ds/brand.css', 'theirs');
    hub.rotateEpoch();

    const first = await p.reconcile();
    expect(first.reanchored).toBe(true);
    expect(first.conflicts.length).toBe(1);
    const parkedHub = readdirSync(join(root, 'system/ds')).filter((f) => f.includes('-hub.css'));
    expect(parkedHub.length).toBe(1);

    // The bug was UNBOUNDED: the decision is `noop`, so the ancestor never
    // moves and the next pass finds the identical state — and the copy name
    // carries a millisecond stamp, so every pass wrote a NEW file, which was
    // then scanned as `create-up` and uploaded back. Settling is the property.
    for (let i = 0; i < 6; i++) await p.reconcile();
    const after = readdirSync(join(root, 'system/ds')).filter((f) => f.includes('-hub.css'));
    expect(after).toEqual(parkedHub);

    const last = await p.reconcile();
    expect(last.conflicts).toEqual([]);
  });

  test('a repeated degraded pass re-parks nothing — the remote hash is remembered', async () => {
    // The memo, exercised directly. `alwaysReanchor` would hit the storm
    // breaker after five, which would mask the thing under test; this stays
    // under it, so what stops the second park is the memo and only the memo.
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const p = plane(hub);
    await p.reconcile();

    write('system/ds/brand.css', 'mine');
    hub.add('system/ds/brand.css', 'theirs');

    hub.reanchorFor(1);
    const first = await p.reconcile();
    expect(first.conflicts.length).toBe(1);

    // Degraded again, same remote hash, still under the storm limit.
    hub.reanchorFor(1);
    const second = await p.reconcile();
    const copies = readdirSync(join(root, 'system/ds')).filter((f) => f.includes('-hub.css'));
    expect(copies.length).toBe(1);
    expect(second.conflicts.some((c) => c.copy?.includes('-hub.css'))).toBe(false);
  });
});

describe('F2/F3 — plane disjointness survives a fresh link', () => {
  // The synthesis line for this gate reads "empty-tree in-group `.css`
  // classifies canvas-owned by default". The shipped classifier does the
  // OPPOSITE on purpose, and the reason is an RCA: defaulting group css to
  // canvas-owned is what lost five real stylesheets (`brand.css`,
  // `_layout.css` — files with no sibling body at all, which would then travel
  // on no lane whatsoever). Defaulting to the flowing side is recoverable; the
  // other direction silently drops content.
  //
  // What has to be true for that choice to be safe is not the default but the
  // CONVERGENCE: the moment the body exists, the css must leave the file plane,
  // so the two lanes never both own it for longer than one pass.
  test('a sibling-less css flows, and the file plane releases it once the body lands', async () => {
    const hub = fakeHub({ 'ui/home.css': '.a{}' });
    const p = plane(hub);

    const first = await p.reconcile();
    expect(first.pulled).toEqual(['ui/home.css']);

    // Plane A delivers the body — the canvas doc lane, which this plane never
    // touches. From here the css is that canvas's Yjs lane, not a file.
    write('ui/home.tsx', 'export default null');

    const second = await p.reconcile();
    expect(second.pulled).toEqual([]);
    const scanned = scanLocalFiles(root, ledger, [{ path: 'system' }, { path: 'ui' }]);
    expect(scanned.has('ui/home.css')).toBe(false);
  });

  test('a design-system stylesheet with no body anywhere keeps flowing — the RCA case', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': ':root{}', 'system/ds/preview/_layout.css': 'x' });
    const res = await plane(hub).reconcile();
    expect(res.pulled.sort()).toEqual(['system/ds/brand.css', 'system/ds/preview/_layout.css']);
  });

  test('config.json is never a plane member in either direction', async () => {
    // The seed-before-first-pull half: a synced config is a hub rewriting the
    // hub URL and the canvas groups — its own trust anchors.
    write('config.json', '{"canvasGroups":[{"path":"system"},{"path":"ui"}],"mine":true}');
    const hub = fakeHub({ 'config.json': '{"evil":true}' });
    const res = await plane(hub).reconcile();
    expect(res.pushed).toEqual([]);
    expect(read('config.json')).toContain('"mine"');
  });
});

describe('deletion propagates — Increment 6', () => {
  const propagating = (hub: ReturnType<typeof fakeHub>) => plane(hub, { propagateDeletes: true });

  test('gone here, unchanged there ⇒ the hub is told, and the row is a tombstone', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': ':root{}' });
    const p = propagating(hub);
    await p.reconcile();
    expect(existsSync(join(root, 'system/ds/brand.css'))).toBe(true);

    rmSync(join(root, 'system/ds/brand.css'));
    const res = await p.reconcile();

    expect(res.deleted.map((d) => d.rel)).toEqual(['system/ds/brand.css']);
    expect(hub.deletes).toEqual(['system/ds/brand.css']);
  });

  test('gone here, but CHANGED there ⇒ an edit beats a delete and the file comes back', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const p = propagating(hub);
    await p.reconcile();

    rmSync(join(root, 'system/ds/brand.css'));
    hub.add('system/ds/brand.css', 'v2'); // somebody edited it meanwhile

    const res = await p.reconcile();
    expect(hub.deletes).toEqual([]);
    expect(read('system/ds/brand.css')).toBe('v2');
    expect(res.deleted).toEqual([]);
  });

  test('the hub deleted it and we never touched it ⇒ quarantined, never unlinked', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': ':root{}' });
    const p = propagating(hub);
    await p.reconcile();

    hub.tombstone('system/ds/brand.css');
    const res = await p.reconcile();

    expect(existsSync(join(root, 'system/ds/brand.css'))).toBe(false);
    const parked = res.deleted[0]?.parked;
    expect(parked?.startsWith('_trash/')).toBe(true);
    expect(read(parked as string)).toBe(':root{}');
  });

  test('the hub deleted it but WE changed it ⇒ kept and pushed back', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': 'v1' });
    const p = propagating(hub);
    await p.reconcile();

    write('system/ds/brand.css', 'mine');
    hub.tombstone('system/ds/brand.css');

    const res = await p.reconcile();
    expect(read('system/ds/brand.css')).toBe('mine');
    expect(res.deleted).toEqual([]);
    expect(hub.puts.some((x) => x.rel === 'system/ds/brand.css' && x.body === 'mine')).toBe(true);
  });

  test('off ⇒ an absence propagates nothing, which is the pre-Increment-6 posture', async () => {
    const hub = fakeHub({ 'system/ds/brand.css': ':root{}' });
    const p = plane(hub, { propagateDeletes: false });
    await p.reconcile();
    rmSync(join(root, 'system/ds/brand.css'));
    const res = await p.reconcile();
    expect(hub.deletes).toEqual([]);
    expect(res.deleted).toEqual([]);
  });
});

describe('the deletion breakers — the only protection now that this ships ON', () => {
  test("a branch switch does not become everyone else's deletion", async () => {
    const seeded: Record<string, string> = {};
    for (let i = 0; i < 20; i++) seeded[`system/ds/f${i}.css`] = `.a${i}{}`;
    const hub = fakeHub(seeded);
    const p = plane(hub, { propagateDeletes: true });
    await p.reconcile();

    // `git checkout other-branch` — the design folder empties.
    for (let i = 0; i < 20; i++) rmSync(join(root, `system/ds/f${i}.css`));

    const res = await p.reconcile();
    expect(hub.deletes).toEqual([]);
    expect(res.deleteHeld?.direction).toBe('out');
    expect(res.deleteHeld?.count).toBe(20);
  });

  test('a tombstone storm does not empty this disk either', async () => {
    const seeded: Record<string, string> = {};
    for (let i = 0; i < 20; i++) seeded[`system/ds/f${i}.css`] = `.a${i}{}`;
    const hub = fakeHub(seeded);
    const p = plane(hub, { propagateDeletes: true });
    await p.reconcile();

    for (let i = 0; i < 20; i++) hub.tombstone(`system/ds/f${i}.css`);

    const res = await p.reconcile();
    expect(res.deleteHeld?.direction).toBe('in');
    expect(existsSync(join(root, 'system/ds/f0.css'))).toBe(true);
    expect(res.deleted).toEqual([]);
  });

  test('a patient drain is caught too — the budget remembers across passes', async () => {
    // The finding this exists for: the first breaker counted ONE PASS and
    // reset. Two per pass was under every arm of it at every project size, so
    // a hub poking every 10s could remove a file every five seconds forever
    // and never trip anything. A rate limit is the wrong control for a
    // cumulative harm.
    const seeded: Record<string, string> = {};
    for (let i = 0; i < 60; i++) seeded[`system/ds/f${i}.css`] = `.a${i}{}`;
    const hub = fakeHub(seeded);
    const p = plane(hub, { propagateDeletes: true });
    await p.reconcile();

    let applied = 0;
    let held = false;
    // Two at a time — deliberately under the burst arm AND under the
    // proportion arm (2/60 is 3%), which is exactly the attacker's cadence.
    for (let round = 0; round < 20 && !held; round++) {
      hub.tombstone(`system/ds/f${round * 2}.css`);
      hub.tombstone(`system/ds/f${round * 2 + 1}.css`);
      const res = await p.reconcile();
      applied += res.deleted.length;
      if (res.deleteHeld) held = true;
    }

    expect(held).toBe(true);
    expect(applied).toBeLessThanOrEqual(DELETE_BUDGET_PER_WINDOW);
  });

  test('the budget survives a restart — a new plane over the same ledger still remembers', async () => {
    const seeded: Record<string, string> = {};
    for (let i = 0; i < 60; i++) seeded[`system/ds/f${i}.css`] = `.a${i}{}`;
    const hub = fakeHub(seeded);
    await plane(hub, { propagateDeletes: true }).reconcile();

    for (let round = 0; round < 20; round++) {
      hub.tombstone(`system/ds/f${round * 2}.css`);
      hub.tombstone(`system/ds/f${round * 2 + 1}.css`);
      // A FRESH plane each round, as a restarted dev-server would be. The
      // ledger is the same, and the budget lives there — otherwise "restart
      // the app" is the bypass.
      const res = await plane(hub, { propagateDeletes: true }).reconcile();
      if (res.deleteHeld) {
        expect(round).toBeGreaterThan(0);
        return;
      }
    }
    throw new Error('the budget did not survive being reconstructed');
  });

  test('an ordinary single delete is not a storm', async () => {
    const seeded: Record<string, string> = {};
    for (let i = 0; i < 20; i++) seeded[`system/ds/f${i}.css`] = `.a${i}{}`;
    const hub = fakeHub(seeded);
    const p = plane(hub, { propagateDeletes: true });
    await p.reconcile();

    rmSync(join(root, 'system/ds/f3.css'));
    const res = await p.reconcile();
    expect(res.deleteHeld).toBeUndefined();
    expect(hub.deletes).toEqual(['system/ds/f3.css']);
  });
});

// ── The wall (issue #109) ───────────────────────────────────────────────────
//
// A 429 is not a failure, it is an instruction — and it is the one refusal
// where retrying is what causes it. The shipped plane read every non-ok status
// as `HTTP <n>`, kept firing the rest of the pass at a shut door, and (because
// the cursor only advances on a clean pass) came back 400 ms later with the
// identical work set. Every asset of a linked project refused, forever, while
// the status bar said `synced` and a person saw broken images.
//
// The asset lane learned this in 2026-08-11. These are the tests that stop the
// file plane having to learn it a third time.
describe('rate limits', () => {
  /** Wrap a hub so some routes answer 429, and count what reached the wire. */
  function metered(
    hub: ReturnType<typeof fakeHub>,
    opts: { refuse: (pathname: string) => number | null; retryAfter?: string | null } = {
      refuse: () => null,
    }
  ) {
    const calls: string[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(u.pathname);
      const status = opts.refuse(u.pathname);
      if (status !== null) {
        const headers: Record<string, string> = { 'content-type': 'application/json' };
        const retryAfter = opts.retryAfter === undefined ? '30' : opts.retryAfter;
        if (retryAfter !== null) headers['retry-after'] = retryAfter;
        return new Response(JSON.stringify({ error: 'rate limit exceeded' }), { status, headers });
      }
      return hub.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    return {
      fetchImpl,
      calls,
      files: () => calls.filter((c) => c.startsWith('/_project-file/')),
      journals: () => calls.filter((c) => c === '/api/journal'),
    };
  }

  const remoteSet = (n: number) => {
    const files: Record<string, string> = {};
    for (let i = 0; i < n; i += 1) files[`system/ds/f${i}.css`] = `.a${i}{}`;
    return files;
  };

  test('the first refusal ends the pass — the rest is not fired at a shut door', async () => {
    const hub = fakeHub(remoteSet(5));
    const wire = metered(hub, { refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null) });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();

    // ONE file request, not five. Before the fix every remaining path was
    // asked for, and each one kept the bucket empty a little longer.
    expect(wire.files()).toHaveLength(1);
    expect(result.rateLimited).toBeTruthy();
    expect(result.rateLimited?.retryAfterMs).toBe(30_000);
    // And it says how much is still coming, so a person is told the size of
    // the pause instead of reading a status line that claims `synced`.
    expect(result.rateLimited?.waiting).toBe(4);
  });

  test('the refusal names the WALL, not just a number', async () => {
    const hub = fakeHub(remoteSet(1));
    const wire = metered(hub, { refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null) });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();
    // "HTTP 429" alone is what made the 2026-08-11 RCA reconstruct the cause
    // from edge logs. A hub saying "rate limit exceeded" and an edge that never
    // reached the hub are different bugs.
    expect(result.failed[0]?.reason).toContain('429');
    expect(result.failed[0]?.reason).toContain('rate limit exceeded');
  });

  test('and the WHOLE PLANE waits out the window the hub named', async () => {
    const hub = fakeHub(remoteSet(5));
    const wire = metered(hub, { refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null) });
    let clock = 1_700_000_000_000;
    const p = plane(hub, { fetchImpl: wire.fetchImpl, now: () => clock });

    await p.reconcile();
    const afterFirst = wire.calls.length;

    // Inside the window: NOT ONE REQUEST — not even the cursor read, which
    // draws on the same bucket we are waiting to refill.
    clock += 29_000;
    const held = await p.reconcile();
    expect(wire.calls.length).toBe(afterFirst);
    expect(held.rateLimited).toBeTruthy();
    expect(held.pulled).toEqual([]);

    // Past it, the plane goes back to work — and now the hub is willing.
    clock += 2_000;
    const wire2 = metered(hub, { refuse: () => null });
    const p2 = plane(hub, { fetchImpl: wire2.fetchImpl, now: () => clock });
    const done = await p2.reconcile();
    expect(done.rateLimited).toBeUndefined();
    expect(done.pulled.length).toBe(5);
  });

  test('a bare 429 — no header at all — still pauses, for the default window', async () => {
    // The un-upgraded hub. The fleet rolls only on a release tag, so a client
    // that only understands `Retry-After` still storms every hub older than it.
    const hub = fakeHub(remoteSet(3));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null),
      retryAfter: null,
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();
    expect(result.rateLimited?.retryAfterMs).toBe(60_000);
  });

  test('a nonsense Retry-After is not obeyed literally', async () => {
    const hub = fakeHub(remoteSet(3));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null),
      retryAfter: '86400',
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();
    // Clamped to the hub's own window. A day-long pause is a bricked plane
    // with extra steps, and a hub should not be able to ask for one.
    expect(result.rateLimited?.retryAfterMs).toBe(60_000);
  });

  test('and a hub cannot talk us out of pausing at all', async () => {
    // The header is HUB-CONTROLLED, and `0.001` is a perfectly valid number of
    // seconds. A one-millisecond hold is not a hold: a hub that refuses
    // everything and asks us straight back puts the client into the same
    // refusal loop this whole fix exists to end, while it believes it is
    // being obedient. Clamped at both ends, not just the top.
    const hub = fakeHub(remoteSet(3));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 429 : null),
      retryAfter: '0.001',
    });
    let clock = 1_700_000_000_000;
    const p = plane(hub, { fetchImpl: wire.fetchImpl, now: () => clock });

    const first = await p.reconcile();
    expect(first.rateLimited?.retryAfterMs).toBe(1_000);

    // And the hold is real: a pass 100 ms later still does not reach the wire.
    const afterFirst = wire.calls.length;
    clock += 100;
    await p.reconcile();
    expect(wire.calls.length).toBe(afterFirst);
  });

  test('a refusal on the CURSOR READ holds the plane too', async () => {
    // The cursor read shares the hub's per-label read bucket with the file
    // pulls, so during a rate limit this is the request that meets the wall
    // FIRST — and it used to collapse to a bare null, indistinguishable from a
    // quiet do-nothing pass.
    const hub = fakeHub(remoteSet(3));
    const wire = metered(hub, { refuse: (p) => (p === '/api/journal' ? 429 : null) });
    let clock = 1_700_000_000_000;
    const p = plane(hub, { fetchImpl: wire.fetchImpl, now: () => clock });

    const first = await p.reconcile();
    expect(first.rateLimited).toBeTruthy();
    expect(wire.journals()).toHaveLength(1);

    clock += 1_000;
    await p.reconcile();
    expect(wire.journals()).toHaveLength(1);
  });

  test('the request ceiling bounds a pass that lands NOTHING', async () => {
    // THE DEFECT, isolated. `MAX_FILES_PER_PASS` counted what MOVED, and a
    // failed transfer moves nothing — so the counter stood still and the loop
    // ran to the end of `work`, one request per path, unbounded. A non-429
    // failure is used deliberately: this must hold for any refusal, not only
    // the one that now ends the pass early.
    //
    // 500, and `retryAfter: null`, on purpose. `isBackpressure` treats a 5xx
    // that CARRIES a `Retry-After` as the peer saying "come back at this time"
    // — which ends the pass by design — so a refusal used to exercise the
    // request CEILING has to be one that carries no such instruction. (This
    // test used a bare-looking 503 until `metered` was found to attach
    // `Retry-After: 30` by default, at which point it was testing the hold,
    // not the ceiling.)
    const hub = fakeHub(remoteSet(MAX_REQUESTS_PER_PASS + 120));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 500 : null),
      retryAfter: null,
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();

    expect(wire.files().length).toBe(MAX_REQUESTS_PER_PASS);
    expect(result.requestsExhausted).toBe(true);
    // Nothing landed, nothing was lost, and the pass said so.
    expect(result.pulled).toEqual([]);
    expect(result.rateLimited).toBeUndefined();
  });

  test('a 5xx that CARRIES a Retry-After holds the lane — a starting cell', async () => {
    // The shape Task 5 introduced: a cold cell answers `503 Retry-After` while
    // it obtains storage credentials. Firing this pass's whole request budget
    // into that window is how a slow start becomes a failed one — so the lane
    // holds after the first one, rather than after the two-hundredth.
    const hub = fakeHub(remoteSet(MAX_REQUESTS_PER_PASS + 120));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 503 : null),
      retryAfter: '5',
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();

    expect(wire.files().length).toBe(1);
    expect(result.rateLimited).toBeTruthy();
    expect(result.rateLimited?.cause ?? 'hub-asked').toBe('hub-asked');
    expect(result.requestsExhausted).toBeUndefined();
    // Still nothing lost — the waiting count is what the panel renders.
    expect(result.rateLimited?.waiting).toBeGreaterThan(0);
  });

  test('a BARE 5xx is an ordinary refusal, not a wall', async () => {
    // The other half of the same rule. A cell that genuinely cannot obtain
    // storage answers a bare 503 — a broken deployment, not a busy one — and
    // that must surface per file rather than parking the whole lane.
    const hub = fakeHub(remoteSet(6));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 503 : null),
      retryAfter: null,
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();

    expect(result.rateLimited).toBeUndefined();
    expect(wire.files().length).toBeGreaterThan(1);
  });

  test('an over-cap file is REFUSED locally — never uploaded, never retried', async () => {
    // The two real files this exists for: a 164.9 MB image and a 465.8 MB
    // video, re-uploaded on every pass of every boot against a door that
    // refuses anything over 95 MB — each one burning a request slot forever
    // and landing an anonymous `stuck` no retry could ever clear.
    const hub = fakeHub({});
    // Above the door's declared ceiling, which is itself at the narrowest value
    // a hub is believed for (`MIN_TRUSTED_MAX_FILE_BYTES`) — a smaller one is
    // refused as hostile, see the test below.
    write('assets/huge.png', 'x'.repeat(MIN_TRUSTED_MAX_FILE_BYTES + 1024));
    const wire = metered(hub, { refuse: () => null });
    const limitsAware = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) {
        return new Response(JSON.stringify({ maxFileBytes: MIN_TRUSTED_MAX_FILE_BYTES }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;

    const result = await plane(hub, { fetchImpl: limitsAware }).reconcile();

    // Not one byte offered to the door.
    expect(wire.calls.filter((c) => c.includes('huge.bin'))).toEqual([]);
    // Refused, not failed: the panel must not invite a retry that cannot work.
    expect(result.failed).toEqual([]);
    expect(result.dropped.some((d) => d.rel === 'assets/huge.png')).toBe(true);
    const reason = result.dropped.find((d) => d.rel === 'assets/huge.png')?.reason ?? '';
    // It names BOTH numbers — a limit without the actual size is unactionable.
    expect(reason).toMatch(/Too big/i);
    expect(reason).toMatch(/MB/);
    expect(ledger.row('assets/huge.png')?.state).toBe('refused');

    // T29 — HOW MUCH is not here, not just how many. A count cannot tell a
    // blocked CSS sidecar from a blocked half-gigabyte video, and an operator
    // reading `failed: 1` has no way to know which one they are looking at.
    const blocked = plane(hub, { fetchImpl: limitsAware }).blocked();
    expect(blocked?.files).toBe(1);
    expect(blocked?.bytes).toBeGreaterThan(MIN_TRUSTED_MAX_FILE_BYTES);
    expect(blocked?.byClass['too-large']?.files).toBe(1);
    // Bounded by the blocked CLASS, never by path.
    expect(Object.keys(blocked?.byClass ?? {})).toEqual(['too-large']);
  });

  test('a refused over-cap file that is then removed is no longer reported (plan T31/L22)', async () => {
    // The panel kept saying "1 file — too big for this workspace" after the
    // file was gone from the machine: nothing was held any more, but the
    // refused row outlived its file.
    const hub = fakeHub({});
    write('assets/huge.png', 'x'.repeat(MIN_TRUSTED_MAX_FILE_BYTES + 1024));
    const limitsAware = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) {
        return new Response(JSON.stringify({ maxFileBytes: MIN_TRUSTED_MAX_FILE_BYTES }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return hub.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const p = plane(hub, { fetchImpl: limitsAware });
    await p.reconcile();
    expect(ledger.row('assets/huge.png')?.state).toBe('refused');
    rmSync(join(root, 'assets/huge.png'));
    await p.reconcile();
    expect(ledger.row('assets/huge.png') ?? null).toBeNull();
    expect(p.doruceka()['assets/huge.png']).toBeUndefined();
  });

  test('an old hub with no /api/file-limits still works — the fallback holds', async () => {
    const hub = fakeHub({});
    write('assets/small.png', 'ok');
    const wire = metered(hub, { refuse: () => null });
    const notFound = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) return new Response('nope', { status: 404 });
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const result = await plane(hub, { fetchImpl: notFound }).reconcile();
    expect(result.pushed).toContain('assets/small.png');
  });

  // T32 scale run: a whole team behind one address spent the per-IP allowance
  // for /api/file-limits; the 429 left the client on the fallback ceiling and
  // every large video was parked as "too big" for good.
  test('a refused limits read never parks a large file as too big', async () => {
    const hub = fakeHub({});
    // Over the fallback single-request ceiling (sparse, no real bytes).
    write('assets/big.mp4', '');
    const fd = openSync(join(root, 'assets/big.mp4'), 'a');
    ftruncateSync(fd, DEFAULT_HUB_MAX_FILE_BYTES + 1024);
    closeSync(fd);
    const wire = metered(hub, { refuse: () => null });
    const limited = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits'))
        return new Response('too many requests', { status: 429 });
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const result = await plane(hub, { fetchImpl: limited }).reconcile();
    expect(result.dropped.some((d) => d.rel === 'assets/big.mp4')).toBe(false);
    expect(ledger.row('assets/big.mp4')?.state).not.toBe('refused');
  });

  test('a 507 holds the LANE and names the allowance, not a failure', async () => {
    const hub = fakeHub({});
    write('system/ds/assets/a.png', 'aaa');
    write('system/ds/assets/b.png', 'bbb');
    const wire = metered(hub, {
      refuse: (pth) => (pth.startsWith('/api/file/') ? 507 : null),
      retryAfter: null,
    });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();

    // A quota is a WALL, with its own word: the credential is fine and the
    // file is fine, and the only answer is the next window.
    expect(result.rateLimited).toBeTruthy();
    expect(result.rateLimited?.cause).toBe('quota');
    expect(result.failed).toEqual([]);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.dropped[0]?.reason).toMatch(/allowance/i);
  });

  test('a 401 asks for ONE fresh credential and stops the pass', async () => {
    // The plane had NO 401 handling: a refused credential fell through the
    // generic path as a per-path `HTTP 401 — unauthorized`, so a token that
    // expired mid-seed produced hundreds of stuck files and nothing anywhere
    // asked for a new one. Renewal was reachable only from the doc lane's
    // WebSocket auth failure — and a converged doc lane has none left to fail.
    const hub = fakeHub(remoteSet(40));
    const wire = metered(hub, {
      refuse: (p) => (p.startsWith('/_project-file/') ? 401 : null),
      retryAfter: null,
    });
    let renewals = 0;
    const result = await plane(hub, {
      fetchImpl: wire.fetchImpl,
      onAuthFailure: () => {
        renewals += 1;
      },
    }).reconcile();

    expect(result.authRefused).toBe(true);
    expect(renewals).toBe(1);
    // ONE request, not forty: every remaining one would be refused the same way.
    expect(wire.files()).toHaveLength(1);
    // And the reason is ours, not the door's status line.
    expect(result.failed[0]?.reason ?? '').not.toContain('401');
  });

  test('a delivered file counts as progress — the renewal cap must see it', async () => {
    // `renewalsSinceProgress` counted only doc handshakes, so a long seed
    // against a converged doc lane exhausted the cap and the runtime stopped
    // renewing while the file plane was still working.
    const hub = fakeHub({});
    write('assets/p.png', 'PNG');
    let progress = 0;
    const result = await plane(hub, {
      onProgress: () => {
        progress += 1;
      },
    }).reconcile();
    expect(result.pushed.length).toBeGreaterThan(0);
    expect(progress).toBe(1);
  });

  test('a pass that delivers NOTHING does not claim progress', async () => {
    const hub = fakeHub({});
    let progress = 0;
    await plane(hub, {
      onProgress: () => {
        progress += 1;
      },
    }).reconcile();
    expect(progress).toBe(0);
  });

  test('THE 2026-09-03 INCIDENT: a restarting cell must not be fed', async () => {
    // The measured shape, replayed. A cell minting R2 credentials on every
    // request tripped the Cloudflare account rate limit; the 429 arrived as an
    // opaque 502; the cell fail-closed and restarted; and the client answered
    // by re-attempting the identical set at full rate — 314 PUTs across 44
    // unique paths in 10 seconds, one sponsor logo 24 times, while an 8.8 GB
    // project moved ZERO files across two runs.
    //
    // The property under test is the client's half: whatever the peer is
    // doing, this machine must not be the thing keeping it down.
    const hub = fakeHub(remoteSet(60));
    let clock = 1_700_000_000_000;
    // The cell is down until it has settled — a wall-clock recovery, which is
    // what a restart loop actually looks like from the client's side.
    const cellUpAt = clock + 5_500;
    const calls: string[] = [];
    const scripted = (async (url: string, init?: RequestInit) => {
      const u = new URL(String(url));
      calls.push(u.pathname);
      if (u.pathname.startsWith('/_project-file/') && clock < cellUpAt) {
        // Exactly what Task 5's starting cell now answers.
        return new Response(JSON.stringify({ error: 'starting up' }), {
          status: 503,
          headers: { 'content-type': 'application/json', 'retry-after': '5' },
        });
      }
      return hub.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;

    const p = plane(hub, { fetchImpl: scripted, now: () => clock });
    const first = await p.reconcile();

    // ONE file request against a peer that said "come back", not sixty.
    const fileCalls = calls.filter((c) => c.startsWith('/_project-file/'));
    expect(fileCalls).toHaveLength(1);
    expect(first.rateLimited).toBeTruthy();
    // And the panel can say why, and how much is still coming.
    expect(first.rateLimited?.waiting).toBeGreaterThan(0);
    // Crucially NOT `synced` — the failure that hid this for two runs was a
    // status line that read healthy while nothing moved.
    expect(first.pulled).toEqual([]);

    // Inside the window: not one request. The retries were what kept the door
    // shut, so the fix has to be measurable as silence.
    const afterFirst = calls.length;
    clock += 4_000;
    await p.reconcile();
    expect(calls.length).toBe(afterFirst);

    // Past it, the lane goes back to work by itself — no restart, no
    // intervention. A hold that needs a human is a stall with extra steps.
    clock += 2_000;
    const done = await p.reconcile();
    expect(done.rateLimited).toBeUndefined();
    expect(done.pulled.length).toBeGreaterThan(0);
  });

  test('THE 2026-09-03 INCIDENT: an unreachable peer reads as ONE wall', async () => {
    // 484 of 803 undelivered files carried Bun's own connect-failure text as
    // their user-facing reason, so the panel showed hundreds of individually
    // broken files instead of one workspace that was not answering.
    const hub = fakeHub(remoteSet(40));
    const dead = (async (url: string) => {
      if (String(url).includes('/_project-file/')) {
        throw new Error('Unable to connect. Is the computer able to access the url?');
      }
      return hub.fetchImpl(url as never, undefined as never);
    }) as unknown as typeof fetch;

    const result = await plane(hub, { fetchImpl: dead }).reconcile();

    // The lane holds after a short streak rather than draining its ceiling.
    expect(result.rateLimited?.cause).toBe('unreachable');
    // And no user-facing reason quotes the runtime.
    for (const f of result.failed) {
      expect(f.reason).not.toContain('typo');
      expect(f.reason).not.toContain('url');
    }
  });

  test('a HOSTILE ceiling cannot declare a project unsendable', async () => {
    // DDR-054: the hub is untrusted to peers. `/api/file-limits` hands it a
    // lever nothing else does — a `maxFileBytes` of 1 would push every file
    // into the terminal `refused` state, i.e. a peer telling you your own disk
    // is permanently unsendable. Below our floor, the answer is not believed.
    const hub = fakeHub({});
    write('assets/ordinary.png', 'PNG');
    const wire = metered(hub, { refuse: () => null });
    const hostile = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) {
        return new Response(JSON.stringify({ maxFileBytes: 1 }), {
          headers: { 'content-type': 'application/json' },
        });
      }
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const result = await plane(hub, { fetchImpl: hostile }).reconcile();
    expect(result.pushed).toContain('assets/ordinary.png');
    expect(result.dropped).toEqual([]);
  });

  test('a HOSTILE quota reset cannot park the lane for a year', async () => {
    const hub = fakeHub({});
    write('assets/a.png', 'aaa');
    const far = 1_700_000_000_000 + 365 * 24 * 3_600_000;
    const wire = metered(hub, {
      refuse: (pth) => (pth.startsWith('/api/file/') ? 507 : null),
      retryAfter: null,
    });
    const hostile = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) {
        return new Response(
          JSON.stringify({ maxFileBytes: 95 * 1024 * 1024, quotaResetsAt: far }),
          {
            headers: { 'content-type': 'application/json' },
          }
        );
      }
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    const now = 1_700_000_000_000;
    const result = await plane(hub, { fetchImpl: hostile, now: () => now }).reconcile();
    expect(result.rateLimited).toBeTruthy();
    // Bounded: a hostile peer buys a delay, never a stop.
    expect(result.rateLimited!.until - now).toBeLessThanOrEqual(MAX_TRUSTED_QUOTA_PAUSE_MS);
  });

  test('a spent quota at boot does NOT strand the client forever', async () => {
    // The bug this pins: `quotaUsed` is a point-in-time reading, and the limits
    // were asked for exactly once per boot. A client that started while the
    // allowance was nearly spent computed a headroom of ~0 and then refused
    // every upload for the rest of the process's life — long after the hub's
    // hourly window had reset. A stale ceiling is a slow client; a stale quota
    // reading is a client that has silently stopped.
    const hub = fakeHub({});
    write('assets/a.png', 'aaa');
    let clock = 1_700_000_000_000;
    const windowEnds = clock + 60_000;
    let asked = 0;
    const wire = metered(hub, { refuse: () => null });
    const quotaAware = (async (url: string, init?: RequestInit) => {
      if (String(url).endsWith('/api/file-limits')) {
        asked += 1;
        const spent = clock < windowEnds;
        return new Response(
          JSON.stringify({
            maxFileBytes: 95 * 1024 * 1024,
            quotaBytesPerWindow: 1024,
            quotaUsed: spent ? 1024 : 0,
            quotaResetsAt: windowEnds,
          }),
          { headers: { 'content-type': 'application/json' } }
        );
      }
      return wire.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;

    const p = plane(hub, { fetchImpl: quotaAware, now: () => clock });
    const first = await p.reconcile();
    expect(first.pushed).toEqual([]);
    expect(asked).toBe(1);

    // The window rolls. The client must ASK AGAIN rather than keep believing
    // the reading it took while the allowance was spent.
    clock = windowEnds + 1;
    const second = await p.reconcile();
    expect(asked).toBe(2);
    expect(second.pushed).toContain('assets/a.png');
  });

  test('a healthy pass is untouched by any of it', async () => {
    const hub = fakeHub(remoteSet(4));
    const wire = metered(hub, { refuse: () => null });
    const result = await plane(hub, { fetchImpl: wire.fetchImpl }).reconcile();
    expect(result.pulled.length).toBe(4);
    expect(result.rateLimited).toBeUndefined();
    expect(result.requestsExhausted).toBeUndefined();
    expect(result.failed).toEqual([]);
  });
});

// Audit 2026-09-13 P1 #4 / plan T4 — a file over the plane's 512 MiB ceiling
// was dropped by the scan BEFORE the ledger. Missing from the inventory, it
// was also indistinguishable from a local delete: a synced asset that grew past
// the ceiling looked "gone here", and a hub copy looked "missing here".
describe('a local file over the plane ceiling', () => {
  // The project-file ceiling (plan T18 raised it from 512 MiB), plus one.
  const OVER = MAX_FILE_BYTES + 1;
  const grow = (rel: string) => {
    const abs = join(root, rel);
    mkdirSync(join(abs, '..'), { recursive: true });
    const fd = openSync(abs, 'a');
    try {
      ftruncateSync(fd, OVER); // sparse — no real bytes on disk
    } finally {
      closeSync(fd);
    }
  };

  test('is enumerated as present but unsyncable, never hashed', () => {
    write('assets/small.svg', '<svg/>');
    grow('assets/large.mp4');
    const scanned = scanLocalFiles(root, ledger);
    expect(scanned.get('assets/small.svg')?.hash).toBe(sha('<svg/>'));
    expect(scanned.get('assets/large.mp4')).toMatchObject({
      oversized: true,
      hash: null,
      size: OVER,
    });
  });

  test('a synced asset that grows past it is never propagated as a delete', async () => {
    const hub = fakeHub({ 'assets/clip.mp4': 'v1' });
    const p = plane(hub, { propagateDeletes: true });
    await p.reconcile();
    expect(read('assets/clip.mp4')).toBe('v1');

    grow('assets/clip.mp4');
    const res = await p.reconcile();

    expect(hub.deletes).toEqual([]);
    expect(hub.puts).toEqual([]);
    expect(res.deleted).toEqual([]);
    expect(statSync(join(root, 'assets/clip.mp4')).size).toBe(OVER);
    expect(ledger.row('assets/clip.mp4')).toMatchObject({
      state: 'refused',
      blockedClass: 'too-large',
    });
  });

  test('a hub copy never overwrites the larger local file', async () => {
    grow('assets/clip.mp4');
    const hub = fakeHub({ 'assets/clip.mp4': 'small hub copy' });
    const p = plane(hub);
    await p.reconcile();
    expect(statSync(join(root, 'assets/clip.mp4')).size).toBe(OVER);
    expect(hub.puts).toEqual([]);
    expect(ledger.row('assets/clip.mp4')?.state).toBe('refused');
  });
});

// Plan T19 — a project opens usefully before its big media arrives: within a
// pass, smaller files come down first (after the ones a canvas references).
describe('pull order', () => {
  test('small files before a large one', async () => {
    const hub = fakeHub({
      'assets/master.mp4': 'V'.repeat(200_000),
      'assets/a.png': 'a',
      'assets/b.png': 'bb',
    });
    const order: string[] = [];
    const watching = (async (url: string | URL, init?: RequestInit) => {
      const u = new URL(String(url));
      if (u.pathname.startsWith('/_project-file/'))
        order.push(decodeURIComponent(u.pathname.slice('/_project-file/'.length)));
      return hub.fetchImpl(String(url), init);
    }) as unknown as typeof fetch;
    await plane(hub, { fetchImpl: watching }).reconcile();
    expect(order).toEqual(['assets/a.png', 'assets/b.png', 'assets/master.mp4']);
  });
});
