// #128 §7 (burndown T1.3) — every transcription engine leaves the SAME word-timing sidecar,
// `assets/<sha8>.transcript.json` (maude.transcript v1, written through the strict writer), and a
// video export warns — naming the asset — when a captioned clip has none. No network: the engine
// responses are stubbed.

import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createElevenLabsAdapter } from '../generation/adapters/elevenlabs.ts';
import { createGroqAdapter } from '../generation/adapters/groq.ts';
import type { AdapterContext, GenRequest } from '../generation/types.ts';
import {
  persistCloudTranscript,
  providerWordsToTranscript,
  writeProviderTranscript,
} from '../video/provider-transcript.ts';
import { readTranscript, validateTranscript } from '../video/schema.ts';

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const dirs: string[] = [];
afterAll(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});
function designRoot(): string {
  const d = mkdtempSync(join(tmpdir(), 'maude-t13-'));
  dirs.push(d);
  mkdirSync(join(d, 'assets'), { recursive: true });
  return d;
}

const ctx: AdapterContext = {
  apiKey: 'test-key',
  localize: async () => 'assets/00000000.mp3',
  readSourceAsset: async () => ({ bytes: new Uint8Array([1, 2, 3]), mime: 'audio/mpeg' }),
};
const SRC = 'assets/deadbeef.mp4';

function respond(json: unknown): void {
  globalThis.fetch = (async () =>
    new Response(JSON.stringify(json), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })) as typeof fetch;
}

async function run(adapter: ReturnType<typeof createGroqAdapter>, req: GenRequest) {
  return (await (await adapter.submit(req)).result()).assets[0];
}

describe('every engine hands back {text,start,end}[] next to its SRT', () => {
  test('ElevenLabs Scribe: words only (spacing dropped), same shape as the SRT input', async () => {
    respond({
      text: 'Hello there.',
      words: [
        { text: 'Hello', start: 0, end: 0.4, type: 'word' },
        { text: ' ', start: 0.4, end: 0.4, type: 'spacing' },
        { text: 'there.', start: 0.4, end: 0.8, type: 'word' },
      ],
    });
    const a = await run(createElevenLabsAdapter(ctx), {
      modality: 'transcription',
      provider: 'elevenlabs',
      sourceAsset: SRC,
    });
    expect(a.text).toContain('Hello there.');
    expect(a.words).toEqual([
      { text: 'Hello', start: 0, end: 0.4 },
      { text: 'there.', start: 0.4, end: 0.8 },
    ]);
    expect(a.wordTiming).toBe('provider');
  });

  test('Groq Whisper: per-word timings are provider timings', async () => {
    respond({
      text: 'Hi you',
      words: [
        { word: ' Hi', start: 0, end: 0.3 },
        { word: 'you', start: 0.3, end: 0.6 },
      ],
    });
    const a = await run(createGroqAdapter(ctx), {
      modality: 'transcription',
      provider: 'groq',
      sourceAsset: SRC,
    });
    expect(a.words).toEqual([
      { text: 'Hi', start: 0, end: 0.3 },
      { text: 'you', start: 0.3, end: 0.6 },
    ]);
    expect(a.wordTiming).toBe('provider');
  });

  test('Groq with segments only says so: timing is "segment", never passed off as word-level', async () => {
    respond({ text: 'A line', segments: [{ text: ' A line ', start: 2, end: 4 }] });
    const a = await run(createGroqAdapter(ctx), {
      modality: 'transcription',
      provider: 'groq',
      sourceAsset: SRC,
    });
    expect(a.words).toEqual([{ text: 'A line', start: 2, end: 4 }]);
    expect(a.wordTiming).toBe('segment');
  });
});

describe('the one writer: provider words -> assets/<sha8>.transcript.json', () => {
  test('builds a strictly valid maude.transcript with the engine named', () => {
    const t = providerWordsToTranscript(
      [
        { text: 'there.', start: 0.4, end: 0.8 },
        { text: 'Hello', start: 0, end: 0.4 }, // out of order: sorted
        { text: '   ', start: 1, end: 1.1 }, // blank: dropped
        { text: 'zero', start: 2, end: 2 }, // end <= start: made positive
      ],
      SRC,
      { id: 'elevenlabs-scribe', timing: 'provider', model: 'scribe_v1' },
      { lang: 'en', now: new Date('2026-11-07T10:00:00Z') }
    );
    expect(validateTranscript(t, { strict: true, rel: 'assets/deadbeef.transcript.json' })).toEqual(
      { ok: true, errors: [] }
    );
    expect(t.words.map((w) => [w.id, w.text])).toEqual([
      ['w0', 'Hello'],
      ['w1', 'there.'],
      ['w2', 'zero'],
    ]);
    expect(t.words[2].t1).toBeGreaterThan(t.words[2].t0);
    expect(t.engine).toEqual({ id: 'elevenlabs-scribe', timing: 'provider', model: 'scribe_v1' });
    expect(t.speech.source).toBe('words');
    expect(t.speech.regions.length).toBeGreaterThan(0);
  });

  test('writes the sidecar atomically and a reader gets the words back', () => {
    const root = designRoot();
    const rel = writeProviderTranscript(
      root,
      SRC,
      [{ text: 'Hi', start: 0, end: 0.3 }],
      { id: 'groq-whisper', timing: 'provider' },
      {}
    );
    expect(rel).toBe('assets/deadbeef.transcript.json');
    const r = readTranscript(readFileSync(join(root, rel as string), 'utf8'), rel as string);
    expect(r.ok && r.value.words[0].text).toBe('Hi');
    expect(r.ok && r.value.engine.id).toBe('groq-whisper');
  });

  test('no words, or a source that cannot carry a sidecar: nothing is written', () => {
    const root = designRoot();
    const eng = { id: 'groq-whisper', timing: 'provider' } as const;
    expect(writeProviderTranscript(root, SRC, [], eng, {})).toBeNull();
    expect(
      writeProviderTranscript(root, '../etc/passwd', [{ text: 'x', start: 0, end: 1 }], eng, {})
    ).toBeNull();
    expect(existsSync(join(root, 'assets', 'deadbeef.transcript.json'))).toBe(false);
  });
});

describe('persistCloudTranscript (the generate-jobs transcription branch)', () => {
  test('writes the sidecar with the provider mapped to its engine id, model and language', () => {
    const root = designRoot();
    const r = persistCloudTranscript(
      root,
      { provider: 'groq', model: 'whisper-large-v3-turbo', sourceAsset: SRC, lang: 'cs' },
      { words: [{ text: 'Ahoj', start: 0, end: 0.4 }], wordTiming: 'provider' }
    );
    expect(r.path).toBe('assets/deadbeef.transcript.json');
    const t = readTranscript(readFileSync(join(root, r.path as string), 'utf8'));
    expect(t.ok && t.value.engine).toEqual({
      id: 'groq-whisper',
      timing: 'provider',
      model: 'whisper-large-v3-turbo',
    });
    expect(t.ok && t.value.lang).toBe('cs');
  });

  test('an engine that returned no words reports why instead of writing or throwing', () => {
    const root = designRoot();
    const r = persistCloudTranscript(root, { provider: 'elevenlabs', sourceAsset: SRC }, {});
    expect(r.path).toBeNull();
    expect(r.skipped).toMatch(/no word timings/);
    expect(existsSync(join(root, 'assets', 'deadbeef.transcript.json'))).toBe(false);
  });

  test('a refusal by the strict writer never throws (the SRT must survive)', () => {
    const r = persistCloudTranscript(
      '/nonexistent-root-for-t13',
      { provider: 'elevenlabs', sourceAsset: SRC },
      { words: [{ text: 'x', start: 0, end: 1 }] }
    );
    expect(r.path).toBeNull();
    expect(typeof r.skipped).toBe('string');
  });
});
