#!/usr/bin/env bun
// Cell materializer — Task 15 E2E: a cell whose project is bigger than its
// cache, synced in BOTH directions, with the hub killed mid-push.
//
// What runs, all from source, all on loopback:
//
//   s3    an in-process S3 fake (path-style; GET/PUT/HEAD/DELETE/List v2 and
//         multipart) — the bucket the cell's write-behind fills and the
//         materializer reads. No signature checks: that is s3.mjs's concern,
//         and this run is about what the HUB does with the bytes.
//   hub   apps/hub/src/server.mjs under Node, in workspace mode, with
//         MAUDE_CELL_MATERIALIZE=1 and a deliberately SMALL cache budget
//         (MAUDE_CACHE_BUDGET_BYTES) so the project does not fit — the
//         2026-10-01 Alligators shape, scaled down.
//   A, B  two DESKTOP peers, driven through the real client code
//         (apps/studio/sync/file-plane.ts + file-ledger.ts), each with its own
//         design root and ledger.
//
// The run:
//   1. A pushes N photos (more bytes than the cache budget). Part-way through,
//      the hub is SIGKILLed, its blob cache wiped (a cell's disk goes with a
//      restart) and restarted on the same data dir. A keeps reconciling.
//   2. B — a clean peer — pulls everything; every byte is verified.
//   3. B adds M photos; A pulls them (the other direction — memory: the two
//      directions are not symmetric).
//   4. Oracles: hub alive after the restart; NO tombstone in the journal; no
//      conflicts on either peer; the cache is within its budget; a photo that
//      was evicted re-materializes (GET /_project-file → 200, right bytes);
//      the studio child serves a canvas whose CSS url() points at media that
//      is not on the checkout, and serves that media.
//
//   bun scripts/dev/cell-materialize-e2e.ts [--work DIR] [--port 5390]
//        [--photos 24] [--back 8] [--photo-kb 96] [--budget-kb 900] [--keep]
//
// Writes a JSON report to <work>/report.json and exits non-zero on any failed
// oracle. Servers boot with NO_OPEN=1 and the studio with MAUDE_NO_AUTOBUILD=1
// (never regenerate the committed bundles from this tree).

import { type ChildProcess, spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFileLedger } from '../../apps/studio/sync/file-ledger.ts';
import { createFilePlane } from '../../apps/studio/sync/file-plane.ts';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (n: string, d: string) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : d;
};
const has = (n: string) => process.argv.includes(`--${n}`);

const PORT = Number(arg('port', '5390'));
const S3_PORT = PORT + 1;
const STUDIO_PORT = PORT + 2;
const PHOTOS = Number(arg('photos', '24'));
const BACK = Number(arg('back', '8'));
const PHOTO_BYTES = Number(arg('photo-kb', '96')) * 1024;
const BUDGET = Number(arg('budget-kb', '900')) * 1024;
const WORK = arg('work', mkdtempSync(join(tmpdir(), 'cell-mat-e2e-')));
const ASSET_DIR = 'system/ds/assets/library';

const sha = (b: Buffer | string) => createHash('sha256').update(b).digest('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const log = (...a: unknown[]) => console.log('[e2e]', ...a);
const oracles: { name: string; ok: boolean; detail?: unknown }[] = [];
const check = (name: string, ok: boolean, detail?: unknown) => {
  oracles.push({ name, ok, ...(detail === undefined ? {} : { detail }) });
  log(
    `${ok ? 'PASS' : 'FAIL'}  ${name}${detail === undefined ? '' : `  ${JSON.stringify(detail)}`}`
  );
};

/* ------------------------------------------------------------- the S3 fake */

const objects = new Map<string, Buffer>();
const uploads = new Map<string, Map<number, Buffer>>();
const etagOf = (b: Buffer) => `"${createHash('md5').update(b).digest('hex')}"`;
const s3Counters = { get: 0, put: 0, head: 0, list: 0 };
/** Fired once, from INSIDE a PUT — so the hub dies while A's pass is still
 *  pushing, not politely between two passes. */
let onPhotoMirrored: ((n: number) => void) | null = null;

async function bodyOf(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.from(c));
  return Buffer.concat(chunks);
}

const s3 = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const u = new URL(req.url ?? '/', 'http://s3');
  // Path style: /<bucket>/<key…>
  const parts = u.pathname.split('/').slice(2).map(decodeURIComponent);
  const key = parts.join('/');
  const q = u.searchParams;
  try {
    if (req.method === 'GET' && !key && q.get('list-type') === '2') {
      s3Counters.list++;
      const prefix = q.get('prefix') ?? '';
      const keys = [...objects.keys()].filter((k) => k.startsWith(prefix)).sort();
      const xml =
        '<ListBucketResult>' +
        keys
          .map(
            (k) =>
              `<Contents><Key>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</Key><Size>${objects.get(k)?.length ?? 0}</Size></Contents>`
          )
          .join('') +
        '<IsTruncated>false</IsTruncated></ListBucketResult>';
      res.writeHead(200, { 'content-type': 'application/xml' }).end(xml);
      return;
    }
    if (req.method === 'POST' && q.has('uploads')) {
      const id = randomBytes(8).toString('hex');
      uploads.set(id, new Map());
      res
        .writeHead(200)
        .end(
          `<InitiateMultipartUploadResult><UploadId>${id}</UploadId></InitiateMultipartUploadResult>`
        );
      return;
    }
    if (req.method === 'PUT' && q.has('uploadId')) {
      const b = await bodyOf(req);
      uploads.get(q.get('uploadId') ?? '')?.set(Number(q.get('partNumber')), b);
      res.writeHead(200, { etag: etagOf(b) }).end();
      return;
    }
    if (req.method === 'POST' && q.has('uploadId')) {
      await bodyOf(req);
      const up = uploads.get(q.get('uploadId') ?? '');
      const whole = Buffer.concat(
        [...(up?.entries() ?? [])].sort((a, b) => a[0] - b[0]).map((e) => e[1])
      );
      objects.set(key, whole);
      uploads.delete(q.get('uploadId') ?? '');
      s3Counters.put++;
      res.writeHead(200).end('<CompleteMultipartUploadResult/>');
      return;
    }
    if (req.method === 'DELETE' && q.has('uploadId')) {
      uploads.delete(q.get('uploadId') ?? '');
      res.writeHead(204).end();
      return;
    }
    if (req.method === 'PUT') {
      const b = await bodyOf(req);
      if (req.headers['if-none-match'] === '*' && objects.has(key)) {
        res.writeHead(412).end();
        return;
      }
      objects.set(key, b);
      s3Counters.put++;
      res.writeHead(200, { etag: etagOf(b) }).end();
      if (key.includes(`/${ASSET_DIR}/`)) {
        onPhotoMirrored?.([...objects.keys()].filter((k) => k.includes(`/${ASSET_DIR}/`)).length);
      }
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      const b = objects.get(key);
      if (!b) {
        res.writeHead(404).end();
        return;
      }
      if (req.method === 'HEAD') {
        s3Counters.head++;
        res.writeHead(200, { 'content-length': b.length, etag: etagOf(b) }).end();
      } else {
        s3Counters.get++;
        res.writeHead(200, { 'content-length': b.length, etag: etagOf(b) }).end(b);
      }
      return;
    }
    if (req.method === 'DELETE') {
      objects.delete(key);
      res.writeHead(204).end();
      return;
    }
    res.writeHead(400).end();
  } catch (err) {
    res.writeHead(500).end(String(err));
  }
});

/* ------------------------------------------------------------- the fixture */

const repoDir = join(WORK, 'cell-repo');
const designRoot = join(repoDir, '.design');
const dataDir = join(WORK, 'cell-data');
const peerRoot = (p: string) => join(WORK, `peer-${p}`, '.design');
const CONFIG = '{"canvasGroups":[{"path":"ui"},{"path":"system"}]}';

function seed() {
  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(join(designRoot, 'ui'), { recursive: true });
  mkdirSync(join(designRoot, 'system/ds'), { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), CONFIG);
  writeFileSync(join(designRoot, 'system/ds/tokens.css'), ':root { --bg: #111; }\n');
  // The canvas the oracle builds: its stylesheet points at photo 0, which the
  // cell will NOT hold on disk (it arrives from peer A into the cache only).
  writeFileSync(
    join(designRoot, 'ui/gallery.tsx'),
    'import \'./gallery.css\';\nexport default () => <main className="hero">gallery</main>;\n'
  );
  writeFileSync(
    join(designRoot, 'ui/gallery.css'),
    `.hero { background: url("../${ASSET_DIR}/p000.jpg"); }\n`
  );
  spawnSync('git', ['init', '-q'], { cwd: repoDir });
  spawnSync('git', ['add', '-A'], { cwd: repoDir });
  spawnSync('git', ['-c', 'user.email=e2e@local', '-c', 'user.name=e2e', 'commit', '-qm', 'seed'], {
    cwd: repoDir,
  });
  for (const p of ['a', 'b']) {
    mkdirSync(join(peerRoot(p), ASSET_DIR), { recursive: true });
    writeFileSync(join(peerRoot(p), 'config.json'), CONFIG);
  }
  for (let i = 0; i < PHOTOS; i++) {
    writeFileSync(
      join(peerRoot('a'), ASSET_DIR, `p${String(i).padStart(3, '0')}.jpg`),
      randomBytes(PHOTO_BYTES)
    );
  }
}

/* ------------------------------------------------------------------ the hub */

let hub: ChildProcess | null = null;
let hubLog = '';
const hubUrl = `http://127.0.0.1:${PORT}`;

function startHub() {
  hub = spawn('node', [join(REPO_ROOT, 'apps/hub/src/server.mjs')], {
    env: {
      ...process.env,
      PORT: String(PORT),
      DATA_DIR: dataDir,
      MAUDE_WORKSPACE_MODE: '1',
      HUB_WORKSPACE_MODE: '1',
      MAUDE_REPO_DIR: repoDir,
      MAUDE_DESIGN_ROOT: '.design',
      HUB_INSECURE_HTTP: '1',
      HUB_SECRET: 'cell-mat-e2e-secret-not-for-production',
      MAUDE_WORKSPACE_ALLOW_DEV_MODULES: '1',
      MAUDE_STUDIO_PORT: String(STUDIO_PORT),
      MAUDE_S3_ENDPOINT: `http://127.0.0.1:${S3_PORT}`,
      MAUDE_S3_BUCKET: 'cell',
      MAUDE_S3_ACCESS_KEY_ID: 'e2e',
      MAUDE_S3_SECRET_ACCESS_KEY: 'e2e',
      MAUDE_CELL_MATERIALIZE: '1',
      MAUDE_CACHE_BUDGET_BYTES: String(BUDGET),
      MAUDE_JOURNAL_WALK_MS: '2000',
      NO_OPEN: '1',
      MAUDE_NO_AUTOBUILD: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  hub.stdout?.on('data', (d) => (hubLog += d));
  hub.stderr?.on('data', (d) => (hubLog += d));
}

async function waitHealthy(timeoutMs = 60_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    try {
      const r = await fetch(`${hubUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (r.status === 200 || r.status === 503) return (await r.json()) as Record<string, unknown>;
    } catch {
      /* not yet */
    }
    await sleep(250);
  }
  throw new Error(`hub never answered /health\n${hubLog.slice(-3000)}`);
}

/* ---------------------------------------------------------------- the peers */

/** Minted under NODE: the token store is better-sqlite3, a native addon Bun
 *  cannot load — and the hub that reads it runs under Node anyway. */
async function mintToken(label: string): Promise<string> {
  const code =
    `import(${JSON.stringify(join(REPO_ROOT, 'apps/hub/src/tokens.mjs'))})` +
    `.then((m) => process.stdout.write(m.addToken(${JSON.stringify(dataDir)}, ` +
    `{ label: ${JSON.stringify(label)}, scope: '*', role: 'owner' }).value))`;
  const r = spawnSync('node', ['--input-type=module', '-e', code], { encoding: 'utf8' });
  if (r.status !== 0 || !r.stdout) throw new Error(`could not mint a token: ${r.stderr}`);
  return r.stdout.trim();
}

function peer(name: string, token: string) {
  const root = peerRoot(name);
  const ledger = createFileLedger({
    designRoot: root,
    hubUrl,
    flushMs: 0,
    log: { log() {}, warn() {}, error() {} } as never,
  });
  const plane = createFilePlane({
    designRoot: root,
    hubUrl,
    token: () => token,
    ledger,
    allowCodeModules: true,
    label: `peer-${name}`,
    log: { log() {}, warn() {} } as never,
  });
  const totals = { pushed: 0, pulled: 0, conflicts: 0, failed: 0, passes: 0 };
  async function pass() {
    const r = await plane.reconcile();
    totals.passes++;
    totals.pushed += r.pushed.length;
    totals.pulled += r.pulled.length;
    totals.conflicts += r.conflicts.length;
    totals.failed += r.failed.length;
    return r;
  }
  return { name, root, ledger, plane, totals, pass };
}

const photosIn = (root: string) =>
  existsSync(join(root, ASSET_DIR))
    ? readdirSync(join(root, ASSET_DIR))
        .filter((n) => n.endsWith('.jpg'))
        .sort()
    : [];

async function settle(
  p: ReturnType<typeof peer>,
  done: () => boolean,
  label: string,
  maxMs = 180_000
) {
  const t0 = Date.now();
  while (Date.now() - t0 < maxMs) {
    const r = await p.pass();
    if (done()) return true;
    // Obey a hold the plane was given (503 Retry-After / 429), bounded.
    const wait = r.rateLimited
      ? Math.min(Math.max(r.rateLimited.until - Date.now(), 200), 5000)
      : 300;
    await sleep(wait);
  }
  log(`${label}: did not settle in ${maxMs} ms`);
  return false;
}

/* ------------------------------------------------------------------- the run */

async function main() {
  seed();
  await new Promise<void>((r) => s3.listen(S3_PORT, '127.0.0.1', () => r()));
  startHub();
  await waitHealthy();
  log(`hub up on ${hubUrl}; work dir ${WORK}`);

  const a = peer('a', await mintToken('peer-a'));
  const b = peer('b', await mintToken('peer-b'));
  const hubPhotos = () =>
    [...objects.keys()].filter((k) => k.startsWith(`files/${ASSET_DIR}/`)).length;

  // 1. A pushes; the hub dies MID-PUSH (from inside the S3 PUT that lands a
  //    third of the photos) and comes back with an empty cache.
  let restarted = false;
  let killedAt = -1;
  onPhotoMirrored = (n) => {
    if (restarted || n < Math.floor(PHOTOS / 3)) return;
    restarted = true;
    killedAt = n;
    log(`killing the hub mid-push (${n} photo(s) in the bucket)`);
    hub?.kill('SIGKILL');
    // A container restart takes the WHOLE process tree; a SIGKILLed hub on a
    // laptop leaves its studio child bound to the port, and the next hub's
    // child then finds a stranger there ("wrong-project").
    spawnSync('sh', ['-c', `lsof -ti tcp:${STUDIO_PORT} | xargs kill -9 2>/dev/null; true`]);
    // A cell's disk goes with a restart: the blob cache does too.
    rmSync(join(dataDir, 'cache'), { recursive: true, force: true });
    setTimeout(() => startHub(), 500);
  };
  const pushedAll = await settle(
    a,
    () => restarted && hubPhotos() >= PHOTOS && photosIn(a.root).length >= PHOTOS,
    'A push'
  );
  onPhotoMirrored = null;
  await waitHealthy();
  check('A pushed every photo across a mid-push hub restart', pushedAll && killedAt < PHOTOS, {
    killedAt,
    pushed: a.totals.pushed,
    failedWhileDown: a.totals.failed,
    inBucket: hubPhotos(),
  });

  // 2. B pulls everything, bytes verified.
  const pulledAll = await settle(b, () => photosIn(b.root).length >= PHOTOS, 'B pull');
  const mismatched = photosIn(peerRoot('a')).filter((n) => {
    const there = join(b.root, ASSET_DIR, n);
    return (
      !existsSync(there) ||
      sha(readFileSync(there)) !== sha(readFileSync(join(peerRoot('a'), ASSET_DIR, n)))
    );
  });
  check(
    'B (a clean peer) pulled every photo, byte-identical',
    pulledAll && mismatched.length === 0,
    {
      pulled: photosIn(b.root).length,
      mismatched: mismatched.slice(0, 5),
    }
  );

  // 3. The other direction: B adds photos, A pulls them.
  for (let i = 0; i < BACK; i++) {
    writeFileSync(
      join(b.root, ASSET_DIR, `b${String(i).padStart(3, '0')}.jpg`),
      randomBytes(PHOTO_BYTES)
    );
  }
  const backPushed = await settle(b, () => hubPhotos() >= PHOTOS + BACK, 'B push');
  const backPulled = await settle(a, () => photosIn(a.root).length >= PHOTOS + BACK, 'A pull');
  check('the OTHER direction: B → cell → A', backPushed && backPulled, {
    aHas: photosIn(a.root).length,
  });

  // 4. Oracles on the hub itself.
  const health = (await (await fetch(`${hubUrl}/health`)).json()) as Record<string, unknown>;
  const up1 = Number(health.uptimeMs);
  await sleep(1500);
  const up2 = Number(
    ((await (await fetch(`${hubUrl}/health`)).json()) as Record<string, unknown>).uptimeMs
  );
  check('no restart loop — uptime grows after the restart', up2 > up1, { up1, up2 });

  const journal = (await (
    await fetch(`${hubUrl}/api/journal?since=0`, {
      headers: { authorization: `Bearer ${await mintToken('oracle')}` },
    })
  ).json()) as { entries: { path: string; deleted: boolean; sha256: string | null }[] };
  const tombstones = journal.entries.filter((e) => e.deleted);
  check('no tombstones — eviction and the restart deleted nothing', tombstones.length === 0, {
    tombstones: tombstones.slice(0, 5).map((t) => t.path),
  });
  check(
    'no conflicts on either peer (no 409 storm)',
    a.totals.conflicts + b.totals.conflicts === 0,
    {
      a: a.totals,
      b: b.totals,
    }
  );

  const blobsDir = join(dataDir, 'cache', 'blobs'); // hub-owned (security review H1)
  const measure = () =>
    existsSync(blobsDir)
      ? readdirSync(blobsDir).reduce((n, f) => n + statSync(join(blobsDir, f)).size, 0)
      : 0;
  // Uploads sit pinned until the write-behind has mirrored them; give the
  // mirror a moment to drain before holding the cache to its budget.
  let cacheBytes = measure();
  for (let i = 0; i < 40 && cacheBytes > BUDGET; i++) {
    await sleep(250);
    cacheBytes = measure();
  }
  // Pins (uploads not yet mirrored) may sit above the budget briefly; after the
  // write-behind has drained, an eviction pass brings the cache under it.
  check('the cache stays within its budget', cacheBytes <= BUDGET, { cacheBytes, budget: BUDGET });
  check(
    'the checkout never received inert media from a peer',
    !existsSync(join(designRoot, ASSET_DIR)) || photosIn(designRoot).length === 0,
    { onCheckout: photosIn(designRoot).length }
  );

  // Evicted media re-materializes: photo 0 was pushed first, so with a budget
  // far smaller than the project it is long gone from the cache.
  const oracleToken = await mintToken('oracle-read');
  const first = `${ASSET_DIR}/p000.jpg`;
  const r0 = await fetch(`${hubUrl}/_project-file/${first}`, {
    headers: { authorization: `Bearer ${oracleToken}` },
  });
  const b0 = Buffer.from(await r0.arrayBuffer());
  check(
    'an evicted photo re-materializes, verified',
    r0.status === 200 && sha(b0) === sha(readFileSync(join(peerRoot('a'), first))),
    {
      status: r0.status,
    }
  );

  // The canvas build: its CSS url() points at media the checkout does not hold.
  const studioHealth = health.studio as Record<string, unknown> | undefined;
  if (studioHealth && studioHealth.ok !== false) {
    const mod = await fetch(`http://127.0.0.1:${STUDIO_PORT}/.design/ui/gallery.tsx`);
    const js = await mod.text();
    check(
      'the canvas builds; its CSS url() is served, not bundled',
      mod.status === 200 && js.includes(`/.design/${ASSET_DIR}/p000.jpg`),
      {
        status: mod.status,
        head: js.slice(0, 120),
      }
    );
    const img = await fetch(`http://127.0.0.1:${STUDIO_PORT}/.design/${first}`);
    const ib = Buffer.from(await img.arrayBuffer());
    check(
      'the studio serves that media from the cache (static route → /_materialize)',
      img.status === 200 && sha(ib) === sha(readFileSync(join(peerRoot('a'), first))),
      {
        status: img.status,
      }
    );
  } else {
    check('studio child up (needed for the canvas oracles)', false, { studio: studioHealth });
  }

  const report = {
    at: new Date().toISOString(),
    params: { PHOTOS, BACK, PHOTO_BYTES, BUDGET },
    oracles,
    s3: s3Counters,
    peers: { a: a.totals, b: b.totals },
    hubLogTail: hubLog.slice(-4000),
  };
  writeFileSync(join(WORK, 'report.json'), JSON.stringify(report, null, 2));
  log(`report: ${join(WORK, 'report.json')}`);
  return oracles.every((o) => o.ok);
}

main()
  .then((ok) => {
    hub?.kill('SIGTERM');
    s3.close();
    if (!has('keep') && ok) rmSync(WORK, { recursive: true, force: true });
    process.exit(ok ? 0 : 1);
  })
  .catch((err) => {
    console.error(err);
    console.error(hubLog.slice(-4000));
    hub?.kill('SIGKILL');
    s3.close();
    process.exit(2);
  });
