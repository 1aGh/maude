// edit-ops/clip/index.ts — every clip verb as an edit op (S7.6; S7-slices Q2, decision
// `maude/v2-S7-clip-ops-through-edit-op`).
//
// Each op wraps ONE pure `clip-ops.ts` applier, so the Timeline, the clip inspector, ⌘K and the old
// `/_api/clip-edit` body (now an alias, routes/edit.ts) all reach the same bytes through the one
// dispatcher: same refusal order (held-by-ai during an AI cut, locked, stale via expectRev), one
// write, one snapshot, one undo. Clip ops are ARTBOARD-scoped (`scope: 'artboard'`): a clip is
// addressed by its DDR-150 `stableId` (+ optional `contentHash` fingerprint) inside the comp the
// video artboard `params.artboard` mounts, never by an element ref, so `targets` stays empty.
//
// Op ids are `clip.<verb>` with the legacy `/_api/clip-edit` verb names (`CLIP_EDIT_VERBS` maps
// one to the other). Pure: no IO — the dispatcher owns the read and the write.

import { CanvasEditError } from '../../canvas-edit.ts';
import {
  applyClipAudio,
  applyClipFraming,
  applyClipGrade,
  applyDetachAudio,
  applyEditTransition,
  applyInsertTransition,
  applyMoveClipToOverlay,
  applyMoveClipToStoryline,
  applyRemoveClipRippled,
  applyRemoveTransition,
  applyReorderOverlayLayer,
  applyResolvePlaceholder,
  applySetClipText,
  applySetPlaybackRate,
  applySplitClip,
  applyTrimIn,
  type GradeParams,
} from '../../clip-ops.ts';
import type { EditOp, ResolvedEditOp } from '../types.ts';
import { applyCaptions, captionsPatch } from './captions.ts';
import { applyCutSourceRange } from './cut-source-range.ts';
import { applyCutToBeat } from './cut-to-beat.ts';
import { applyDuck, duckPatch } from './duck.ts';
import { applyFormatAdd, applyFormatUnlink } from './formats.ts';
import { CLIP_GESTURE_OPS } from './gestures.ts';
import { applyPlace, placePatch } from './place.ts';
import { applyReframe, reframePatch } from './reframe.ts';
import { applyTakeSwap } from './take-swap.ts';
import { applyTitleMotion, titleMotionPatch } from './title-motion.ts';

export interface ClipTarget {
  /** designRoot-relative canvas (the appliers use it for messages + the parser's file name) */
  file: string;
  artboard: string | undefined;
  stableId: string;
  hash: string | undefined;
}

type Applied = { source: string } & Record<string, unknown>;

const bad = (file: string, message: string): never => {
  throw new CanvasEditError(message, { canvas: file, id: '' });
};

/** The clip a request names: `params.stableId` (required), `params.contentHash`, `params.artboard`. */
export function clipTarget(req: ResolvedEditOp): ClipTarget {
  const p = req.params;
  if (typeof p.stableId !== 'string' || !p.stableId || p.stableId.length > 256)
    bad(req.file, 'The edit names no clip.');
  if (p.contentHash !== undefined && typeof p.contentHash !== 'string')
    bad(req.file, 'The clip’s fingerprint is not readable.');
  return {
    file: req.file,
    artboard: typeof p.artboard === 'string' ? p.artboard : undefined,
    stableId: p.stableId as string,
    hash: p.contentHash as string | undefined,
  };
}

const finite = (file: string, v: unknown, name: string): number => {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n))
    bad(file, `${name} is required.`);
  return n;
};

/** The artboard a clip / video op edits, for the dispatcher's one artboard-lease check (none named = the
 *  dispatcher widens it to every artboard of the file). */
const heldArtboards = (r: ResolvedEditOp): string[] =>
  typeof r.params.artboard === 'string' && r.params.artboard ? [r.params.artboard] : [];

/** One clip op: the applier's extra return fields become the result's `detail`. */
function clipOp(
  verb: string,
  run: (src: string, t: ClipTarget, p: Record<string, unknown>) => Applied
): EditOp {
  return {
    id: `clip.${verb}`,
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const { source: next, ...detail } = run(source, t, req.params);
      return Object.keys(detail).length ? { source: next, detail } : { source: next };
    },
  };
}

// The legacy `/_api/clip-edit` verbs, in its switch order — each is exactly that verb's applier call.
export const CLIP_VERB_OPS: readonly EditOp[] = [
  clipOp(
    'speed',
    (s, t, p) =>
      applySetPlaybackRate(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        Number(p.rate)
      ) as unknown as Applied
  ),
  clipOp('trim-in', (s, t, p) =>
    applyTrimIn(
      t.file,
      s,
      t.artboard,
      t.stableId,
      t.hash,
      finite(t.file, p.deltaFrames, 'deltaFrames')
    )
  ),
  clipOp('audio', (s, t, p) => {
    const opts: { muted?: boolean; volume?: number | null } = {};
    if (typeof p.muted === 'boolean') opts.muted = p.muted;
    if (p.volume !== undefined) opts.volume = p.volume == null ? null : Number(p.volume);
    return applyClipAudio(t.file, s, t.artboard, t.stableId, t.hash, opts);
  }),
  clipOp('detach-audio', (s, t) => applyDetachAudio(t.file, s, t.artboard, t.stableId, t.hash)),
  clipOp('framing', (s, t, p) => {
    const f = p.framing as { scale?: unknown; x?: unknown; y?: unknown } | null | undefined;
    const framing =
      f == null ? null : { scale: Number(f.scale) || 1, x: Number(f.x) || 0, y: Number(f.y) || 0 };
    return applyClipFraming(t.file, s, t.artboard, t.stableId, t.hash, framing);
  }),
  clipOp('grade', (s, t, p) =>
    applyClipGrade(
      t.file,
      s,
      t.artboard,
      t.stableId,
      t.hash,
      p.grade == null ? null : (p.grade as GradeParams)
    )
  ),
  clipOp('transition', (s, t, p) => {
    const opts: { presentation?: string; durationInFrames?: number } = {};
    if (typeof p.presentation === 'string') opts.presentation = p.presentation;
    if (p.durationInFrames != null) opts.durationInFrames = Number(p.durationInFrames);
    return applyEditTransition(t.file, s, t.artboard, t.stableId, t.hash, opts);
  }),
  clipOp(
    'split',
    (s, t, p) =>
      applySplitClip(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        finite(t.file, p.atFrame, 'atFrame')
      ) as unknown as Applied
  ),
  clipOp(
    'insert-transition',
    (s, t, p) =>
      applyInsertTransition(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        typeof p.presentation === 'string' ? p.presentation : 'fade',
        Number(p.durationInFrames) || 15
      ) as unknown as Applied
  ),
  clipOp('remove-transition', (s, t) =>
    applyRemoveTransition(t.file, s, t.artboard, t.stableId, t.hash)
  ),
  clipOp(
    'set-text',
    (s, t, p) =>
      applySetClipText(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        typeof p.text === 'string' ? p.text : ''
      ) as unknown as Applied
  ),
  clipOp(
    'to-overlay',
    (s, t) =>
      applyMoveClipToOverlay(t.file, s, t.artboard, t.stableId, t.hash) as unknown as Applied
  ),
  clipOp(
    'to-storyline',
    (s, t) =>
      applyMoveClipToStoryline(t.file, s, t.artboard, t.stableId, t.hash) as unknown as Applied
  ),
  clipOp(
    'layer-order',
    (s, t, p) =>
      applyReorderOverlayLayer(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        finite(t.file, p.toIndex, 'toIndex')
      ) as unknown as Applied
  ),
  clipOp(
    'resolve-placeholder',
    (s, t, p) =>
      applyResolvePlaceholder(
        t.file,
        s,
        t.artboard,
        t.stableId,
        t.hash,
        typeof p.src === 'string' ? p.src : '',
        p.mediaKind === 'image' ? 'image' : 'video'
      ) as unknown as Applied
  ),
  // `/_api/remove-sequence`'s ripple remove (DDR-150 P3) — the Transcript panel's ⌫ rides it too
  clipOp('remove', (s, t) => applyRemoveClipRippled(t.file, s, t.artboard, t.stableId, t.hash)),
];

/** `/_api/clip-edit` verb → op id (the alias, routes/edit.ts). */
export const CLIP_EDIT_VERBS: ReadonlyMap<string, string> = new Map(
  CLIP_VERB_OPS.filter((o) => o.id !== 'clip.remove').map((o) => [o.id.slice('clip.'.length), o.id])
);

/** The picker's tiles (and the v1 grid's names) → the `@remotion/transitions` presentation each plays. */
export const TRANSITION_TILES: Readonly<Record<string, string>> = Object.freeze({
  cut: 'none',
  none: 'none',
  fade: 'fade',
  slide: 'slide',
  wipe: 'wipe',
  flip: 'flip',
  clock: 'clock-wipe',
  'clock-wipe': 'clock-wipe',
});

/** The artboard a whole-comp op names (`params.artboard`), or undefined for the file's only comp. */
const artboardOf = (req: ResolvedEditOp) =>
  typeof req.params.artboard === 'string' ? req.params.artboard : undefined;

/** `{ [src]: seconds }` — finite, positive, ≤ 500 sources; anything else is dropped. */
function sourceSeconds(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [k, n] of Object.entries(v as Record<string, unknown>).slice(0, 500))
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) out[k] = n;
  return out;
}

// S7.6 — the V2-1.10 §5.7 ops that are not legacy `/_api/clip-edit` verbs (no alias: new callers use
// `/_api/edit-op`).
export const VIDEO_OPS: readonly EditOp[] = [
  // edit by transcript (#8): one write, split × ≤ 2 + ripple remove
  clipOp('cut-source-range', (s, t, p) => {
    const r = applyCutSourceRange(
      t.file,
      s,
      t.artboard,
      t.stableId,
      t.hash,
      finite(t.file, p.srcStart, 'srcStart'),
      finite(t.file, p.srcEnd, 'srcEnd')
    );
    return {
      source: r.source,
      removedFrames: r.removedFrames,
      fromFrame: r.fromFrame,
      toFrame: r.toFrame,
    };
  }),
  {
    // Cut to the beat (#9): roll edits, the length unchanged; uncuttable cut points are reported
    id: 'video.cut-to-beat',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const p = req.params;
      if (
        !Array.isArray(p.beats) ||
        p.beats.some((b) => typeof b !== 'number' || !Number.isFinite(b))
      )
        bad(req.file, 'The beats are not readable.');
      const every = p.every === undefined ? 1 : Number(p.every);
      if (every !== 1 && every !== 2 && every !== 4) bad(req.file, 'Every is 1, 2 or 4 beats.');
      const r = applyCutToBeat(
        req.file,
        source,
        artboardOf(req),
        p.beats as number[],
        every as 1 | 2 | 4,
        sourceSeconds(p.sources)
      );
      return { source: r.source, detail: { moved: r.moved, kept: r.kept } };
    },
  },
  // S7.6c — the comp vocabulary (V2-1.10 §5.3 + S7 Q4/Q5). Each is one write, so one undo step.
  {
    // Re-frame: focus keyframes in source time, zoom, fit, per-format focus (07 ve-reframe)
    id: 'video.reframe',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const r = applyReframe(
        t.file,
        source,
        t.artboard,
        t.stableId,
        t.hash,
        reframePatch(t.file, req.params, t.stableId)
      );
      return { source: r.source, detail: { reframed: r.reframed } };
    },
  },
  {
    // Fill · Fit · Blur behind (07 ve-fit-fill): the `fit` of the clip's <Reframe>
    id: 'video.fit',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      if (req.params.fit === undefined) bad(t.file, 'Fit is fill, fit or blur.');
      const r = applyReframe(t.file, source, t.artboard, t.stableId, t.hash, {
        fit: reframePatch(t.file, { fit: req.params.fit }, t.stableId).fit ?? null,
      });
      return { source: r.source, detail: { reframed: r.reframed } };
    },
  },
  {
    // Lower under speech (07 ve-music): <Duck> around one music <Audio>, or `off: true`
    id: 'video.music.duck',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const r = applyDuck(
        t.file,
        source,
        t.artboard,
        t.stableId,
        t.hash,
        duckPatch(t.file, req.params, t.stableId)
      );
      return { source: r.source, detail: { ducked: r.ducked } };
    },
  },
  {
    // Captions from speech (07 ve-captions): the comp's one <Captions>, inserted or restyled
    id: 'video.captions.add',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const r = applyCaptions(
        req.file,
        source,
        artboardOf(req),
        captionsPatch(req.file, req.params)
      );
      return { source: r.source, detail: { inserted: r.inserted } };
    },
  },
  {
    // A title's position, shared or per format (S7 Q5, 07 ve-formats)
    id: 'video.place',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const r = applyPlace(
        t.file,
        source,
        t.artboard,
        t.stableId,
        t.hash,
        placePatch(t.file, req.params, t.stableId)
      );
      return { source: r.source, detail: { placed: r.placed } };
    },
  },
  {
    // A title's entrance (S7.10, 07 ve-text): <TitleMotion preset frames> around its content
    id: 'video.title.motion',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const r = applyTitleMotion(
        t.file,
        source,
        t.artboard,
        t.stableId,
        t.hash,
        titleMotionPatch(t.file, req.params, t.stableId)
      );
      return { source: r.source, detail: { motion: r.motion } };
    },
  },
  {
    // A join's transition (S7.10, 07 ve-transition): the six tiles of the picker and its Length — Cut · Fade ·
    // Slide · Wipe · Flip · Clock wipe. `stableId` is the TRANSITION's own id, as for clip.transition.
    id: 'video.transition.set',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const p = req.params;
      const opts: { presentation?: string; durationInFrames?: number } = {};
      if (p.presentation !== undefined) {
        const key =
          typeof p.presentation === 'string' && Object.hasOwn(TRANSITION_TILES, p.presentation)
            ? TRANSITION_TILES[p.presentation]
            : undefined;
        if (!key) bad(t.file, 'A join takes Cut, Fade, Slide, Wipe, Flip or Clock wipe.');
        opts.presentation = key;
      }
      if (p.durationInFrames !== undefined) {
        const n = Number(p.durationInFrames);
        if (!Number.isFinite(n) || n < 1 || n > 600)
          bad(t.file, 'A transition is 1 to 600 frames.');
        opts.durationInFrames = Math.round(n);
      }
      if (opts.presentation === undefined && opts.durationInFrames === undefined)
        bad(t.file, 'There is nothing to change in this transition.');
      return applyEditTransition(t.file, source, t.artboard, t.stableId, t.hash, opts);
    },
  },
  {
    // + Add a format: a linked copy of the video artboard, same comp (S7 Q4)
    id: 'video.format.add',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const r = applyFormatAdd(req.file, source, artboardOf(req), req.params);
      return { source: r.source, detail: { artboard: r.artboard, aspect: r.aspect } };
    },
  },
  {
    // Make an unlinked copy: this artboard gets its own fork of the comp
    id: 'video.format.unlink',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const r = applyFormatUnlink(req.file, source, artboardOf(req), req.params);
      return { source: r.source, detail: { comp: r.comp } };
    },
  },
  {
    // Other takes (07 ve-ai-adjust): same source, new in-point, same length
    id: 'video.take.swap',
    scope: 'artboard',
    artboards: heldArtboards,
    apply(source, req) {
      const t = clipTarget(req);
      const p = req.params;
      const len = p.sourceSeconds === undefined ? undefined : Number(p.sourceSeconds);
      if (len !== undefined && !(Number.isFinite(len) && len > 0))
        bad(t.file, 'The source’s length is not readable.');
      const r = applyTakeSwap(
        t.file,
        source,
        t.artboard,
        t.stableId,
        t.hash,
        finite(t.file, p.srcStart, 'srcStart'),
        len
      );
      return { source: r.source, detail: { trimBefore: r.trimBefore } };
    },
  },
];

/** Everything S7.6 appends to `EDIT_OPS`. */
export { CLIP_GESTURE_OPS };
export const CLIP_OPS: readonly EditOp[] = [...CLIP_VERB_OPS, ...CLIP_GESTURE_OPS, ...VIDEO_OPS];
