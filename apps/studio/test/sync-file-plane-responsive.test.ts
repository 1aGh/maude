// Issue #207 (fix #7, 2.0.7) — a file-plane pass that hashes and uploads large
// files must leave the studio answering.
//
// Michal's desktop uploading thousands of Blender renders answered `/_health`
// in 10–20 s for the whole of every pass, at 2.5 GB of RSS, with the main
// thread in memmove. Two causes, both on the event loop: the scan hashed every
// uncached file in one synchronous run, and each upload body was the whole file
// as one buffer (copied twice over TLS). These pin the fixed shape against a
// REAL hub (spawned under Node — Bun cannot load the hub's better-sqlite3).

import { afterAll, beforeAll, expect, test } from 'bun:test';
import { type ChildProcess, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger } from '../sync/file-ledger.ts';
import { createFilePlane, hashFileStreamed, sha256File } from '../sync/file-plane.ts';

const HUB_DIR = join(import.meta.dir, '..', '..', 'hub');
const FIXTURE = join(HUB_DIR, 'test', 'fixtures', 'serve-hub.mjs');
const HUB_READY = existsSync(join(HUB_DIR, 'node_modules', 'better-sqlite3'));
if (!HUB_READY) {
  console.warn('[sync-file-plane-responsive] real-hub test SKIPPED — apps/hub deps not installed.');
}
const MIB = 1024 * 1024;

let work: string;
beforeAll(() => {
  work = mkdtempSync(join(tmpdir(), 'plane-responsive-'));
});
afterAll(() => rmSync(work, { recursive: true, force: true }));

interface Hub {
  proc: ChildProcess;
  http: string;
  tokens: Record<string, string>;
}

function startHub(dataDir: string, repoDir: string): Promise<Hub> {
  return new Promise((resolve, reject) => {
    const proc = spawn('node', [FIXTURE, dataDir, '0', '--asset-write-rate-limit', '100000'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // A workspace-mode hub, as a cell runs: it holds a checkout, so it accepts file writes.
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

/**
 * A probe in ANOTHER process: a blocked loop here cannot hide its own latency
 * (an in-process probe is blocked by the same run it is trying to measure).
 */
function startProbe(url: string): { stop: () => Promise<number[]> } {
  const proc = spawn(
    'node',
    [
      '-e',
      `const u=process.argv[1];const lat=[];let stop=false;process.on('SIGTERM',()=>{stop=true});
(async()=>{while(!stop){const t=performance.now();try{await fetch(u,{signal:AbortSignal.timeout(60000)}).then(r=>r.text())}catch{}
lat.push(performance.now()-t);await new Promise(r=>setTimeout(r,50))}process.stdout.write(JSON.stringify(lat));process.exit(0)})()`,
      url,
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
  );
  let out = '';
  proc.stdout?.on('data', (c: Buffer) => {
    out += c.toString('utf8');
  });
  return {
    stop: () =>
      new Promise((resolve) => {
        proc.once('exit', () => resolve(JSON.parse(out || '[]') as number[]));
        proc.kill('SIGTERM');
      }),
  };
}

/** Random bytes behind a PNG signature, written in 8 MiB pieces (the test never holds a file whole). */
function writeRender(abs: string, size: number): void {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  writeFileSync(abs, sig);
  const piece = randomBytes(8 * MIB);
  let left = size - sig.length;
  while (left > 0) {
    const n = Math.min(left, piece.length);
    writeFileSync(abs, piece.subarray(0, n), { flag: 'a' });
    piece[0] = (piece[0] as number) ^ 0xff; // no two pieces alike
    left -= n;
  }
}

test.skipIf(!HUB_READY)(
  'the studio answers in under a second while a pass hashes and uploads large renders',
  async () => {
    const root = join(work, 'design');
    const seq = join(root, 'ideas', 'renders', 'draft1', 'flythrough');
    mkdirSync(seq, { recursive: true });
    // ~800 MB of renders the ledger has never seen: before the fix the scan
    // hashed all of it in one synchronous run (~1.5–2 s here, minutes on a real
    // project) before the first upload left.
    const files = 9;
    for (let i = 0; i < files; i += 1) {
      writeRender(join(seq, `${String(i).padStart(4, '0')}.png`), 90 * MIB);
    }
    mkdirSync(join(work, 'hubrepo', '.design'), { recursive: true });
    const hub = await startHub(join(work, 'hub'), join(work, 'hubrepo'));
    const health = Bun.serve({ port: 0, fetch: () => Response.json({ ok: true }) });
    try {
      const ledger = createFileLedger({ designRoot: root, hubUrl: hub.http });
      const plane = createFilePlane({
        designRoot: root,
        hubUrl: hub.http,
        token: () => hub.tokens.owner as string,
        ledger,
        allowCodeModules: false,
        label: 'responsive',
        log: { log() {}, warn() {} },
      });
      const probe = startProbe(`http://127.0.0.1:${health.port}/_health`);
      await Bun.sleep(300); // the probe is answering before the pass starts
      const res = await plane.reconcile();
      const lat = await probe.stop();

      expect(res.failed).toEqual([]);
      expect(res.pushed.length).toBe(files);
      // Every byte reached the hub's checkout intact.
      const landed = join(work, 'hubrepo', '.design', 'ideas', 'renders', 'draft1', 'flythrough');
      const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
      expect(sha(join(landed, '0004.png'))).toBe(sha(join(seq, '0004.png')));

      expect(lat.length).toBeGreaterThan(5);
      expect(Math.max(...lat)).toBeLessThan(1000);
    } finally {
      health.stop(true);
      hub.proc.kill('SIGTERM');
    }
  },
  120_000
);

test('a large upload body streams from disk — never the whole file as one buffer', async () => {
  const root = join(work, 'stream-body');
  mkdirSync(join(root, 'assets'), { recursive: true });
  const rel = 'assets/render.png';
  writeRender(join(root, rel), 4 * MIB);
  const seen: { body: unknown; length: string | null }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      return Response.json({ epoch: 'e1', head: 0, entries: [], truncated: false });
    }
    if (u.pathname.startsWith('/api/file/') && init.method === 'PUT') {
      seen.push({ body: init.body, length: new Headers(init.headers).get('content-length') });
      await new Response(init.body).arrayBuffer(); // drain it, as a door would
      return Response.json({ ok: true, seq: 1 });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  const plane = createFilePlane({
    designRoot: root,
    hubUrl: 'https://hub.test',
    token: () => 'tok',
    ledger: createFileLedger({ designRoot: root, hubUrl: 'https://hub.test', flushMs: 0 }),
    allowCodeModules: false,
    label: 'laptop',
    fetchImpl,
    log: { log() {}, warn() {} },
  });
  const res = await plane.reconcile();
  expect(res.pushed).toEqual([rel]);
  expect(seen).toHaveLength(1);
  expect(seen[0]?.body).toBeInstanceOf(ReadableStream);
  expect(seen[0]?.length).toBe(String(4 * MIB));
});

test('hashing a large file holds its read-ahead, not the file', async () => {
  const abs = join(work, 'big.bin');
  writeRender(abs, 256 * MIB);
  Bun.gc(true);
  const before = process.memoryUsage().rss;
  let peak = before;
  const tick = setInterval(() => {
    peak = Math.max(peak, process.memoryUsage().rss);
  }, 2);
  const got = await hashFileStreamed(abs);
  clearInterval(tick);
  peak = Math.max(peak, process.memoryUsage().rss);
  expect(got).toBe(sha256File(abs));
  rmSync(abs);
  // A whole-file read is 256 MB on its own; the stream measured ~30 MB.
  expect(peak - before).toBeLessThan(128 * MIB);
});
