// edit-ops/clip/duck.ts — `video.music.duck` (S7.6c; V2-1.10 §5.3 `<Duck>`, §5.7 `duck`, 07 ve-music
// "Lower under speech").
//
// `<Duck db={-12} attackMs={200} releaseMs={400}>` wraps exactly ONE music `<Audio>`, which keeps its
// literal src / volume. The track is a clip (`stableId`) or a loose bed under the reel
// (`loose:<cdId | index>`, the id compClips gives it). `{ off: true }` unwraps; otherwise the given
// values are merged into the current ones (absent = keep, first time = the defaults). The dip itself
// is derived at build (`__speech`, `duckGain`) — nothing derived is written. Pure: no IO.

import MagicString from 'magic-string';

import {
  bad,
  ensureCanvasLibImport,
  finish,
  firstIn,
  innerText,
  jsxElements,
  literalProp,
  type Node,
  parseProgram,
  resolveSpan,
  setProp,
  tagOf,
} from './jsx.ts';

export const DUCK_DEFAULTS = { db: -12, attackMs: 200, releaseMs: 400 } as const;
const AUDIO = new Set(['Audio', 'MaudeAudio']);

export interface DuckPatch {
  off?: true;
  db?: number;
  attackMs?: number;
  releaseMs?: number;
}

function num(file: string, v: unknown, lo: number, hi: number, what: string, id: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi)
    bad(file, `${what} is between ${lo} and ${hi}.`, id);
  return v as number;
}

export function duckPatch(file: string, p: Record<string, unknown>, id: string): DuckPatch {
  if (p.off === true) return { off: true };
  const out: DuckPatch = {};
  if (p.db !== undefined) out.db = num(file, p.db, -60, 0, 'The dip (dB)', id);
  if (p.attackMs !== undefined)
    out.attackMs = Math.round(num(file, p.attackMs, 0, 5000, 'Attack (ms)', id));
  if (p.releaseMs !== undefined)
    out.releaseMs = Math.round(num(file, p.releaseMs, 0, 5000, 'Release (ms)', id));
  return out;
}

export function applyDuck(
  file: string,
  source: string,
  artboard: string | undefined,
  stableId: string,
  hash: string | undefined,
  patch: DuckPatch
): { source: string; ducked: boolean } {
  const span = resolveSpan(file, source, artboard, stableId, hash);
  const program = parseProgram(file, source);
  const els = jsxElements(program);
  const hit = firstIn(els, span.start, span.end, AUDIO);
  if (!hit) bad(file, 'Only a music track can be lowered under speech.', stableId);
  const audio = hit as { el: Node; parent: Node | null };
  const duck: Node | null =
    audio.parent?.type === 'JSXElement' && tagOf(audio.parent) === 'Duck' ? audio.parent : null;

  const s = new MagicString(source);
  if (patch.off) {
    if (!duck) return { source, ducked: false };
    s.overwrite(duck.start, duck.end, innerText(source, duck).trim());
    return { source: finish(file, s, stableId), ducked: false };
  }
  const cur = { ...DUCK_DEFAULTS } as { db: number; attackMs: number; releaseMs: number };
  if (duck)
    for (const k of ['db', 'attackMs', 'releaseMs'] as const) {
      const v = literalProp(file, duck, k, stableId);
      if (v !== undefined)
        cur[k] = num(file, v, k === 'db' ? -60 : 0, k === 'db' ? 0 : 5000, k, stableId);
    }
  const next = { ...cur, ...patch };
  if (duck) {
    for (const k of ['db', 'attackMs', 'releaseMs'] as const) setProp(s, duck, k, `{${next[k]}}`);
  } else {
    s.overwrite(
      audio.el.start,
      audio.el.end,
      `<Duck db={${next.db}} attackMs={${next.attackMs}} releaseMs={${next.releaseMs}}>${source.slice(audio.el.start, audio.el.end)}</Duck>`
    );
    ensureCanvasLibImport(s, program, 'Duck');
  }
  return { source: finish(file, s, stableId), ducked: true };
}
