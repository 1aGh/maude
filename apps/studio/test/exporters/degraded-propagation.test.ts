// RCA issue-mp4-audio-export-html5audio-silent-degrade — the silence gate.
//
// The bug was not that the export degraded; degrading to a video-only capture
// when the audio renderer refuses is DDR-157's deliberate design. The bug was
// that the degradation reached nothing a human or an agent reads: `video.ts`
// parsed the shim's `{degraded, audioDropped, fallbackReason}` summary, wrote ONE
// console.error, and returned an ExportResult without it — so the job said
// `done`, `_export-history.json` looked clean, `GET /_api/export-jobs` had no
// field for it, and the Exports panel showed a success row. The user shipped a
// muted file four times before anyone dug through the desktop app's stderr.
//
// The real regression gate for the artifact itself is an integration test that
// exports a fixture comp and asserts an audio stream exists (RCA Testing
// Requirements). That one needs a browser, and CI has none — so, matching the
// house style of `export-shim-multi-capture.test.ts`, the propagation CHAIN is
// guarded at the source-shape level here, plus a real unit test of the one piece
// that is pure.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { hasAudioStream, remedyFor } from '../../exporters/degraded.ts';

const STUDIO = join(import.meta.dir, '..', '..');
const read = (rel: string) => readFileSync(join(STUDIO, rel), 'utf8');

describe('remedyFor — a fixable cause must carry its one-line fix', () => {
  test('names @remotion/media for the Html5Audio rejection', () => {
    const reason =
      'page.evaluate: Error: <Html5Audio> is not supported in @remotion/web-renderer. ' +
      'Use <Audio> from @remotion/media instead.';
    const remedy = remedyFor(reason);
    expect(remedy).toBeDefined();
    expect(remedy).toContain('@remotion/media');
    // The remedy has to say what to STOP doing too, or it reads as advice
    // rather than a diagnosis of this file.
    expect(remedy).toContain('remotion');
  });

  test('names the Video swap for the OffthreadVideo rejection', () => {
    const remedy = remedyFor('<OffthreadVideo> is not supported in @remotion/web-renderer');
    expect(remedy).toBeDefined();
    expect(remedy).toContain('@remotion/media');
  });

  test('returns nothing for a cause the author cannot fix by hand', () => {
    // The DDR-157 recursion overflow is data-dependent and has no one-liner —
    // inventing a remedy for it would be worse than silence.
    expect(remedyFor('RangeError: Maximum call stack size exceeded')).toBeUndefined();
  });
});

describe('hasAudioStream — the artifact has the last word', () => {
  const bytes = (s: string) => new TextEncoder().encode(s);

  test('mp4 with a `soun` handler counts as having audio', () => {
    expect(hasAudioStream(bytes('....hdlrsoun....'), 'mp4')).toBe(true);
  });

  test('mp4 with only a video handler does not', () => {
    expect(hasAudioStream(bytes('....hdlrvide....'), 'mp4')).toBe(false);
  });

  test('webm is recognised by its audio CodecID', () => {
    expect(hasAudioStream(bytes('\x00\x00A_OPUS\x00'), 'webm')).toBe(true);
    expect(hasAudioStream(bytes('\x00\x00V_VP9\x00'), 'webm')).toBe(false);
  });

  test('an unrecognised container is assumed fine — never invent a degradation', () => {
    expect(hasAudioStream(bytes('anything'), 'mov')).toBe(true);
  });

  test('an empty body does not crash the check', () => {
    expect(hasAudioStream(new Uint8Array(0), 'mp4')).toBe(false);
  });
});

describe('degraded propagation chain (source-shape — the browser half runs manually)', () => {
  test('video.ts returns the degradation instead of only logging it', () => {
    const src = read('exporters/video.ts');
    // The precise regression: a console.error with no accompanying assignment.
    expect(src).toContain('degraded = {');
    expect(src).toMatch(/audioDropped:/);
    expect(src).toMatch(/return\s*{[\s\S]*?degraded,[\s\S]*?}/);
  });

  test('ExportResult carries a degraded field', () => {
    const src = read('exporters/index.ts');
    expect(src).toContain('ExportDegradation');
    expect(src).toMatch(/degraded\?:\s*ExportDegradation/);
  });

  test('the job record, the WS emit and the history entry all carry it', () => {
    const src = read('exporters/jobs.ts');
    // Job type + assignment on the done path.
    expect(src).toMatch(/degraded\?:\s*ExportDegradation/);
    expect(src).toContain('if (res.degraded) job.degraded = res.degraded;');
    // deriveHistory() writes `_export-history.json` — the ledger a later
    // session reads back. It must not look clean either.
    expect(src).toMatch(/degraded:\s*j\.degraded/);
    // The WS emit spreads the whole job, which is how `degraded` reaches
    // subscribers — assert the spread rather than a field list that could drift.
    // (V2-2.8 S5 added the owner's audience as a third argument; the payload is
    // still the whole job.)
    expect(src).toContain("bus.emit('export:job', { ...job }");
  });

  test('status stays `done` — the file is real, the flag is what differs', () => {
    const src = read('exporters/jobs.ts');
    expect(src).toContain("job.status = 'done';");
  });

  test('the panel and the toast both surface it', () => {
    const src = read('client/export-center.jsx');
    expect(src).toContain('DegradedNote');
    expect(src).toContain('export-degraded-note');
    // The pill must not read "Ready" on a muted file.
    expect(src).toContain('Ready · no audio');
    // Both surfaces, because the toast is what the user sees without opening
    // the panel, and the panel is what they revisit afterwards.
    const noteUses = src.match(/<DegradedNote/g) ?? [];
    expect(noteUses.length).toBeGreaterThanOrEqual(2);
  });
});
