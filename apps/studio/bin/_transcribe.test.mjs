// _transcribe.test.mjs — the whisper.cpp JSON → word-timings parser (Phase 2).
// The spawn/model resolution is a soft-dep live gate; this covers the pure,
// deterministic parsing that turns whisper.cpp `-oj` output into CaptionWords
// (then captions.ts renders the SRT — covered in captions.test.ts).

import { describe, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { wordsToSrt } from '../generation/captions.ts';
import { resolveProvider, whisperJsonToWords } from './_transcribe.mjs';

function tmpRepo(config) {
  const root = mkdtempSync(join(tmpdir(), 'maude-transcribe-'));
  mkdirSync(join(root, '.design'), { recursive: true });
  if (config !== undefined)
    writeFileSync(join(root, '.design', 'config.json'), JSON.stringify(config));
  return root;
}

const WHISPER_JSON = JSON.stringify({
  transcription: [
    { offsets: { from: 0, to: 480 }, text: ' Hello' },
    { offsets: { from: 480, to: 900 }, text: ' there.' },
    { offsets: { from: 1200, to: 1800 }, text: ' Maude' },
    { offsets: { from: 0, to: 0 }, text: '   ' }, // blank → dropped
  ],
});

describe('whisperJsonToWords', () => {
  test('maps offsets (ms) to seconds and trims text', () => {
    const words = whisperJsonToWords(WHISPER_JSON);
    expect(words).toHaveLength(3);
    expect(words[0]).toEqual({ text: 'Hello', start: 0, end: 0.48 });
    expect(words[1]).toEqual({ text: 'there.', start: 0.48, end: 0.9 });
    expect(words[2].text).toBe('Maude');
  });

  test('feeds captions.ts to produce a valid SRT', () => {
    const srt = wordsToSrt(whisperJsonToWords(WHISPER_JSON));
    expect(srt).toContain('00:00:00,000 --> 00:00:00,900');
    expect(srt).toContain('Hello there.');
  });

  test('malformed / empty JSON yields no words (never throws)', () => {
    expect(whisperJsonToWords('not json')).toEqual([]);
    expect(whisperJsonToWords('{}')).toEqual([]);
    expect(whisperJsonToWords(JSON.stringify({ transcription: [] }))).toEqual([]);
  });

  test('tolerates missing offsets', () => {
    const words = whisperJsonToWords(JSON.stringify({ transcription: [{ text: 'x' }] }));
    expect(words).toEqual([{ text: 'x', start: 0, end: 0 }]);
  });
});

describe('resolveProvider (Task 2.6 — explicit engine choice, no silent switch)', () => {
  test('an explicit valid flag wins over config', () => {
    const repo = tmpRepo({ generation: { transcription: { provider: 'groq' } } });
    expect(resolveProvider('elevenlabs', repo)).toEqual({
      provider: 'elevenlabs',
      defaulted: false,
    });
  });

  test('falls back to the project config default', () => {
    const repo = tmpRepo({ generation: { transcription: { provider: 'groq' } } });
    expect(resolveProvider(undefined, repo)).toEqual({ provider: 'groq', defaulted: false });
  });

  test('defaults to local whisper (marked defaulted) when nothing is set', () => {
    const repo = tmpRepo(); // no config
    expect(resolveProvider(undefined, repo)).toEqual({ provider: 'whisper', defaulted: true });
  });

  test('a malformed config provider is ignored → whisper default', () => {
    const repo = tmpRepo({ generation: { transcription: { provider: 'bogus' } } });
    expect(resolveProvider(undefined, repo)).toEqual({ provider: 'whisper', defaulted: true });
  });
});

// #128 §7 — a cloud engine's job leaves `assets/<sha8>.transcript.json` (the server writes it);
// the CLI checks and says so, naming the asset, instead of reporting captions that cannot be timed.
describe('runCloud — the word-timing sidecar', () => {
  async function runCloudCli({ withSidecar }) {
    const root = tmpRepo();
    mkdirSync(join(root, '.design', 'assets'), { recursive: true });
    if (withSidecar)
      writeFileSync(join(root, '.design', 'assets', 'deadbeef.transcript.json'), '{}');
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: (req) =>
        req.method === 'POST'
          ? Response.json({ jobId: 'j1' })
          : Response.json({
              jobs: [{ id: 'j1', status: 'done', assets: ['assets/deadbeef.srt'] }],
            }),
    });
    try {
      writeFileSync(join(root, '.design', '_server.json'), JSON.stringify({ port: server.port }));
      const proc = Bun.spawn(
        [
          'bun',
          join(import.meta.dir, '_transcribe.mjs'),
          '--source',
          'assets/deadbeef.mp4',
          '--provider',
          'elevenlabs',
          '--root',
          root,
        ],
        { stdout: 'pipe', stderr: 'pipe', env: { ...process.env, NO_OPEN: '1' } }
      );
      const [out, err] = await Promise.all([
        new Response(proc.stdout).text(),
        new Response(proc.stderr).text(),
      ]);
      await proc.exited;
      return { out, err };
    } finally {
      server.stop(true);
    }
  }

  test('no transcript sidecar after a cloud job: stderr names the asset', async () => {
    const { out, err } = await runCloudCli({ withSidecar: false });
    expect(out.trim()).toBe('assets/deadbeef.srt');
    expect(err).toContain('assets/deadbeef.mp4');
    expect(err).toMatch(/no word timings/i);
  });

  test('with the sidecar present there is no warning', async () => {
    const { out, err } = await runCloudCli({ withSidecar: true });
    expect(out.trim()).toBe('assets/deadbeef.srt');
    expect(err).not.toMatch(/no word timings/i);
  });
});
