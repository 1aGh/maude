// Issue #175 item 3 — the first sync of a large project grew the studio server to ~1.8 GB RSS.
//
// The sync runtime hands EVERY file event under the design root to every canvas's projection in
// turn (sync/index.ts `onRead`), and each projection decoded the event's bytes to a string BEFORE
// asking whether the path was one of its own. During a first sync the file plane rewrites its
// ledger (`_state/file-ledger/<hub>.json`, ~2.6 MB for 7 200 files) about once a second, so a
// 300-canvas project decoded ~780 MB of strings per second nobody read — 44 % of the server's CPU
// (`decode` under `applyFromFs` in a --cpu-prof of scripts/bench-first-sync-mem.mjs) and RSS swinging
// to 4 GB. A projection now drops a path it does not own before touching the bytes.
//
// The bench (scripts/bench-first-sync-mem.mjs) measures the whole first sync; this pins the cause
// deterministically: decodes per foreign event, and that the owner still takes its own event.

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import * as Y from 'yjs';

import { createEchoGuard, hashBytes } from '../sync/echo-guard.ts';
import { createDocProjection, type DocProjection } from '../sync/projection.ts';

const CANVASES = 300;
const BIG = 1024 * 1024;

const RealDecoder = globalThis.TextDecoder;
let bigDecodes = 0;

beforeEach(() => {
  bigDecodes = 0;
  // Counts decodes of large buffers only — what a ledger-sized event costs. Yjs keeps its own
  // decoder from import time, so its small reads are not counted either way.
  globalThis.TextDecoder = class extends RealDecoder {
    override decode(input?: AllowSharedBufferSource, options?: TextDecodeOptions): string {
      if (input && (input as ArrayBufferView).byteLength >= BIG) bigDecodes += 1;
      return super.decode(input, options);
    }
  } as typeof TextDecoder;
});
afterEach(() => {
  globalThis.TextDecoder = RealDecoder;
});

function project(n: number): { docs: Y.Doc[]; projections: DocProjection[]; paths: string[] } {
  const echoGuard = createEchoGuard();
  const docs: Y.Doc[] = [];
  const projections: DocProjection[] = [];
  const paths: string[] = [];
  for (let i = 0; i < n; i++) {
    const doc = new Y.Doc();
    const html = `/d/ui/screen-${i}.tsx`;
    const projection = createDocProjection({
      slug: `ui-screen-${i}`,
      doc,
      paths: {
        html,
        meta: `/d/ui/screen-${i}.meta.json`,
        css: `/d/ui/screen-${i}.css`,
        comments: `/d/_comments/ui-screen-${i}.json`,
        annotations: `/d/ui/screen-${i}.annotations.json`,
      },
      echoGuard,
      flushMs: 0,
      writer: () => {},
    });
    projection.start();
    docs.push(doc);
    projections.push(projection);
    paths.push(html);
  }
  return { docs, projections, paths };
}

/** What sync/index.ts `onRead` does with one file event: offer it to each projection in turn. */
function dispatch(projections: DocProjection[], path: string, text: string | Uint8Array): boolean {
  const bytes = typeof text === 'string' ? new TextEncoder().encode(text) : text;
  const hash = hashBytes(bytes);
  for (const p of projections) if (p.applyFromFs({ path, bytes, hash })) return true;
  return false;
}

describe('first sync of a large project — a file event costs the projections nothing unless it is theirs', () => {
  test('a ledger-sized write outside every canvas is decoded by none of 300 projections', () => {
    const { projections } = project(CANVASES);
    const ledger = JSON.stringify({ rows: 'x'.repeat(2 * BIG) });
    expect(dispatch(projections, '/d/_state/file-ledger/127.0.0.1-hub.json', ledger)).toBe(false);
    expect(dispatch(projections, '/d/_sync.json', ledger)).toBe(false);
    expect(dispatch(projections, '/d/assets/set-1/note-9.md', ledger)).toBe(false);
    // Before the fix: 3 × 300 = 900 decodes of 2 MB (1.8 GB of strings).
    expect(bigDecodes).toBe(0);
    for (const p of projections) p.stop();
  });

  test("the canvas's own projection still takes its own file — and only that one decodes it", () => {
    const { docs, projections, paths } = project(CANVASES);
    const body = `export default function Screen() {\n  return <h1>${'x'.repeat(BIG)}</h1>;\n}\n`;
    expect(dispatch(projections, paths[211], body)).toBe(true);
    expect(docs[211].getText('html').toString()).toBe(body);
    expect(docs[12].getText('html').toString()).toBe('');
    expect(bigDecodes).toBe(1);
    for (const p of projections) p.stop();
  });
});
