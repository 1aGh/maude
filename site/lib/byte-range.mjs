// Parse a single HTTP byte range against a known file size (worker.mjs serves the
// site's videos with it; Workers static assets will not answer a Range itself).
// Pure, so scripts/test/byte-range.test.mjs can pin it without a Worker runtime.

const RANGE = /^bytes=(\d*)-(\d*)$/;

/** @returns {{ start: number, end: number } | 'unsatisfiable' | null} null = not a single byte range, serve whole. */
export function parseRange(header, size) {
  const m = RANGE.exec(header.trim());
  if (!m || (m[1] === '' && m[2] === '')) return null;
  let start;
  let end;
  if (m[1] === '') {
    // suffix range: the last N bytes
    const n = Number(m[2]);
    if (n === 0) return 'unsatisfiable';
    start = Math.max(0, size - n);
    end = size - 1;
  } else {
    start = Number(m[1]);
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1);
  }
  if (start >= size || start > end) return 'unsatisfiable';
  return { start, end };
}

/** Pass `length` bytes of `body` through, starting at byte `start`. */
export function slice(body, start, length) {
  let skipped = 0;
  let sent = 0;
  return body.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        if (sent >= length) return;
        let from = 0;
        if (skipped < start) {
          const skip = Math.min(start - skipped, chunk.byteLength);
          skipped += skip;
          from = skip;
          if (from >= chunk.byteLength) return;
        }
        const piece = chunk.subarray(from, from + (length - sent));
        sent += piece.byteLength;
        controller.enqueue(piece);
        if (sent >= length) controller.terminate();
      },
    })
  );
}
