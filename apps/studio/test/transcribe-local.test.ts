// test/transcribe-local.test.ts — S7.2: `maude design transcribe-local` end to end.
//
// whisper.cpp is faked with a shell script that records its argv and copies a whisper-shaped JSON
// to the `-of` path; ffmpeg is never needed (the sources are 16 kHz mono WAVs). So this runs on a
// machine with no whisper, no ffmpeg and no model — and on one that has them (PATH alone decides;
// MAUDE_NO_EXTRA_TOOL_DIRS=1 hides Homebrew).

import { afterAll, describe, expect, test } from 'bun:test';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { encodeWav } from '../video/decode.ts';
import { readTranscript } from '../video/schema.ts';
import { dtwWords, SR, synth, truthLine } from './fixtures/video/synth.ts';

const BIN = `${import.meta.dir}/../bin/_transcribe-local.mjs`;
const SH = `${import.meta.dir}/../bin/transcribe-local.sh`;
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'maude-tl-'));
  dirs.push(d);
  return d;
};
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

const { truth } = truthLine();
const TOTAL = truth[truth.length - 1].end + 0.6;
const WAV = encodeWav(synth(truth, TOTAL), SR);

/** whisper's -ojf JSON for the built truth: DTW starts 170 ms late, segment ends on the segment clock. */
function whisperJson(): string {
  const raw = dtwWords(truth, 0.17);
  return JSON.stringify({
    result: { language: 'en' },
    transcription: raw.map((w, i) => ({
      offsets: { from: Math.round(truth[i].start * 1000), to: Math.round(w.end * 1000) },
      text: ` ${w.text}`,
      tokens: [
        { text: ' ', p: 0.9, t_dtw: -1 },
        { text: ` ${w.text}`, p: 0.9, t_dtw: Math.round(w.start * 100) },
        { text: '[_TT_100]', p: 0.01, t_dtw: -1 },
      ],
    })),
  });
}

interface Env {
  root: string;
  bin: string; // PATH dir
  cache: string; // XDG_CACHE_HOME
  argv: string;
  json: string;
}

/** A project (.design/assets/abcd1234.wav), a PATH dir, a model cache. */
function setup(o: { whisper?: boolean; model?: string | false } = {}): Env {
  const root = tmp();
  mkdirSync(join(root, '.design', 'assets'), { recursive: true });
  writeFileSync(join(root, '.design', 'assets', 'abcd1234.wav'), WAV);
  const bin = join(tmp(), 'bin');
  mkdirSync(bin);
  const argv = join(tmp(), 'argv.log');
  const json = join(tmp(), 'whisper.json');
  writeFileSync(json, whisperJson());
  if (o.whisper !== false) {
    const p = join(bin, 'whisper-cli');
    writeFileSync(
      p,
      [
        '#!/bin/sh',
        'if [ "$1" = "--help" ]; then exit 0; fi',
        'printf "%s\\0" "$@" > "$FAKE_ARGV"',
        'while [ $# -gt 0 ]; do if [ "$1" = "-of" ]; then of="$2"; fi; shift; done',
        'cp "$FAKE_JSON" "$of.json"',
        '',
      ].join('\n')
    );
    chmodSync(p, 0o755);
  }
  const cache = tmp();
  if (o.model !== false) {
    const dir = join(cache, 'maude', 'whisper-models');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `ggml-${o.model ?? 'base.en'}.bin`), 'not a real model');
  }
  return { root, bin, cache, argv, json };
}

function run(env: Env, args: string[], extra: Record<string, string> = {}) {
  const r = Bun.spawnSync([process.execPath, BIN, ...args], {
    cwd: env.root,
    env: {
      PATH: `${env.bin}:/usr/bin:/bin`,
      HOME: env.root,
      TMPDIR: tmpdir(),
      XDG_CACHE_HOME: env.cache,
      MAUDE_NO_EXTRA_TOOL_DIRS: '1',
      NO_OPEN: '1',
      FAKE_ARGV: env.argv,
      FAKE_JSON: env.json,
      ...extra,
    },
  });
  return { code: r.exitCode, out: r.stdout.toString(), err: r.stderr.toString() };
}

const sidecarPath = (e: Env) => join(e.root, '.design', 'assets', 'abcd1234.transcript.json');

describe('transcribe-local — the words land in assets/<sha8>.transcript.json', () => {
  test('writes the sidecar through the strict writer; no bare .json anywhere', () => {
    const e = setup();
    const r = run(e, ['assets/abcd1234.wav']);
    expect(r.err).not.toContain('No speech engine');
    expect(r.code).toBe(0);
    expect(r.out.trim().split('\n').pop()).toBe('assets/abcd1234.transcript.json');

    const text = readFileSync(sidecarPath(e), 'utf8');
    const t = readTranscript(text, 'assets/abcd1234.transcript.json');
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.value.asset).toBe('assets/abcd1234.wav');
    expect(t.value.lang).toBe('en');
    expect(t.value.words.length).toBe(48);
    expect(t.value.engine.id).toBe('whisper.cpp');
    expect(t.value.engine.model).toBe('base.en');
    expect(t.value.engine.timing).toBe('dtw+energy');
    expect(Math.abs((t.value.engine.lagMs ?? 0) - 170)).toBeLessThan(30);
    expect(t.value.speech.source).toBe('words');
    expect(t.value.speech.regions.length).toBeGreaterThan(0);
    expect(text.endsWith('\n')).toBe(true);

    // whisper's own JSON went to a private temp dir: nothing but the wav and the sidecar is in assets/
    expect(readdirSync(join(e.root, '.design', 'assets')).sort()).toEqual([
      'abcd1234.transcript.json',
      'abcd1234.wav',
    ]);
  });

  test('whisper gets the §5.6 flags in an args array, and an out path outside the project', () => {
    const e = setup();
    expect(run(e, ['assets/abcd1234.wav', '--lang', 'en']).code).toBe(0);
    const argv = readFileSync(e.argv, 'utf8').split('\0').slice(0, -1);
    for (const flag of ['-ojf', '-sow', '-nfa']) expect(argv).toContain(flag);
    expect(argv[argv.indexOf('-ml') + 1]).toBe('1');
    expect(argv[argv.indexOf('-dtw') + 1]).toBe('base.en');
    expect(argv[argv.indexOf('-l') + 1]).toBe('en');
    expect(argv[argv.indexOf('-m') + 1]).toBe(
      join(e.cache, 'maude', 'whisper-models', 'ggml-base.en.bin')
    );
    const of = argv[argv.indexOf('-of') + 1];
    expect(of.startsWith(tmpdir())).toBe(true);
    expect(of.includes('/assets/')).toBe(false);
    // the private temp dir is gone afterwards
    expect(existsSync(argv[argv.indexOf('-f') + 1])).toBe(false);
  });

  test('--json prints one object; a re-run replaces the file', () => {
    const e = setup();
    const a = run(e, ['assets/abcd1234.wav', '--json']);
    const j = JSON.parse(a.out.trim());
    expect(j).toMatchObject({
      ok: true,
      asset: 'assets/abcd1234.wav',
      words: 48,
      decodedBy: 'wav',
    });
    expect(j.speechSec).toBeGreaterThan(5);
    const first = readFileSync(sidecarPath(e), 'utf8');
    expect(run(e, ['assets/abcd1234.wav']).code).toBe(0);
    const second = readFileSync(sidecarPath(e), 'utf8');
    expect(JSON.parse(second).words).toEqual(JSON.parse(first).words);
  });

  test('the .sh shim execs the same entry (what `maude design transcribe-local` runs)', () => {
    const e = setup();
    const r = Bun.spawnSync(['bash', SH, 'assets/abcd1234.wav'], {
      cwd: e.root,
      env: {
        PATH: `${e.bin}:${process.execPath.replace(/\/[^/]+$/, '')}:/usr/bin:/bin`,
        HOME: e.root,
        XDG_CACHE_HOME: e.cache,
        MAUDE_NO_EXTRA_TOOL_DIRS: '1',
        FAKE_ARGV: e.argv,
        FAKE_JSON: e.json,
      },
    });
    expect(r.exitCode).toBe(0);
    expect(existsSync(sidecarPath(e))).toBe(true);
  });
});

describe('transcribe-local — no engine: exit 3, the Settings path, and never a download', () => {
  test('whisper-cli absent → exit 3 "No speech engine on this Mac" + the Settings path', () => {
    const e = setup({ whisper: false });
    const r = run(e, ['assets/abcd1234.wav']);
    expect(r.code).toBe(3);
    expect(r.err).toContain('No speech engine on this Mac');
    expect(r.err).toContain('Settings › Advanced');
    expect(existsSync(sidecarPath(e))).toBe(false);
  });

  test('no model installed → exit 3 too, and the model dir is not created or filled', () => {
    const e = setup({ model: false });
    const r = run(e, ['assets/abcd1234.wav']);
    expect(r.code).toBe(3);
    expect(r.err).toContain('No speech engine on this Mac');
    expect(existsSync(join(e.cache, 'maude'))).toBe(false); // nothing downloaded, nothing even made
  });

  test('--model <id> that is not installed → exit 3; an unknown id → exit 2', () => {
    const e = setup(); // base.en installed
    expect(run(e, ['assets/abcd1234.wav', '--model', 'small']).code).toBe(3);
    expect(run(e, ['assets/abcd1234.wav', '--model', '../../etc/passwd']).code).toBe(2);
    expect(run(e, ['assets/abcd1234.wav', '--model', 'base.en']).code).toBe(0);
  });

  test('the shim cannot download: it imports no fetch path and no model downloader', () => {
    const src = readFileSync(BIN, 'utf8');
    expect(src).not.toContain('downloadWhisperModel');
    expect(src).not.toMatch(/\bfetch\s*\(/);
    expect(src).not.toContain('huggingface');
  });

  test('--speech-only needs no engine: regions from energy, labelled "energy", words []', () => {
    const e = setup({ whisper: false, model: false });
    const r = run(e, ['assets/abcd1234.wav', '--speech-only']);
    expect(r.code).toBe(0);
    const t = readTranscript(
      readFileSync(sidecarPath(e), 'utf8'),
      'assets/abcd1234.transcript.json'
    );
    expect(t.ok).toBe(true);
    if (!t.ok) return;
    expect(t.value.engine.id).toBe('energy');
    expect(t.value.engine.timing).toBe('none');
    expect(t.value.words).toEqual([]);
    expect(t.value.speech.source).toBe('energy');
    expect(t.value.speech.regions.length).toBeGreaterThan(3);
  });
});

describe('transcribe-local — flags never escalate; names are data', () => {
  test('there is no --provider, --whisper or --out: an unknown option is exit 2, nothing runs', () => {
    const e = setup();
    for (const flag of ['--provider', '--whisper', '--out']) {
      const r = run(e, ['assets/abcd1234.wav', flag, 'x']);
      expect(r.code).toBe(2);
      expect(existsSync(e.argv)).toBe(false);
    }
  });

  test('only a project asset is accepted — hostile and out-of-project names are refused, unrun', () => {
    const e = setup();
    const marker = join(e.root, 'PWNED');
    for (const bad of [
      `assets/a b; touch ${marker}.mp4`,
      'assets/$(touch PWNED).mp4',
      '../outside.wav',
      'assets/../../outside.wav',
      '/etc/passwd',
      'abcd1234.wav',
      'assets/sub/x.wav',
    ]) {
      const r = run(e, [bad]);
      expect(r.code).toBe(2);
    }
    expect(existsSync(marker)).toBe(false);
    expect(existsSync(join(e.root, 'PWNED'))).toBe(false);
    expect(existsSync(e.argv)).toBe(false);
  });

  test('a symlink in assets/ that points outside the project is refused', () => {
    const e = setup();
    const outside = join(tmp(), 'secret.wav');
    writeFileSync(outside, WAV);
    symlinkSync(outside, join(e.root, '.design', 'assets', 'evil0001.wav'));
    const r = run(e, ['assets/evil0001.wav']);
    expect(r.code).toBe(1);
    expect(r.err).toContain('outside assets/');
  });

  test('--lang takes an ISO code only', () => {
    const e = setup();
    expect(run(e, ['assets/abcd1234.wav', '--lang', '-x']).code).toBe(2);
    expect(run(e, ['assets/abcd1234.wav', '--lang', 'en; rm -rf /']).code).toBe(2);
    expect(run(e, ['assets/abcd1234.wav', '--lang', 'cs']).code).toBe(0);
  });

  test('a missing asset is exit 1, a missing .design/ is exit 1', () => {
    const e = setup();
    expect(run(e, ['assets/nope0001.wav']).code).toBe(1);
    const empty = tmp();
    expect(run({ ...e, root: empty }, ['assets/abcd1234.wav']).code).toBe(1);
  });
});
