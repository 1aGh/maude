// S7.11 test harness: an in-memory video (one canvas source, its transcripts) behind a fake shell door.
// The "pipe" applies the REAL edit ops (applyCaptions / applyCutSourceRange) to the source, and the
// comp-media answer is derived with the REAL derive.ts — so what the tests see is what the studio would.

import { applyCaptions, captionsPatch } from '../edit-ops/clip/captions.ts';
import { applyCutSourceRange } from '../edit-ops/clip/cut-source-range.ts';
import { compMediaStore } from '../client/v2/transcript/comp-media-store.js';
import { transcriptDoor, transcriptUi } from '../client/v2/transcript/captions-api.js';
import { captionsOf, compClips, compSpeech, compWords } from '../video/derive.ts';

export const FILE = 'ui/Reel.tsx';
export const A = 'assets/7c40e2b1.mp4';

export const source = (captions = '') =>
  [
    'const TOTAL = 150;',
    'const Reel = () => (',
    '  <>',
    '    <TransitionSeries>',
    `      <TransitionSeries.Sequence name="a" durationInFrames={150}><OffthreadVideo src="${A}" /></TransitionSeries.Sequence>`,
    '    </TransitionSeries>',
    captions,
    '  </>',
    ');',
    'export default function Canvas() {',
    '  return (',
    '    <DesignCanvas>',
    '      <DCArtboard id="reel"><VideoComp component={Reel} durationInFrames={TOTAL} fps={30} /></DCArtboard>',
    '    </DesignCanvas>',
    '  );',
    '}',
  ].join('\n');

export const WORDS = [
  { id: 'w0', t0: 0.2, t1: 0.97, text: 'Přišel' },
  { id: 'w1', t0: 1.0, t1: 1.4, text: 'Ehm…' },
  { id: 'w2', t0: 1.43, t1: 1.7, text: 'Za' },
];

export interface Video {
  source: string;
  transcripts: Record<string, any>;
  calls: Array<{ clipRef: unknown; verb: string; params: any }>;
  toasts: Array<{ text: string; ok: boolean; action?: { label: string; onClick: () => void } }>;
  fails: Array<[string, string]>;
  analysed: string[];
  undone: number;
  settings: number;
  engine: 'ok' | 'none';
  answer?: (verb: string) => unknown;
}

export function mediaOf(v: Video) {
  const c = compClips(FILE, v.source, 'reel');
  const transcripts: Record<string, any> = {};
  for (const [src, t] of Object.entries(v.transcripts)) {
    transcripts[src] = { ...t, asset: src, speech: { source: 'words', regions: [] } };
  }
  const caps = captionsOf(v.source);
  return {
    fps: c.fps,
    clips: c.clips,
    words: compWords(c, transcripts, caps?.fixes ?? []),
    speech: compSpeech(c, transcripts),
    beats: [],
    unresolved: c.unresolved,
    transcripts: Object.fromEntries(
      Object.entries(v.transcripts).map(([s, t]) => [s, { words: t.words }])
    ),
    captions: caps,
  };
}

export function video(opts: Partial<Video> = {}): Video {
  return {
    source: source(),
    transcripts: {},
    calls: [],
    toasts: [],
    fails: [],
    analysed: [],
    undone: 0,
    settings: 0,
    engine: 'ok',
    ...opts,
  };
}

/** Install the fake door + a fetch that answers comp-media from the in-memory video. */
export function install(v: Video) {
  compMediaStore.reset();
  transcriptUi.reset();
  const realFetch = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(mediaOf(v))) as unknown as typeof fetch;
  const off = transcriptDoor.set({
    target: () => ({ canvas: FILE, artboard: 'reel' }),
    canEdit: () => true,
    nameOf: () => 'the interview',
    async run(clipRef: unknown, verb: string, params: any) {
      v.calls.push({ clipRef, verb, params });
      if (v.answer) return v.answer(verb);
      if (verb === 'video.captions.add') {
        v.source = applyCaptions(FILE, v.source, 'reel', captionsPatch(FILE, params)).source;
        return { ok: true, writeId: 'w1' };
      }
      if (verb === 'cut-source-range') {
        const r = applyCutSourceRange(
          FILE,
          v.source,
          'reel',
          (clipRef as { stableId: string }).stableId,
          undefined,
          params.srcStart,
          params.srcEnd
        );
        v.source = r.source;
        return { ok: true, writeId: 'w2', removedFrames: r.removedFrames };
      }
      return { ok: false, message: 'unknown verb' };
    },
    async analyse(asset: string) {
      v.analysed.push(asset);
      if (v.engine === 'none') return { ok: false, reason: 'no-engine' };
      v.transcripts[asset] = { durationSec: 12, words: WORDS };
      return { ok: true };
    },
    toast: (text: string, ok: boolean, action?: { label: string; onClick: () => void }) =>
      v.toasts.push({ text, ok, action }),
    undo: () => {
      v.undone += 1;
    },
    fail: (prefix: string, message: string) => v.fails.push([prefix, message]),
    openSettings: () => {
      v.settings += 1;
    },
  });
  return () => {
    off();
    globalThis.fetch = realFetch;
  };
}
