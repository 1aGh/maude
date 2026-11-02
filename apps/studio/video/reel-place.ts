// video/reel-place.ts — S7.14: the AI cut, placed shot by shot (contract V2-1.10 §4 #8, §5.7, §5.9).
//
// `maude design reel-place <edl-slug> --next` appends the FIRST shot of the EDL that the comp does not
// have yet — matched by its `name` — as one literal `<TransitionSeries.Sequence>` and moves `TOTAL` with it.
// One call = one write; inside a V2-1.15 run each write is a staged write of the run (V2-1.5 §5.5), so the
// shots land live, Stop keeps what is placed, and the whole cut is one action and one ⌘Z.
//
// The write is composed from the Timeline's own appliers (clip-ops.ts), so the AI's bytes are the bytes a
// person's drop makes (rule 14): `applyInsertClipAt` (storyline, at the end), then the transition into the
// shot is made to match the EDL (`applyInsertTransition` / `applyEditTransition` / `applyRemoveTransition`),
// then `applyFitTotalToContent` — TOTAL ends where the last clip ends. The shot's `name` and source in-point
// (`trimBefore`) are literal attributes, so the Timeline reads them as text (never a `.map()`).
//
// Progress is DERIVED from the comp, never from the model's prose (V2-1.15 amendment): `placeProgress`
// counts the EDL shots the comp already holds and finds the AI edge — the end frame of the last one placed.
// Pure: no I/O here; the verb (bin/_reel-place.mjs) and the run registry (ai/run-progress.ts) do the reading.

import { CanvasEditError, enumerateClips } from '../canvas-edit.ts';
import {
  applyEditTransition,
  applyFitTotalToContent,
  applyInsertClipAt,
  applyInsertTransition,
  applyRemoveTransition,
  PRESENTATION_KEYS,
} from '../clip-ops.ts';
import type { Edl } from '../footage/schema.ts';
import { type CompClips, compClips } from './derive.ts';

/** A shot name is a label people read on the timeline ("Tackle 2"); this many characters at most. */
export const SHOT_NAME_MAX = 60;
const NAME_UNSAFE = /[^\p{L}\p{N} ._'()-]+/gu;

export interface EdlShot {
  /** 1-based position in the EDL ("shot 7") */
  n: number;
  /** the stable Timeline identity the comp carries (`name="…"`, `ClipInfo.stableId` `name:<name>`) */
  name: string;
  /** `assets/<sha8>.<ext>` */
  clip: string;
  /** source in-point, seconds */
  startSec: number;
  /** length in OUTPUT frames at the EDL's fps */
  durationFrames: number;
  /** the transition INTO this shot (null = a hard cut) */
  transition: { presentation: string; frames: number } | null;
}

/** An EDL name as the comp can carry it: letters, digits, space and `._'()-` only, capped. */
export function shotName(raw: unknown, n: number): string {
  const s = (typeof raw === 'string' ? raw : '')
    .replace(NAME_UNSAFE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SHOT_NAME_MAX)
    .trim();
  return s || `Shot ${n}`;
}

/** The EDL's shots in order, each with a unique, comp-safe name (a repeat gets " 2", " 3", …). */
export function edlShots(edl: Edl): EdlShot[] {
  const seen = new Map<string, number>();
  return (edl.beats ?? []).map((b, i) => {
    const n = i + 1;
    let name = shotName(b.name, n);
    const k = (seen.get(name) ?? 0) + 1;
    seen.set(name, k);
    if (k > 1) name = `${name.slice(0, SHOT_NAME_MAX - 4)} ${k}`;
    const t = b.transition;
    return {
      n,
      name,
      clip: b.clip,
      startSec: Math.max(0, Number(b.startSec) || 0),
      durationFrames: Math.max(1, Math.round(Number(b.durationFrames) || 1)),
      transition:
        t && Number(t.frames) > 0
          ? {
              presentation: PRESENTATION_KEYS.includes(t.presentation) ? t.presentation : 'fade',
              frames: Math.max(1, Math.round(Number(t.frames))),
            }
          : null,
    };
  });
}

/** The storyline shots of a comp, keyed by name (only named beats — `name:<name>` ids). */
export function storylineByName(c: CompClips): Map<string, CompClips['clips'][number]> {
  const out = new Map<string, CompClips['clips'][number]>();
  for (const s of c.clips) {
    if (s.track !== 'video' || !s.stableId.startsWith('name:')) continue;
    out.set(s.stableId.slice(5), s);
  }
  return out;
}

export type PlaceResult =
  | { status: 'placed'; source: string; shot: EdlShot; placed: number; total: number }
  | { status: 'all-placed'; placed: number; total: number };

const refuse = (canvas: string, message: string): never => {
  throw new CanvasEditError(message, { canvas, id: '' });
};

/**
 * Append the first EDL shot the comp does not have yet. Throws `CanvasEditError` (the message is the line
 * the verb prints) when the EDL has no shots or the comp cannot take one.
 */
export function placeNext(
  canvasAbsPath: string,
  source: string,
  edl: Edl,
  artboardId?: string
): PlaceResult {
  const shots = edlShots(edl);
  if (!shots.length) refuse(canvasAbsPath, 'The cut has no shots to place.');
  const c0 = compClips(canvasAbsPath, source, artboardId);
  const have = storylineByName(c0);
  const placedBefore = shots.filter((s) => have.has(s.name)).length;
  const next = shots.find((s) => !have.has(s.name));
  if (!next) return { status: 'all-placed', placed: placedBefore, total: shots.length };

  const edlFps = Number(edl.fps) > 0 ? Number(edl.fps) : 30;
  const fps = c0.fps;
  const toComp = (f: number) => Math.max(1, Math.round((f * fps) / edlFps));
  const index = c0.clips.filter((s) => s.track === 'video').length;

  // 1 · the shot at the end of the storyline — the drop's own applier (it moves TOTAL)
  const ins = applyInsertClipAt(canvasAbsPath, source, artboardId, {
    lane: 'storyline',
    index,
    durationInFrames: toComp(next.durationFrames),
    mediaTag: 'Video',
    src: next.clip,
  });
  let out = ins.source;

  // 2 · its name and source in-point, as literal attributes
  const cc = enumerateClips(canvasAbsPath, out, artboardId);
  const beat = cc.clips.find((x) => x.stableId === ins.stableId);
  if (!beat || beat.kind !== 'sequence')
    refuse(canvasAbsPath, 'The shot did not land on the video.');
  const b = beat as NonNullable<typeof beat>;
  const span = out.slice(b.start, b.end);
  const open = `<${b.tag}`;
  if (!span.startsWith(open)) refuse(canvasAbsPath, 'The shot did not land on the video.');
  const srcAttr = /<(?:Video|OffthreadVideo)\b[^>]*?\bsrc="[^"]*"/.exec(span);
  if (!srcAttr) refuse(canvasAbsPath, 'The shot has no footage in it.');
  const trimAt = (srcAttr as RegExpExecArray).index + (srcAttr as RegExpExecArray)[0].length;
  const trim = Math.round(next.startSec * fps);
  out =
    out.slice(0, b.start) +
    `${open} name="${next.name}"` +
    span.slice(open.length, trimAt) +
    ` trimBefore={${trim}}` +
    span.slice(trimAt) +
    out.slice(b.end);

  // 3 · the transition into it, as the EDL says (the drop clones the series' first one, or none)
  if (index > 0) {
    const id = `name:${next.name}`;
    const clips = enumerateClips(canvasAbsPath, out, artboardId).clips;
    const at = clips.findIndex((x) => x.stableId === id);
    const before = clips[at - 1];
    const want = next.transition;
    if (before?.kind === 'transition') {
      if (!want)
        out = applyRemoveTransition(
          canvasAbsPath,
          out,
          artboardId,
          before.stableId,
          undefined
        ).source;
      else
        out = applyEditTransition(canvasAbsPath, out, artboardId, before.stableId, undefined, {
          presentation: want.presentation,
          durationInFrames: toComp(want.frames),
        }).source;
    } else if (want && before) {
      out = applyInsertTransition(
        canvasAbsPath,
        out,
        artboardId,
        before.stableId,
        undefined,
        want.presentation,
        toComp(want.frames)
      ).source;
    }
  }
  // 4 · the video ends where its last clip ends (the house rule, `applyFitTotalToContent`)
  out = applyFitTotalToContent(canvasAbsPath, out, artboardId).source;
  return {
    status: 'placed',
    source: out,
    shot: next,
    placed: placedBefore + 1,
    total: shots.length,
  };
}

// ── progress (V2-1.15 amendment: studio-local, derived from the run's writes) ─────────────────────

export interface PlaceShotView {
  n: number;
  name: string;
  clip: string;
  /** source in / out, seconds */
  srcIn: number;
  srcOut: number;
  /** comp frame the shot starts at */
  at: number;
  /** the shot starts on a beat of the music (within one frame) */
  onBeat: boolean;
  /** `name:<name>` — the clip the timeline draws landing */
  stableId: string;
}

export interface PlaceProgress {
  kind: 'place';
  done: number;
  total: number;
  label: string;
  fps: number;
  /** the AI edge: end frame of the last shot placed */
  edge: number;
  /** the shot that landed last */
  shot: PlaceShotView | null;
}

/** "Placing shots — 7 of 14" (" on the beat" only when every placed shot starts on one). */
export function placeLabel(done: number, total: number, onBeat: boolean): string {
  return `Placing shots${onBeat ? ' on the beat' : ''} — ${done} of ${total}`;
}

/**
 * How far the cut is: the EDL shots the comp holds (by name), the edge and the last shot. `beats` are the
 * comp's beat frames (`compBeats`), empty when there is no music grid. Null when the comp holds none of
 * the EDL's shots (it is not this cut).
 */
export function placeProgress(c: CompClips, edl: Edl, beats: number[] = []): PlaceProgress | null {
  const shots = edlShots(edl);
  const have = storylineByName(c);
  const placed = shots.filter((s) => have.has(s.name));
  if (!placed.length) return null;
  const onBeatAt = (f: number) => beats.some((b) => Math.abs(b - f) <= 1);
  const allOnBeat = beats.length > 0 && placed.every((s) => onBeatAt(have.get(s.name)?.from ?? -9));
  const last = placed[placed.length - 1] as EdlShot;
  const span = have.get(last.name) as CompClips['clips'][number];
  const edlFps = Number(edl.fps) > 0 ? Number(edl.fps) : 30;
  let edge = 0;
  for (const s of placed) {
    const sp = have.get(s.name);
    if (sp) edge = Math.max(edge, sp.from + sp.durationInFrames);
  }
  return {
    kind: 'place',
    done: placed.length,
    total: shots.length,
    label: placeLabel(placed.length, shots.length, allOnBeat),
    fps: c.fps,
    edge,
    shot: {
      n: last.n,
      name: last.name,
      clip: last.clip,
      srcIn: last.startSec,
      srcOut: last.startSec + last.durationFrames / edlFps,
      at: span.from,
      onBeat: onBeatAt(span.from),
      stableId: span.stableId,
    },
  };
}

/** The comp's progress against an EDL, straight from its source (compClips + beats). */
export function placeProgressOf(
  canvasAbsPath: string,
  source: string,
  edl: Edl,
  artboardId: string | undefined,
  beats: number[] = []
): PlaceProgress | null {
  return placeProgress(compClips(canvasAbsPath, source, artboardId), edl, beats);
}
