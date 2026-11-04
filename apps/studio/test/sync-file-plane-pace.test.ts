// Issue #204 — a large cloud project's FIRST sync to a new Mac took ≈ 1.5 h (5 041 files, 200 per
// pass, one request at a time, the next pass only on the 20 s tick). These pin the pacing that
// replaced it, against a hub fixture that answers the real wire shapes and counts what reaches it:
// bounded concurrency, the follow-up pass, one ledger write per batch, obedience to a 429 and to a
// cold cell's `503 fetching from storage`, held rows that are not "waiting", and the byte budget.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane, MAX_FILES_PER_PASS } from '../sync/file-plane.ts';
import {
  createPullPacer,
  followUpDelayMs,
  PULL_CONCURRENCY_START,
  type PullPacer,
} from '../sync/pull-pacer.ts';
import { activeCanvasWants } from '../sync/pull-priority.ts';
import { CODE_MODULE_HELD_REASON, computeSeedProgress } from '../sync/seed-progress.ts';

const HUB = 'https://hub.test';
const T0 = 1_700_000_000_000;
const sha = (b: string | Uint8Array) => createHash('sha256').update(b).digest('hex');

let root: string;
let persists: number;
let ledger: FileLedger;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-plane-pace-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  writeFileSync(join(root, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
  persists = 0;
  ledger = createFileLedger({
    designRoot: root,
    hubUrl: HUB,
    flushMs: 0,
    onPersist: () => {
      persists += 1;
    },
  });
});
afterEach(() => {
  ledger.stop();
  rmSync(root, { recursive: true, force: true });
});

const tick = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A hub holding `files` (rel → body). Every `/_project-file/` GET takes `delayMs`, and `answer` may
 * replace the bytes with a refusal for a given (rel, attempt).
 */
function hub(
  files: Record<string, string>,
  opts: {
    delayMs?: number;
    answer?: (rel: string, attempt: number) => Response | null;
    cls?: (rel: string) => string;
  } = {}
) {
  const rows = Object.entries(files).map(([path, body], i) => ({
    seq: i + 1,
    path,
    sha256: sha(body),
    size: body.length,
    mtimeMs: 0,
    class: opts.cls?.(path) ?? 'inert-media',
    deleted: false,
  }));
  const attempts = new Map<string, number>();
  const gets: string[] = [];
  let inFlight = 0;
  let peak = 0;
  /** Downloads of the SAME bytes at once (two paths, one content hash). */
  const bytesInFlight = new Map<string, number>();
  let sameBytesPeak = 0;
  const puts: string[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname.startsWith('/api/file/') && init?.method === 'PUT') {
      const rel = u.pathname
        .slice('/api/file/'.length)
        .split('/')
        .map(decodeURIComponent)
        .join('/');
      const body = Buffer.from(init.body as ArrayBuffer).toString('utf8');
      puts.push(rel);
      files[rel] = body;
      const seq = rows.length + 1;
      rows.push({
        seq,
        path: rel,
        sha256: sha(body),
        size: body.length,
        mtimeMs: 0,
        class: opts.cls?.(rel) ?? 'inert-media',
        deleted: false,
      });
      return new Response(JSON.stringify({ ok: true, seq, sha256: sha(body) }), { status: 200 });
    }
    if (u.pathname === '/api/journal') {
      return new Response(
        JSON.stringify({ epoch: 'e1', head: rows.length, entries: rows, truncated: false }),
        { status: 200 }
      );
    }
    if (u.pathname.startsWith('/_project-file/')) {
      const rel = decodeURIComponent(u.pathname.slice('/_project-file/'.length));
      gets.push(rel);
      const n = (attempts.get(rel) ?? 0) + 1;
      attempts.set(rel, n);
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      const key = sha(files[rel] ?? rel);
      bytesInFlight.set(key, (bytesInFlight.get(key) ?? 0) + 1);
      sameBytesPeak = Math.max(sameBytesPeak, bytesInFlight.get(key) ?? 0);
      try {
        await tick(opts.delayMs ?? 0);
        const refused = opts.answer?.(rel, n) ?? null;
        if (refused) return refused;
        const body = files[rel];
        return body === undefined
          ? new Response('nope', { status: 404 })
          : new Response(body, { status: 200 });
      } finally {
        inFlight -= 1;
        bytesInFlight.set(key, (bytesInFlight.get(key) ?? 1) - 1);
      }
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, gets, puts, peak: () => peak, sameBytesPeak: () => sameBytesPeak };
}

function media(n: number, prefix = 'assets/m'): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < n; i += 1) out[`${prefix}${i}.png`] = `PNG-${i}-${'x'.repeat(i % 7)}`;
  return out;
}

function plane(
  h: ReturnType<typeof hub>,
  over: Partial<Parameters<typeof createFilePlane>[0]> & { clock?: () => number } = {}
) {
  return createFilePlane({
    designRoot: root,
    hubUrl: HUB,
    token: () => 'tok',
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    fetchImpl: h.fetchImpl,
    log: { log() {}, warn() {} },
    now: over.clock ?? (() => T0),
    priorityPaths: () => new Set(),
    ...over,
  });
}

describe('downloads run side by side, within a bound', () => {
  test('a first sync fetches several files at once — never more than the pacer allows', async () => {
    const h = hub(media(40), { delayMs: 15 });
    const r = await plane(h).reconcile();

    expect(r.pulled).toHaveLength(40);
    // More than one at a time: the serial lane was the 2–4 minute pass.
    expect(h.peak()).toBeGreaterThan(1);
    // …and never past the cold cell's fill width the pacer starts at.
    expect(h.peak()).toBeLessThanOrEqual(PULL_CONCURRENCY_START);
  });

  test('two paths holding the same bytes are never fetched at once (one staging file per hash)', async () => {
    const files = media(12);
    for (let i = 0; i < 6; i += 1) files[`assets/copy${i}.png`] = 'SAME-BYTES';
    const h = hub(files, { delayMs: 10 });
    const r = await plane(h).reconcile();
    expect(r.pulled).toHaveLength(18);
    expect(h.peak()).toBeGreaterThan(1);
    expect(h.sameBytesPeak()).toBe(1);
  });

  test('the width is the pacer’s: a narrower pacer is obeyed', async () => {
    const h = hub(media(20), { delayMs: 10 });
    const pacer = createPullPacer({ start: 2 });
    await plane(h, { pacer }).reconcile();
    expect(h.peak()).toBe(2);
  });

  test('the first request of a pass is a probe: a shut door sees ONE request', async () => {
    const h = hub(media(30), {
      delayMs: 5,
      answer: () =>
        new Response(JSON.stringify({ error: 'starting' }), {
          status: 503,
          headers: { 'retry-after': '5' },
        }),
    });
    const r = await plane(h).reconcile();
    expect(h.gets).toHaveLength(1);
    expect(r.rateLimited?.cause).toBe('hub-asked');
  });

  test('the count ceiling still bounds a concurrent pass, and says so', async () => {
    const h = hub(media(MAX_FILES_PER_PASS + 30), { delayMs: 1 });
    const r = await plane(h).reconcile();
    expect(h.gets.length).toBe(MAX_FILES_PER_PASS);
    expect(r.pulled).toHaveLength(MAX_FILES_PER_PASS);
    expect(r.filesCapped || r.requestsExhausted).toBe(true);
  });
});

describe('the next pass', () => {
  const timing = { pollMs: 20_000, floorMs: 2_000 };
  const base = { pulled: [] as string[], pushed: [] as string[] };

  test('is immediate while a HEALTHY pass stopped on a count ceiling', () => {
    expect(followUpDelayMs({ ...base, pulled: ['a'], filesCapped: true }, timing)).toBe(0);
    expect(followUpDelayMs({ ...base, pushed: ['a'], requestsExhausted: true }, timing)).toBe(0);
  });

  test('waits for the tick when the pass moved nothing — a failing pass never spins (#109)', () => {
    expect(followUpDelayMs({ ...base, requestsExhausted: true }, timing)).toBeNull();
  });

  test('waits for the tick on a wall or a byte-budget stop', () => {
    const moved = { ...base, pulled: ['a'], filesCapped: true as const };
    expect(followUpDelayMs({ ...moved, rateLimited: { until: 1 } }, timing)).toBeNull();
    expect(followUpDelayMs({ ...moved, authRefused: true }, timing)).toBeNull();
    expect(followUpDelayMs({ ...moved, budgetExhausted: true }, timing)).toBeNull();
    expect(followUpDelayMs({ ...base, pulled: ['a'] }, timing)).toBeNull();
  });

  test('comes back for a short backoff when it ends, never sooner than the floor', () => {
    expect(followUpDelayMs({ ...base, nextAttemptInMs: 5_000 }, timing)).toBe(5_000);
    expect(followUpDelayMs({ ...base, nextAttemptInMs: 300 }, timing)).toBe(2_000);
    expect(followUpDelayMs({ ...base, nextAttemptInMs: 60_000 }, timing)).toBeNull();
  });

  test('uploads too (desktop → cloud): a capped push pass follows up, the next one finishes', async () => {
    // Not symmetric with the pull: pushes stay one at a time (they decide against the hub's CAS),
    // so the follow-up pass is what makes a large first upload fast, not the pool.
    const local = media(MAX_FILES_PER_PASS + 30);
    for (const [rel, body] of Object.entries(local)) writeFileSync(join(root, rel), body);
    const h = hub({});
    const p = plane(h);
    const first = await p.reconcile();
    expect(first.pushed).toHaveLength(MAX_FILES_PER_PASS);
    expect(followUpDelayMs(first, timing)).toBe(0);
    const second = await p.reconcile();
    expect(second.pushed).toHaveLength(30);
    expect(h.puts).toHaveLength(MAX_FILES_PER_PASS + 30);
    expect(followUpDelayMs(second, timing)).toBeNull();
  });

  test('a capped pass reports the cap the runtime follows up on', async () => {
    const h = hub(media(MAX_FILES_PER_PASS + 5));
    const r = await plane(h).reconcile();
    expect(followUpDelayMs(r, timing)).toBe(0);
  });
});

describe('the ledger', () => {
  test('is written once per batch, not once per landing', async () => {
    // flushMs 0: before #204 every landing re-armed the debounce, so a 40-file pass wrote the
    // whole ledger dozens of times (2.3 MB each on a 5 000-file project).
    const h = hub(media(40), { delayMs: 3 });
    const r = await plane(h).reconcile();
    await tick(20);
    expect(r.pulled).toHaveLength(40);
    expect(persists).toBeGreaterThan(0);
    expect(persists).toBeLessThanOrEqual(2);
  });
});

describe('obeying the hub', () => {
  test('a 429 is honoured for its Retry-After, and the next pass runs narrower', async () => {
    let clock = T0;
    const pacer = createPullPacer({ start: 4, now: () => clock });
    const h = hub(media(30), {
      delayMs: 5,
      answer: (rel) =>
        rel === 'assets/m12.png'
          ? new Response(JSON.stringify({ error: 'rate limit exceeded' }), {
              status: 429,
              headers: { 'retry-after': '7' },
            })
          : null,
    });
    const p = plane(h, { pacer, clock: () => clock });
    const r = await p.reconcile();

    expect(r.rateLimited?.retryAfterMs).toBe(7_000);
    expect(r.rateLimited?.until).toBe(T0 + 7_000);
    expect(pacer.limit()).toBe(2);
    // Inside the window not one request leaves — not even the cursor read.
    const before = h.gets.length;
    clock += 6_000;
    await p.reconcile();
    expect(h.gets.length).toBe(before);
  });

  test('a cold cell’s storage miss is retried LATER, per file, and is not delivered', async () => {
    let clock = T0;
    const pacer = createPullPacer({ now: () => clock });
    const h = hub(media(12), {
      delayMs: 2,
      answer: (rel, attempt) =>
        rel === 'assets/m3.png' && attempt === 1
          ? new Response(JSON.stringify({ error: 'fetching from storage', miss: 'timeout' }), {
              status: 503,
              headers: { 'retry-after': '5', 'content-type': 'application/json' },
            })
          : null,
    });
    const p = plane(h, { pacer, clock: () => clock });

    const first = await p.reconcile();
    // The rest of the pass carried on — no plane hold for one slow file.
    expect(first.rateLimited).toBeUndefined();
    expect(first.pulled).toHaveLength(11);
    expect(first.pulled).not.toContain('assets/m3.png');
    expect(first.failed).toEqual([]);
    expect(first.storageMisses).toBe(1);
    expect(existsSync(join(root, 'assets/m3.png'))).toBe(false);
    expect(ledger.isBackedOff('assets/m3.png', clock)).toBe(true);
    // Not delivered, and still on its way (not blocked, not held).
    const progress = computeSeedProgress({ rows: ledger.rows(), now: clock });
    expect(progress.delivered).toBe(11);
    expect(progress.remaining).toBe(1);
    // A storage miss steps the width down.
    expect(pacer.limit()).toBe(PULL_CONCURRENCY_START - 1);

    // Asked again at once? No — the window holds it, and the pass knows when it ends.
    expect(first.nextAttemptInMs).toBeGreaterThan(0);
    const again = await p.reconcile();
    expect(h.gets.filter((g) => g === 'assets/m3.png')).toHaveLength(1);
    expect(again.backedOff).toBe(1);

    // After the window it lands.
    clock += 5_001;
    const later = await p.reconcile();
    expect(later.pulled).toEqual(['assets/m3.png']);
  });

  test('a RUN of storage misses is a wall: the plane holds instead of draining its budget', async () => {
    const h = hub(media(30), {
      delayMs: 1,
      answer: () =>
        new Response(JSON.stringify({ error: 'fetching from storage', miss: 'timeout' }), {
          status: 503,
          headers: { 'retry-after': '5' },
        }),
    });
    const r = await plane(h, { pacer: createPullPacer({ start: 1 }) }).reconcile();
    expect(r.rateLimited?.cause).toBe('hub-asked');
    expect(h.gets.length).toBeLessThan(10);
  });

  test('the request rate stays inside the rolling minute', async () => {
    let clock = T0;
    const waits: number[] = [];
    const pacer: PullPacer = createPullPacer({
      perMinute: 5,
      now: () => clock,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    for (let i = 0; i < 5; i += 1) await pacer.admit('read');
    expect(waits).toEqual([]);
    await pacer.admit('read');
    expect(waits).toEqual([60_000]);
    // Writes have their own bucket on the hub, and their own window here.
    await pacer.admit('write');
    expect(waits).toHaveLength(1);
  });

  test('reads are paced under the ceiling the hub advertises — clamped, it is hub-supplied', async () => {
    const pacer = createPullPacer();
    pacer.setReadCeiling(1800);
    expect(pacer.readsPerMinute()).toBe(1440);
    pacer.setReadCeiling(10 ** 9);
    expect(pacer.readsPerMinute()).toBe(4800);
    pacer.setReadCeiling(1);
    expect(pacer.readsPerMinute()).toBe(48);

    // The plane learns it from /api/file-limits.
    const h = hub(media(3));
    const learned = createPullPacer();
    const withLimits = (async (url: string, init?: RequestInit) => {
      if (new URL(String(url)).pathname === '/api/file-limits') {
        return new Response(
          JSON.stringify({ maxFileBytes: 95 * 1024 * 1024, readsPerMinute: 1800 }),
          { status: 200 }
        );
      }
      return h.fetchImpl(url as never, init as never);
    }) as unknown as typeof fetch;
    await plane(h, { pacer: learned, fetchImpl: withLimits }).reconcile();
    expect(learned.readsPerMinute()).toBe(1440);
  });
});

describe('held rows are not waiting', () => {
  test('a code module this Mac refuses is HELD, not counted as waiting', async () => {
    const files = { ...media(3), 'ui/shared/helper.ts': 'export const x = 1;\n' };
    const h = hub(files, {
      cls: (rel) => (rel.endsWith('.ts') ? 'code-module' : 'inert-media'),
    });
    await plane(h).reconcile();
    const row = ledger.row('ui/shared/helper.ts');
    expect(row?.state).toBe('stuck');
    expect(row?.reason).toBe(CODE_MODULE_HELD_REASON);

    const progress = computeSeedProgress({ rows: ledger.rows(), now: T0 });
    expect(progress.delivered).toBe(3);
    expect(progress.held).toBe(1);
    expect(progress.remaining).toBe(0);
  });

  test('any other stuck row is still waiting', () => {
    const progress = computeSeedProgress({
      rows: {
        a: { syncedHash: 'x', state: 'on-hub' },
        b: { syncedHash: null, state: 'stuck', reason: CODE_MODULE_HELD_REASON },
        c: { syncedHash: null, state: 'stuck', reason: 'HTTP 500' },
      },
      now: T0,
    });
    expect(progress.held).toBe(1);
    expect(progress.remaining).toBe(1);
  });
});

describe('the byte budget', () => {
  test('still caps a concurrent pass — no request leaves past it', async () => {
    const files = media(20);
    const sizes = Object.values(files).map((b) => b.length);
    // Room for exactly the three smallest (the pass goes smallest first).
    const room = [...sizes].sort((a, b) => a - b).slice(0, 3);
    const h = hub(files, { delayMs: 5 });
    const r = await plane(h, { maxPassBytes: room.reduce((a, b) => a + b, 0) }).reconcile();
    expect(r.budgetExhausted).toBe(true);
    expect(r.pulled).toHaveLength(3);
    expect(h.gets).toHaveLength(3);
  });
});

describe('the open canvas first', () => {
  test('its imports and assets jump the queue', async () => {
    mkdirSync(join(root, 'ui/parts'), { recursive: true });
    writeFileSync(
      join(root, 'ui/home.tsx'),
      'import { Card } from \'./parts/card\';\nexport default () => <img src="../assets/hero.jpg" />;\n'
    );
    writeFileSync(
      join(root, 'ui/parts/card.tsx'),
      "import './card.css';\nexport const Card = 1;\n"
    );
    writeFileSync(join(root, '_active.json'), JSON.stringify({ active: 'ui/home.tsx' }));
    const wants = activeCanvasWants(root);
    expect(wants.has('assets/hero.jpg')).toBe(true);
    expect(wants.has('ui/parts/card.tsx')).toBe(true);
    expect(wants.has('ui/parts/card.css')).toBe(true);
    expect(wants.has('ui/home.meta.json')).toBe(true);

    // The hero is the BIGGEST file, so size order alone would fetch it last.
    const files = { ...media(15), 'assets/hero.jpg': 'J'.repeat(4096) };
    const h = hub(files, { delayMs: 2 });
    await plane(h, { priorityPaths: () => activeCanvasWants(root) }).reconcile();
    expect(h.gets[0]).toBe('assets/hero.jpg');
  });

  test('a path outside the design root is never wanted', () => {
    writeFileSync(join(root, '_active.json'), JSON.stringify({ active: '../../etc/passwd' }));
    expect(activeCanvasWants(root).size).toBe(0);
  });
});
