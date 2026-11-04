// Issue #204 — a pulled file larger than STREAM_DOWNLOAD_ABOVE_BYTES streams to its staging file;
// it is never collected in memory first.
//
// The threshold used to be 32 MB, so every photo and short clip of a first sync (5 041 files,
// most of them 50 kB–5 MB) went through `readCapped`: every chunk kept, then copied into one
// buffer of the file's full size — twice the file per download. The streamed path holds one chunk.

import { afterEach, beforeEach, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createFileLedger, type FileLedger } from '../sync/file-ledger.ts';
import { createFilePlane, STREAM_DOWNLOAD_ABOVE_BYTES } from '../sync/file-plane.ts';

const HUB = 'https://hub.test';
const MIB = 1024 * 1024;

let root: string;
let ledger: FileLedger;
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'file-plane-stream-'));
  mkdirSync(join(root, 'assets'), { recursive: true });
  ledger = createFileLedger({ designRoot: root, hubUrl: HUB, flushMs: 0 });
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** A hub holding one picture, served in 64 kB chunks with a content-length. `onChunk` sees how many
 *  bytes the downloader has asked for so far. */
function hubWith(rel: string, body: Uint8Array, onChunk: (sent: number) => void) {
  const sha256 = createHash('sha256').update(body).digest('hex');
  const fetchImpl = (async (url: string) => {
    const u = new URL(String(url));
    if (u.pathname === '/api/journal') {
      return Response.json({
        epoch: 'e1',
        head: 1,
        entries: [
          { seq: 1, path: rel, sha256, size: body.byteLength, mtimeMs: 0, class: 'inert-media' },
        ],
        truncated: false,
      });
    }
    if (u.pathname === `/_project-file/${rel}`) {
      let sent = 0;
      const stream = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= body.byteLength) {
            controller.close();
            return;
          }
          const next = body.subarray(sent, sent + 64 * 1024);
          sent += next.byteLength;
          onChunk(sent);
          controller.enqueue(next);
        },
      });
      return new Response(stream, {
        status: 200,
        headers: { 'content-length': String(body.byteLength) },
      });
    }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fetchImpl, sha256 };
}

test('the threshold is a few megabytes, not tens', () => {
  expect(STREAM_DOWNLOAD_ABOVE_BYTES).toBeLessThanOrEqual(4 * MIB);
});

test('a 6 MB picture streams to its staging file while it arrives, then lands whole', async () => {
  const size = 6 * MIB;
  const body = new Uint8Array(size);
  for (let i = 0; i < size; i += 4096) body[i] = (i / 4096) & 0xff;
  const rel = 'assets/photo.jpg';
  let staged = '';
  let stagedMidway = -1;
  const { fetchImpl, sha256 } = hubWith(rel, body, (sent) => {
    // Half-way through the body: the bytes so far are on disk, not in a list of chunks.
    if (stagedMidway === -1 && sent >= size / 2) {
      staged = join(root, '_state', 'downloads', `${sha256}.part`);
      stagedMidway = existsSync(staged) ? statSync(staged).size : 0;
    }
  });
  const plane = createFilePlane({
    designRoot: root,
    hubUrl: HUB,
    token: () => 'tok',
    ledger,
    allowCodeModules: false,
    label: 'laptop',
    fetchImpl,
    log: { log() {}, warn() {} },
    now: () => 1_700_000_000_000,
  });
  const res = await plane.reconcile();
  expect(res.pulled).toEqual([rel]);
  expect(stagedMidway).toBeGreaterThan(0);
  expect(
    createHash('sha256')
      .update(readFileSync(join(root, rel)))
      .digest('hex')
  ).toBe(sha256);
  // The staging file was moved into place, not left behind.
  expect(existsSync(staged)).toBe(false);
});
