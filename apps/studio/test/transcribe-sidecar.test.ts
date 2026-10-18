// test/transcribe-sidecar.test.ts — S7.2: `maude design transcribe` (prompt tier, local whisper path)
// keeps its flags and its SRT, but writes `assets/<sha8>.transcript.json` through the strict writer
// and leaves no bare `assets/<sha8>.json` behind (V2-1.10 §2: a bare .json is default-closed on the
// file plane, so those word timings never reached a peer — 24 of them in the Alligators project).

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../video/decode.ts';
import { readTranscript } from '../video/schema.ts';
import { dtwWords, SR, synth, truthLine } from './fixtures/video/synth.ts';

const BIN = `${import.meta.dir}/../bin/_transcribe.mjs`;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'maude-ts-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const { truth } = truthLine();
const WAV = encodeWav(synth(truth, truth[truth.length - 1].end + 0.6), SR);

function whisperJson(): string {
  const raw = dtwWords(truth, 0.17);
  return JSON.stringify({
    result: { language: 'en' },
    transcription: raw.map((w, i) => ({
      offsets: { from: Math.round(truth[i].start * 1000), to: Math.round(w.end * 1000) },
      text: ` ${w.text}`,
      tokens: [{ text: ` ${w.text}`, p: 0.9, t_dtw: Math.round(w.start * 100) }],
    })),
  });
}

function project() {
  const root = tmp();
  mkdirSync(join(root, '.design', 'assets'), { recursive: true });
  writeFileSync(join(root, '.design', 'assets', 'abcd1234.wav'), WAV);
  const aux = tmp();
  const whisper = join(aux, 'fake-whisper');
  writeFileSync(
    whisper,
    [
      '#!/bin/sh',
      'if [ "$1" = "--help" ]; then exit 0; fi',
      'printf "%s\\0" "$@" > "$FAKE_ARGV"',
      'while [ $# -gt 0 ]; do if [ "$1" = "-of" ]; then of="$2"; fi; shift; done',
      'cp "$FAKE_JSON" "$of.json"',
      '',
    ].join('\n')
  );
  chmodSync(whisper, 0o755);
  const model = join(aux, 'ggml-base.en.bin');
  writeFileSync(model, 'not a real model');
  const json = join(aux, 'w.json');
  writeFileSync(json, whisperJson());
  return { root, whisper, model, argv: join(aux, 'argv.log'), json };
}

function run(p: ReturnType<typeof project>, extra: string[] = []) {
  const r = Bun.spawnSync(
    [
      process.execPath,
      BIN,
      '--source',
      'assets/abcd1234.wav',
      '--root',
      p.root,
      '--provider',
      'whisper',
      '--whisper',
      p.whisper,
      '--model',
      p.model,
      ...extra,
    ],
    {
      env: {
        PATH: '/usr/bin:/bin',
        HOME: p.root,
        TMPDIR: tmpdir(),
        NO_OPEN: '1',
        FAKE_ARGV: p.argv,
        FAKE_JSON: p.json,
      },
    }
  );
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

describe('transcribe (local whisper) writes the transcript sidecar and no bare .json', () => {
  test('SRT as before + assets/<sha8>.transcript.json; nothing else is left in assets/', () => {
    const p = project();
    const r = run(p);
    expect(r.code).toBe(0);
    expect(r.out.trim().split('\n').pop()).toBe(join(p.root, '.design', 'assets', 'abcd1234.srt'));
    expect(readFileSync(join(p.root, '.design', 'assets', 'abcd1234.srt'), 'utf8')).toContain(
      '-->'
    );

    const text = readFileSync(
      join(p.root, '.design', 'assets', 'abcd1234.transcript.json'),
      'utf8'
    );
    const t = readTranscript(text, 'assets/abcd1234.transcript.json');
    expect(t.ok).toBe(true);
    if (t.ok) {
      expect(t.value.words.length).toBe(48);
      expect(t.value.engine).toMatchObject({
        id: 'whisper.cpp',
        model: 'base.en',
        timing: 'dtw+energy',
      });
    }
    // the regression: today's flow leaves assets/abcd1234.json (whisper's -of next to the source)
    expect(existsSync(join(p.root, '.design', 'assets', 'abcd1234.json'))).toBe(false);
    expect(readdirSync(join(p.root, '.design', 'assets')).sort()).toEqual([
      'abcd1234.srt',
      'abcd1234.transcript.json',
      'abcd1234.wav',
    ]);
  });

  test('whisper is run with the word-timing flags (-ojf -ml 1 -sow -dtw -nfa)', () => {
    const p = project();
    expect(run(p, ['--lang', 'en']).code).toBe(0);
    const argv = readFileSync(p.argv, 'utf8').split('\0').slice(0, -1);
    for (const f of ['-ojf', '-sow', '-nfa']) expect(argv).toContain(f);
    expect(argv[argv.indexOf('-dtw') + 1]).toBe('base.en');
    expect(argv).not.toContain('-oj');
  });

  test('--format vtt still writes the VTT', () => {
    const p = project();
    expect(run(p, ['--format', 'vtt']).code).toBe(0);
    expect(existsSync(join(p.root, '.design', 'assets', 'abcd1234.vtt'))).toBe(true);
  });
});
