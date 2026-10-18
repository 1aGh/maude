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

/** One clip op: the applier's extra return fields become the result's `detail`. */
function clipOp(
  verb: string,
  run: (src: string, t: ClipTarget, p: Record<string, unknown>) => Applied
): EditOp {
  return {
    id: `clip.${verb}`,
    scope: 'artboard',
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

/** Everything S7.6 appends to `EDIT_OPS`. */
export const CLIP_OPS: readonly EditOp[] = [...CLIP_VERB_OPS];
