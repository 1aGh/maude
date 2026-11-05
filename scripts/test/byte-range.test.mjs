// Byte-range parsing for the Worker that serves the site's mp4s (site/worker.mjs).
// Safari will not play a <video> without a 206, and Workers static assets answer a
// Range with the whole file, so the Worker slices it itself.
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { parseRange } = await import(
  pathToFileURL(join(ROOT, 'site', 'lib', 'byte-range.mjs')).href
);

test('closed, open-ended and suffix ranges', () => {
  assert.deepEqual(parseRange('bytes=0-1', 100), { start: 0, end: 1 });
  assert.deepEqual(parseRange('bytes=10-', 100), { start: 10, end: 99 });
  assert.deepEqual(parseRange('bytes=-10', 100), { start: 90, end: 99 });
});

test('an end past the file is clamped; a suffix longer than the file is the whole file', () => {
  assert.deepEqual(parseRange('bytes=90-500', 100), { start: 90, end: 99 });
  assert.deepEqual(parseRange('bytes=-500', 100), { start: 0, end: 99 });
});

test('a start at or past the end, an inverted range or a zero suffix is unsatisfiable (416)', () => {
  assert.equal(parseRange('bytes=100-', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=50-10', 100), 'unsatisfiable');
  assert.equal(parseRange('bytes=-0', 100), 'unsatisfiable');
});

test('anything that is not one byte range is served whole', () => {
  assert.equal(parseRange('bytes=0-1,5-6', 100), null);
  assert.equal(parseRange('bytes=-', 100), null);
  assert.equal(parseRange('items=0-1', 100), null);
  assert.equal(parseRange('', 100), null);
});

test('slice() streams exactly [start, start+length) across chunk boundaries', async () => {
  const { slice } = await import(pathToFileURL(join(ROOT, 'site', 'lib', 'byte-range.mjs')).href);
  const all = Uint8Array.from({ length: 100 }, (_, i) => i);
  // Chunks of 7 bytes, so the range starts and ends mid-chunk.
  const source = () =>
    new ReadableStream({
      start(c) {
        for (let i = 0; i < all.length; i += 7) c.enqueue(all.subarray(i, i + 7));
        c.close();
      },
    });
  for (const [start, length] of [
    [0, 1],
    [0, 100],
    [10, 25],
    [14, 7],
    [95, 5],
  ]) {
    const out = new Uint8Array(await new Response(slice(source(), start, length)).arrayBuffer());
    assert.deepEqual([...out], [...all.subarray(start, start + length)], `${start}+${length}`);
  }
});
