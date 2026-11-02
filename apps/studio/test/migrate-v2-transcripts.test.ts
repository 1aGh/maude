// V2-1.10 §5.10 (test #16) — the migrator's transcripts step: an old `.srt`
// (+ the bare whisper `.json` beside it) becomes `assets/<sha8>.transcript.json`;
// the bare dump goes to `_trash/migrate-v2/`; `--reverse` puts it back byte for
// byte and deletes the generated transcript.

import { afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { EXIT } from '../migrate/engine.ts';
import { transcriptFromLegacy } from '../migrate/steps.ts';
import { readTranscript, serializeTranscript, validateTranscript } from '../video/schema.ts';
import { fullTreeHash, opts, type Project, run } from './_migrate-harness.ts';

let p: Project | null = null;
afterEach(() => {
  p?.dispose();
  p = null;
});

const SRT =
  '1\n00:00:01,000 --> 00:00:02,000\nGo Alligators go\n\n2\n00:00:03,000 --> 00:00:03,500\nGame day\n';
const WHISPER = JSON.stringify({
  transcription: [
    { text: ' Go', offsets: { from: 1000, to: 1300 } },
    { text: ' Alligators', offsets: { from: 1300, to: 1800 } },
    { text: '', offsets: { from: 1800, to: 1800 } },
  ],
});

function project(): Project {
  const repo = mkdtempSync(path.join(tmpdir(), 'migrate-transcripts-'));
  const d = path.join(repo, '.design');
  mkdirSync(path.join(d, 'assets'), { recursive: true });
  writeFileSync(path.join(d, 'config.json'), '{\n  "name": "t"\n}\n');
  writeFileSync(path.join(d, 'assets', 'aaaa1111.mp4'), 'video');
  writeFileSync(path.join(d, 'assets', 'aaaa1111.srt'), SRT);
  writeFileSync(path.join(d, 'assets', 'aaaa1111.json'), WHISPER);
  writeFileSync(path.join(d, 'assets', 'bbbb2222.m4a'), 'audio');
  writeFileSync(path.join(d, 'assets', 'bbbb2222.srt'), SRT);
  return { repo, design: d, dispose: () => rmSync(repo, { recursive: true, force: true }) };
}

describe('transcripts.import', () => {
  test('whisper segments win over cues; cues spread evenly; regions merged', () => {
    const w = transcriptFromLegacy('assets/a.mp4', SRT, WHISPER, '2026-10-09T12:00:00.000Z');
    const wt = JSON.parse(w?.json ?? '{}');
    expect(wt).toMatchObject({
      format: 'maude.transcript',
      v: 1,
      asset: 'assets/a.mp4',
      engine: { id: 'whisper.cpp', timing: 'segment' },
      speech: { source: 'words', regions: [[1, 1.8]] },
    });
    expect(wt.words.map((x: { text: string }) => x.text)).toEqual(['Go', 'Alligators']);
    const s = JSON.parse(transcriptFromLegacy('assets/a.mp4', SRT, null, 'x')?.json ?? '{}');
    expect(s.engine).toEqual({ id: 'srt-import', timing: 'cue' });
    expect(s.words.slice(0, 3).map((x: { t0: number; t1: number }) => [x.t0, x.t1])).toEqual([
      [1, 1.333],
      [1.333, 1.667],
      [1.667, 2],
    ]);
    expect(s.speech.regions).toEqual([
      [1, 2],
      [3, 3.5],
    ]);
  });

  test('forward writes transcripts and trashes the bare dump; reverse restores byte for byte', async () => {
    p = project();
    const h0 = fullTreeHash(p.design);
    const fwd = await run(opts(p));
    expect(fwd.exitCode).toBe(EXIT.done);
    const a = path.join(p.design, 'assets');
    expect(
      JSON.parse(readFileSync(path.join(a, 'aaaa1111.transcript.json'), 'utf8')).engine.id
    ).toBe('whisper.cpp');
    expect(
      JSON.parse(readFileSync(path.join(a, 'bbbb2222.transcript.json'), 'utf8')).engine.id
    ).toBe('srt-import');
    expect(existsSync(path.join(a, 'aaaa1111.json'))).toBe(false);
    expect(
      readFileSync(path.join(p.design, '_trash', 'migrate-v2', 'assets', 'aaaa1111.json'), 'utf8')
    ).toBe(WHISPER);
    expect(readFileSync(path.join(a, 'aaaa1111.srt'), 'utf8')).toBe(SRT); // old captions stay
    const rev = await run(opts(p, { direction: 'reverse' }));
    expect(rev.exitCode).toBe(EXIT.done);
    expect(fullTreeHash(p.design)).toBe(h0);
  });

  test('S7.1: what the step writes is a valid sidecar, and a second forward is a no-op', async () => {
    p = project();
    await run(opts(p));
    for (const base of ['aaaa1111', 'bbbb2222']) {
      const rel = `assets/${base}.transcript.json`;
      const text = readFileSync(path.join(p.design, rel), 'utf8');
      const r = readTranscript(text, rel);
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      expect(validateTranscript(r.value, { strict: true, rel }).errors).toEqual([]);
      expect(serializeTranscript(r.value, rel)).toBe(text); // our writer's own bytes
    }
    const h1 = fullTreeHash(p.design);
    const again = await run(opts(p));
    expect(again.exitCode).toBe(EXIT.atTarget);
    expect(again.steps.find((s) => s.id === 'transcripts.import')?.status).toBe('noop');
    expect(fullTreeHash(p.design)).toBe(h1);
  });

  test('a base name the format cannot carry gets a note, never a bad file', () => {
    expect(transcriptFromLegacy(`assets/${'x'.repeat(65)}.mp4`, SRT, null, 'x')).toBeNull();
  });

  test('an edited transcript is not deleted by the reverse', async () => {
    p = project();
    await run(opts(p));
    const t = path.join(p.design, 'assets', 'bbbb2222.transcript.json');
    writeFileSync(t, `${readFileSync(t, 'utf8').trimEnd()} \n`);
    const rev = await run(opts(p, { direction: 'reverse' }));
    expect(rev.exitCode).toBe(EXIT.done);
    expect(existsSync(t)).toBe(true);
    expect(rev.steps.find((s) => s.id === 'transcripts.import')?.notes.join(' ')).toContain(
      'changed since the update'
    );
  });
});
