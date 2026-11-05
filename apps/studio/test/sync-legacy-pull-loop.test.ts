// 2.0.5 hotfix — the legacy (v1 manifest) file pull loop.
//
// Field report (2026-11-05, studyfi-design ↔ design.studyfi.com): the boot's
// `/health` probe timed out, the runtime fell back to the legacy lane on a
// ledger hub, and the 20 s poll started a NEW `pullFiles` pass every tick while
// the previous ones were still downloading from a slow hub. Each pass chose the
// SAME first 200 missing files (the ones in flight were not on disk yet), held
// every body in memory and re-hashed every local file whole: one core pinned,
// RSS 2–4 GB, and the "missing" count moved by ~20 a pass.
//
// The rules these tests pin:
//   (a) a file counts as pulled only once it is on disk with the promised hash;
//   (b) a refused or failed write is held with its reason and is NOT asked for
//       again on the very next pass;
//   (c) passes never overlap, and a pass that made no progress backs off;
//   (d) a body is streamed to disk, never held whole.

import { describe, expect, test } from 'bun:test';

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { classifyProjectFile } from '../sync/file-membership.ts';
import {
  createLegacyPullGate,
  createPullFailureMemory,
  type FilePullResult,
  pullFiles,
} from '../sync/file-pull.ts';

const sha = (b: Uint8Array | string): string => createHash('sha256').update(b).digest('hex');
const silent = { log: () => {}, warn: () => {} };

/** A Blender asset folder, deep, whose parents do not exist on this disk. */
function blenderTree(): Record<string, Uint8Array> {
  const out: Record<string, Uint8Array> = {};
  const base = 'ui/studyfi/ideas/mascot-exploration/blender';
  const font = (n: number) => new Uint8Array(4096).fill(n);
  out[`${base}/assets/fonts/GeneralSans-Bold.ttf`] = font(1);
  out[`${base}/assets/fonts/HankenGrotesk-Medium.ttf`] = font(2);
  out[`${base}/assets/kenney_furniture/Preview.png`] = new Uint8Array(70_000).fill(3);
  // A space in a name, at the 8-segment ceiling the classifier allows.
  out[`${base}/assets/kenney_furniture/Sample Furniture.png`] = new Uint8Array(1234).fill(4);
  for (let i = 0; i < 20; i++) {
    out[`${base}/renders/shot_${String(i).padStart(2, '0')}.png`] = new Uint8Array(3000 + i).fill(
      10 + i
    );
  }
  return out;
}

/**
 * A fake hub. Bodies are served as STREAMS whose `arrayBuffer()` throws, so a
 * lane that buffers a whole body fails loudly (rule d).
 */
function makeHub(files: Record<string, Uint8Array>) {
  const fetched: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    if (u.endsWith('/api/files')) {
      const list = Object.entries(files).map(([p, b]) => ({
        path: p,
        sha256: sha(b),
        size: b.byteLength,
        mtimeMs: 1_000_000,
        class: classifyProjectFile(p),
      }));
      return new Response(JSON.stringify({ files: list }), { status: 200 });
    }
    const m = u.match(/\/_project-file\/(.+)$/);
    if (!m) return new Response('nf', { status: 404 });
    const rel = (m[1] ?? '').split('/').map(decodeURIComponent).join('/');
    fetched.push(rel);
    const body = files[rel];
    if (!body) return new Response('nf', { status: 404 });
    const res = new Response(
      new ReadableStream({
        start(c) {
          // Two chunks, so a streaming writer really sees a stream.
          const mid = Math.floor(body.byteLength / 2);
          c.enqueue(body.slice(0, mid));
          c.enqueue(body.slice(mid));
          c.close();
        },
      }),
      { status: 200 }
    );
    Object.defineProperty(res, 'arrayBuffer', {
      value: () => Promise.reject(new Error('buffered the whole body')),
    });
    return res;
  }) as typeof fetch;
  return { fetchImpl, fetched };
}

function pull(
  root: string,
  fetchImpl: typeof fetch,
  extra: Partial<Parameters<typeof pullFiles>[0]> = {}
) {
  return pullFiles({
    designRoot: root,
    hubUrl: 'http://hub.test',
    token: () => 'tok',
    allowCodeModules: false,
    fetchImpl,
    log: silent,
    ...extra,
  });
}

describe('legacy pull — a deep tree whose folders do not exist here', () => {
  test('every file lands with its hash, streamed, and the next pass fetches nothing', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-legacy-loop-'));
    try {
      const files = blenderTree();
      const hub = makeHub(files);
      const first = await pull(root, hub.fetchImpl);
      expect(first.failed).toEqual([]);
      expect(first.dropped).toEqual([]);
      expect(first.conflicts).toEqual([]);
      expect(first.pulled.length).toBe(Object.keys(files).length);
      for (const [rel, body] of Object.entries(files)) {
        expect(sha(readFileSync(path.join(root, rel)))).toBe(sha(body));
      }
      hub.fetched.length = 0;
      const second = await pull(root, hub.fetchImpl);
      expect(second.pulled).toEqual([]);
      expect(second.skipped).toBe(Object.keys(files).length);
      expect(hub.fetched).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('legacy pull — a write that cannot land is held, not re-asked every pass', () => {
  test('a file in the way of a folder: failed once, held with its reason, not fetched again', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-legacy-held-'));
    try {
      const files = blenderTree();
      // A plain FILE where the `fonts` folder must go: mkdir -p cannot succeed.
      const blocker = path.join(root, 'ui/studyfi/ideas/mascot-exploration/blender/assets/fonts');
      mkdirSync(path.dirname(blocker), { recursive: true });
      writeFileSync(blocker, 'not a folder');
      const hub = makeHub(files);
      const failures = createPullFailureMemory();
      let t = 1_000_000;
      const now = () => t;

      const first = await pull(root, hub.fetchImpl, { failures, now });
      const fontRels = Object.keys(files).filter((r) => r.includes('/fonts/'));
      expect(first.failed.map((f) => f.rel).sort()).toEqual(fontRels.sort());
      // Rule (a): nothing that failed is counted as pulled.
      for (const r of fontRels) expect(first.pulled).not.toContain(r);

      hub.fetched.length = 0;
      t += 20_000; // the next poll tick
      const second = await pull(root, hub.fetchImpl, { failures, now });
      // Rule (b): not asked for again on the next pass…
      expect(hub.fetched.filter((r) => r.includes('/fonts/'))).toEqual([]);
      // …and visible, with a reason a person can act on.
      expect(second.held?.map((h) => h.rel).sort()).toEqual(fontRels.sort());
      expect(second.held?.[0]?.reason).toMatch(/\S/);
      expect(second.wanted).toBe(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('a new version of a held file is tried again at once', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'maude-legacy-held2-'));
    try {
      const rel = 'docs/a.png';
      const files: Record<string, Uint8Array> = { [rel]: new Uint8Array(10).fill(1) };
      const failures = createPullFailureMemory();
      failures.noteFailed(rel, sha(files[rel] as Uint8Array), 'HTTP 500', 1000);
      const hub = makeHub(files);
      await pull(root, hub.fetchImpl, { failures, now: () => 2000 });
      expect(hub.fetched).toEqual([]);
      files[rel] = new Uint8Array(11).fill(2);
      await pull(root, hub.fetchImpl, { failures, now: () => 3000 });
      expect(hub.fetched).toEqual([rel]);
      expect(existsSync(path.join(root, rel))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe('legacy pull gate — one pass at a time, and no progress backs off', () => {
  const result = (over: Partial<FilePullResult>): FilePullResult => ({
    pulled: [],
    skipped: 0,
    conflicts: [],
    dropped: [],
    failed: [],
    wanted: 0,
    ...over,
  });

  test('a tick while a pass is in flight starts no second pass', async () => {
    const gate = createLegacyPullGate({ now: () => 0 });
    let release: () => void = () => {};
    let started = 0;
    const slow = () => {
      started += 1;
      return new Promise<FilePullResult>((r) => {
        release = () => r(result({ pulled: ['a'], wanted: 1 }));
      });
    };
    const first = gate.run(slow);
    // Every 20 s tick of a slow pass — the field loop.
    for (let i = 0; i < 8; i++) expect(await gate.run(slow)).toBeNull();
    expect(started).toBe(1);
    release();
    expect((await first)?.pulled).toEqual(['a']);
  });

  test('a pass that wanted files and landed none backs off, doubling, and progress resets it', async () => {
    let t = 0;
    const gate = createLegacyPullGate({ now: () => t, baseMs: 20_000, maxMs: 600_000 });
    let runs = 0;
    let next: FilePullResult = result({ wanted: 200, failed: [{ rel: 'x', reason: 'HTTP 500' }] });
    const pass = async () => {
      runs += 1;
      return next;
    };
    await gate.run(pass);
    expect(runs).toBe(1);
    t += 10_000;
    expect(await gate.run(pass)).toBeNull(); // inside the 20 s backoff
    t += 15_000;
    await gate.run(pass); // 25 s: allowed, fails again → 40 s
    expect(runs).toBe(2);
    t += 30_000;
    expect(await gate.run(pass)).toBeNull();
    t += 15_000;
    next = result({ wanted: 5, pulled: ['a'] });
    await gate.run(pass);
    expect(runs).toBe(3);
    t += 1;
    await gate.run(pass); // progress reset the backoff
    expect(runs).toBe(4);
  });

  test('an unreachable manifest counts as no progress', async () => {
    let t = 0;
    const gate = createLegacyPullGate({ now: () => t, baseMs: 20_000 });
    let runs = 0;
    const pass = async () => {
      runs += 1;
      return result({ unreachable: true });
    };
    await gate.run(pass);
    t += 5_000;
    expect(await gate.run(pass)).toBeNull();
    expect(runs).toBe(1);
  });
});
