// V2-1.10 §7 test #13 — proposed R8 (V2-1.12 §5.1): v1's readers of `.edl.json` and `.footage.json`
// treat a file with ANY unknown key as missing (and a missing analysis invites a re-analysis that
// overwrites it). So v2 adds NO key to either format until a 1.x release ships a preserving reader;
// new per-clip data goes into the transcript / beats sidecars (video/schema.ts).
//
// The guard: the key lists v1.9.1 shipped, frozen below verbatim, against
//   - every `assertKeys` list in today's footage/schema.ts (the validator `/_api/footage`, the
//     footage store and `maude design check --strict` put every write through), and
//   - every object's property set in schema/edl.v1.schema.json (the AI-write schema).
// A new key in either is red here — put the data in a new sidecar instead.

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  emptyFootageAnalysis,
  generatedClipAnalysis,
  validateEdl,
  validateFootageAnalysis,
} from './schema.ts';

/** apps/studio/footage/schema.ts @ v1.9.1 — every `assertKeys(…)` allowed list, in source order. */
const V1_KEY_LISTS: Record<string, readonly string[]> = {
  'footage.root': [
    'version',
    'asset',
    'durationSec',
    'width',
    'height',
    'keyframes',
    'shots',
    'summary',
    'tags',
    'speech',
  ],
  'footage.shot': [
    'start',
    'end',
    'kind',
    'motion',
    'subject',
    'lighting',
    'mood',
    'quality',
    'usable',
    'note',
  ],
  'edl.overlay': ['kind', 'text'],
  'edl.transition': ['presentation', 'frames'],
  'edl.root': [
    'version',
    'title',
    'fps',
    'width',
    'height',
    'beats',
    'music',
    'audioTracks',
    'captions',
  ],
  'edl.beat': ['clip', 'startSec', 'durationFrames', 'why', 'transition', 'overlay', 'name'],
  'edl.music': ['asset', 'fadeOutFrames'],
  'edl.audioTrack': [
    'asset',
    'kind',
    'startFrame',
    'durationFrames',
    'gainDb',
    'fadeInFrames',
    'fadeOutFrames',
    'name',
  ],
  'edl.captions': ['cues', 'style'],
  'edl.cue': ['startSec', 'endSec', 'text'],
};

const sorted = (xs: readonly string[]) => [...xs].sort();
const V1_SETS = Object.values(V1_KEY_LISTS).map((l) => sorted(l).join(','));

/** Every string-array literal passed to `assertKeys(errors, obj, [...], where)` in a source text. */
function assertKeysLists(src: string): string[][] {
  const out: string[][] = [];
  const re = /assertKeys\(\s*errors,\s*[\w.]+,\s*\[([^\]]*)\]/g;
  for (const m of src.matchAll(re))
    out.push([...(m[1] as string).matchAll(/'([^']+)'/g)].map((x) => x[1] as string));
  return out;
}

describe('R8 — .edl.json / .footage.json keys are frozen at v1.9.1', () => {
  test("today's validator allows exactly v1's key lists", () => {
    const src = readFileSync(join(import.meta.dir, 'schema.ts'), 'utf8');
    const lists = assertKeysLists(src).map((l) => sorted(l).join(','));
    expect(lists.length).toBe(V1_SETS.length);
    expect(sorted(lists)).toEqual(sorted(V1_SETS));
  });

  test('the EDL schema names no property v1 would reject', () => {
    const schema = JSON.parse(
      readFileSync(join(import.meta.dir, '..', 'schema', 'edl.v1.schema.json'), 'utf8')
    );
    const allowed = new Set(Object.values(V1_KEY_LISTS).flat());
    const extra: string[] = [];
    const walk = (node: unknown, at: string) => {
      if (!node || typeof node !== 'object') return;
      const o = node as Record<string, unknown>;
      if (o.properties && typeof o.properties === 'object')
        for (const k of Object.keys(o.properties)) if (!allowed.has(k)) extra.push(`${at}.${k}`);
      for (const [k, v] of Object.entries(o)) walk(v, `${at}/${k}`);
    };
    walk(schema, '#');
    expect(extra).toEqual([]);
  });

  test('the in-tree writers emit only those keys (each output passes the frozen-key validator)', () => {
    for (const a of [
      emptyFootageAnalysis('assets/ab12cd34.mp4'),
      generatedClipAnalysis('assets/ab12cd34.mp4', { provider: 'p', model: 'm', prompt: 'x' }),
    ])
      expect(validateFootageAnalysis(a).errors).toEqual([]);
    // and one unknown key anywhere is still a refusal — the v1 behaviour v2 must not provoke
    expect(validateEdl({ version: 1, beats: [], words: [] }).ok).toBe(false);
    expect(validateFootageAnalysis({ version: 1, transcript: 'x' }).ok).toBe(false);
  });
});
