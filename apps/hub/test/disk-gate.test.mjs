// Disk pressure — cell materializer Phase 0 (Tasks 1 + 2).
//
// The 2026-10-01 Alligators restart loop: boot hydrate and desktop pushes
// filled an 8 GB cell disk, the first ENOSPC escaped as an unhandled
// rejection, the process exited, the container cold-started into the same
// full disk. Two guards, both tested here:
//
//   • every write door answers 503 + Retry-After below the floor, BEFORE the
//     body is read, and writes nothing;
//   • a disk error escaping a promise is logged and survived; any other error
//     still exits (a corrupt-state error must restart the cell).

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, beforeEach, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  DISK_PRESSURE_RETRY_AFTER_S,
  diskReport,
  floorBytes,
  installCrashHandlers,
  isDiskError,
  setStatfsForTests,
} from '../src/disk.mjs';
import { handleFileDoor, resetQuotas } from '../src/file-door.mjs';
import { closeJournal, openJournal } from '../src/journal.mjs';
import { addToken } from '../src/tokens.mjs';
import { handleUploadSessions } from '../src/upload-sessions.mjs';

const GiB = 1024 ** 3;
const sha = (b) => createHash('sha256').update(b).digest('hex');

/** A statfs answer for a disk of `total` bytes with `free` available. */
const fakeDisk = (total, free) => async () => ({
  bsize: 4096,
  blocks: Math.floor(total / 4096),
  bavail: Math.floor(free / 4096),
});

let dataDir;
let designRoot;
let token;

beforeEach(() => {
  dataDir = mkdtempSync(join(tmpdir(), 'disk-gate-data-'));
  designRoot = mkdtempSync(join(tmpdir(), 'disk-gate-root-'));
  mkdirSync(join(designRoot, 'assets'), { recursive: true });
  writeFileSync(join(designRoot, 'config.json'), '{"canvasGroups":[{"path":"ui"}]}');
  token = addToken(dataDir, { label: 'peer', scope: '*' }).value;
  resetQuotas();
});

afterEach(() => {
  setStatfsForTests(null);
  closeJournal(dataDir);
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(designRoot, { recursive: true, force: true });
});

/** A request whose body records whether anyone read it. */
function exchange({ body = 'BYTES', headers = {} } = {}) {
  const read = { touched: false };
  const chunks = body === null ? [] : [Buffer.isBuffer(body) ? body : Buffer.from(body)];
  const request = {
    headers: { authorization: `Bearer ${token}`, ...headers },
    async *[Symbol.asyncIterator]() {
      read.touched = true;
      for (const c of chunks) yield c;
    },
  };
  let status = 0;
  let head = {};
  let payload = '';
  const response = new Writable({
    write(c, _e, cb) {
      payload += c;
      cb();
    },
  });
  response.writeHead = (s, h = {}) => {
    status = s;
    head = h;
    return response;
  };
  return {
    request,
    response,
    read,
    result: () => ({ status, head, json: payload ? JSON.parse(payload) : null }),
  };
}

describe('floorBytes', () => {
  it('is max(1 GiB, 12 % of the disk), the share capped at 4 GiB', () => {
    assert.equal(floorBytes({}, 8 * GiB), 1 * GiB); // a cell: 0.96 GiB < 1 GiB
    assert.equal(floorBytes({}, 20 * GiB), Math.floor(20 * GiB * 0.12));
    // A laptop / self-hosted disk: 12 % of 460 GB would refuse writes with
    // 40 GB free — found on the first real-disk run of the file-door suite.
    assert.equal(floorBytes({}, 460 * GiB), 4 * GiB);
  });

  it('MAUDE_DISK_FLOOR_BYTES overrides it outright, including 0', () => {
    assert.equal(floorBytes({ MAUDE_DISK_FLOOR_BYTES: '12345' }, 100 * GiB), 12345);
    assert.equal(floorBytes({ MAUDE_DISK_FLOOR_BYTES: '0' }, 100 * GiB), 0);
  });

  it('ignores a blank or nonsense override', () => {
    assert.equal(floorBytes({ MAUDE_DISK_FLOOR_BYTES: '' }, 8 * GiB), 1 * GiB);
    assert.equal(floorBytes({ MAUDE_DISK_FLOOR_BYTES: 'lots' }, 8 * GiB), 1 * GiB);
    assert.equal(floorBytes({ MAUDE_DISK_FLOOR_BYTES: '-5' }, 8 * GiB), 1 * GiB);
  });
});

describe('diskReport', () => {
  it('is under pressure below the floor, and not above it', async () => {
    setStatfsForTests(fakeDisk(8 * GiB, 0.5 * GiB));
    const low = await diskReport(designRoot, {});
    assert.equal(low.pressure, true);
    assert.equal(low.totalBytes, 8 * GiB);
    assert.equal(low.floorBytes, 1 * GiB);

    setStatfsForTests(fakeDisk(8 * GiB, 4 * GiB));
    assert.equal((await diskReport(designRoot, {})).pressure, false);
  });

  it('an unreadable disk is NOT pressure — a monitoring gap must not become an outage', async () => {
    setStatfsForTests(async () => {
      throw Object.assign(new Error('nope'), { code: 'ENOSYS' });
    });
    assert.equal(await diskReport(designRoot, {}), null);
  });

  it('reads the real filesystem when nothing is injected', async () => {
    const r = await diskReport(designRoot, {});
    assert.ok(r.totalBytes > 0 && r.freeBytes >= 0);
  });
});

describe('the file door under disk pressure', () => {
  const door = (ex) =>
    handleFileDoor({
      request: ex.request,
      response: ex.response,
      pathname: '/api/file/assets/photo.png',
      method: 'PUT',
      dataDir,
      secret: '',
      designRoot,
      journal: openJournal(dataDir),
    });

  it('answers 503 + Retry-After, reads no body and writes nothing', async () => {
    setStatfsForTests(fakeDisk(8 * GiB, 100 * 1024 * 1024));
    const ex = exchange();
    assert.equal(await door(ex), true);
    const { status, head, json } = ex.result();
    assert.equal(status, 503);
    assert.equal(head['Retry-After'], String(DISK_PRESSURE_RETRY_AFTER_S));
    assert.equal(json.error, 'disk-pressure');
    assert.equal(json.floorBytes, 1 * GiB);
    assert.equal(ex.read.touched, false, 'the gate must sit BEFORE the body');
    assert.equal(existsSync(join(designRoot, 'assets/photo.png')), false);
    assert.deepEqual(readdirSync(join(designRoot, 'assets')), [], 'no temp file either');
  });

  it('accepts the same write once there is room', async () => {
    setStatfsForTests(fakeDisk(8 * GiB, 4 * GiB));
    const ex = exchange();
    await door(ex);
    assert.equal(ex.result().status, 200, JSON.stringify(ex.result().json));
    assert.equal(existsSync(join(designRoot, 'assets/photo.png')), true);
  });

  it('never gates a DELETE — freeing space must stay possible under pressure', async () => {
    setStatfsForTests(fakeDisk(8 * GiB, 4 * GiB));
    await door(exchange());
    setStatfsForTests(fakeDisk(8 * GiB, 0));
    const ex = exchange({ body: null });
    await handleFileDoor({
      request: ex.request,
      response: ex.response,
      pathname: '/api/file/assets/photo.png',
      method: 'DELETE',
      dataDir,
      secret: '',
      designRoot,
      journal: openJournal(dataDir),
    });
    assert.notEqual(ex.result().status, 503);
  });
});

describe('upload sessions under disk pressure', () => {
  const PART = 1024;
  const sessionCall = async ({ path = '', method, body = null, headers = {} }) => {
    const ex = exchange({
      body: body === null ? null : Buffer.isBuffer(body) ? body : JSON.stringify(body),
      headers,
    });
    const journal = openJournal(dataDir);
    await handleUploadSessions({
      request: ex.request,
      response: ex.response,
      pathname: `/api/file-uploads${path}`,
      method,
      dataDir,
      secret: '',
      designRoot,
      journal,
      partBytes: PART,
      onWritten: ({ path: p }) => journal.recordWrite({ designRoot, path: p, source: 'peer-put' }),
    });
    return { ...ex.result(), read: ex.read };
  };

  it('refuses a part and a completion with 503, landing nothing', async () => {
    setStatfsForTests(fakeDisk(8 * GiB, 4 * GiB));
    const bytes = Buffer.alloc(PART * 2, 7);
    const created = await sessionCall({
      method: 'POST',
      body: { path: 'assets/clip.mp4', size: bytes.length, sha256: sha(bytes) },
    });
    assert.equal(created.status, 201, JSON.stringify(created.json));
    const { id } = created.json;
    const first = bytes.subarray(0, PART);
    const ok = await sessionCall({
      path: `/${id}/0`,
      method: 'PUT',
      body: first,
      headers: { 'x-maude-part-sha256': sha(first) },
    });
    assert.equal(ok.status, 200);

    setStatfsForTests(fakeDisk(8 * GiB, 0));
    const second = bytes.subarray(PART);
    const part = await sessionCall({
      path: `/${id}/1`,
      method: 'PUT',
      body: second,
      headers: { 'x-maude-part-sha256': sha(second) },
    });
    assert.equal(part.status, 503);
    assert.equal(part.head['Retry-After'], String(DISK_PRESSURE_RETRY_AFTER_S));
    assert.equal(part.read.touched, false);

    const done = await sessionCall({ path: `/${id}/complete`, method: 'POST' });
    assert.equal(done.status, 503);
    assert.equal(existsSync(join(designRoot, 'assets/clip.mp4')), false);
  });
});

describe('crash handlers', () => {
  const harness = () => {
    const proc = new EventEmitter();
    const exits = [];
    const logs = [];
    const disk = [];
    installCrashHandlers({
      proc,
      log: { error: (m) => logs.push(m) },
      exit: (c) => exits.push(c),
      onDiskError: (e) => disk.push(e.code),
    });
    return { proc, exits, logs, disk };
  };

  it('classifies disk errors by code', () => {
    for (const code of ['ENOSPC', 'EDQUOT']) assert.equal(isDiskError({ code }), true);
    // EIO is a WRONG answer from the disk, not a full one — it restarts the
    // cell rather than letting the write-behind mirror suspect bytes.
    for (const e of [{ code: 'EIO' }, { code: 'ENOENT' }, new TypeError('x'), null, 'ENOSPC']) {
      assert.equal(isDiskError(e), false);
    }
  });

  it('survives an ENOSPC rejection and flags it', () => {
    const h = harness();
    h.proc.emit('unhandledRejection', Object.assign(new Error('no space'), { code: 'ENOSPC' }));
    h.proc.emit('uncaughtException', Object.assign(new Error('quota'), { code: 'EDQUOT' }));
    assert.deepEqual(h.exits, []);
    assert.deepEqual(h.disk, ['ENOSPC', 'EDQUOT']);
    assert.match(h.logs[0], /DISK ENOSPC/);
  });

  it('EIO exits — a disk that answers wrongly must not keep feeding the mirror', () => {
    const h = harness();
    h.proc.emit('unhandledRejection', Object.assign(new Error('i/o error'), { code: 'EIO' }));
    assert.deepEqual(h.exits, [1]);
    assert.deepEqual(h.disk, []);
  });

  it('still exits on anything else — and logs the stack first', () => {
    const h = harness();
    h.proc.emit('uncaughtException', new TypeError('corrupt state'));
    assert.deepEqual(h.exits, [1]);
    assert.match(h.logs[0], /fatal uncaughtException: TypeError: corrupt state/);
  });

  it('in a real process: ENOSPC does not exit, a TypeError does', () => {
    const disk = fileURLToPath(new URL('../src/disk.mjs', import.meta.url));
    const run = (throwExpr) =>
      spawnSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `import { installCrashHandlers } from ${JSON.stringify(disk)};
           installCrashHandlers();
           Promise.reject(${throwExpr});
           setTimeout(() => { console.log('still-serving'); process.exit(0); }, 100);`,
        ],
        { encoding: 'utf8', timeout: 10_000 }
      );

    const survived = run(`Object.assign(new Error('no space left'), { code: 'ENOSPC' })`);
    assert.equal(survived.status, 0, survived.stderr);
    assert.match(survived.stdout, /still-serving/);
    assert.match(survived.stderr, /DISK ENOSPC/);

    const died = run(`new TypeError('corrupt state')`);
    assert.equal(died.status, 1);
    assert.doesNotMatch(died.stdout, /still-serving/);
    assert.match(died.stderr, /fatal unhandledRejection: TypeError: corrupt state/);
  });
});
