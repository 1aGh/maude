// edit-ops/clip/gestures.ts — the timeline gestures that were still v1 routes (S7.9; S7-slices Q2, decision
// `maude/v2-S7-gestures-are-clip-ops`): trim an edge or move a standalone clip (`clip.retime`), drag a beat
// to a new place in the series (`clip.move`), drop footage (`clip.insert`).
//
// Each wraps ONE pure applier that `/_api/retime-sequence`, `/_api/reorder-sequence` and
// `/_api/insert-sequence` already ran on disk, so a gesture now reaches the dispatcher's refusal order
// (held-by-ai, locked, stale), one write and one `writeId` — the one undo step ⌘Z takes back. The old routes
// stay served for v1 callers. Pure: bytes in, bytes out; the dispatcher owns the read and the write.

import { applyRetimeSequenceByClip, CanvasEditError } from '../../canvas-edit.ts';
import { applyFitTotalToContent, applyInsertClipAt, applySeriesMove } from '../../clip-ops.ts';
import type { EditOp, ResolvedEditOp } from '../types.ts';

const bad = (file: string, message: string): never => {
  throw new CanvasEditError(message, { canvas: file, id: '' });
};

const artboardOf = (req: ResolvedEditOp): string | undefined =>
  typeof req.params.artboard === 'string' && req.params.artboard ? req.params.artboard : undefined;

const heldArtboards = (r: ResolvedEditOp): string[] => {
  const a = artboardOf(r);
  return a ? [a] : [];
};

/** A frame count from a request: finite, whole, inside [lo, 100000] — else the request is refused. */
function frames(file: string, v: unknown, name: string, lo: number): number {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n))
    return bad(file, `${name} is not a number.`);
  return Math.max(lo, Math.min(100000, Math.round(n)));
}

const present = (v: unknown): boolean => v !== undefined && v !== null;

const stableIdOf = (req: ResolvedEditOp): string => {
  const id = req.params.stableId;
  if (typeof id !== 'string' || !id || id.length > 256)
    return bad(req.file, 'The edit names no clip.');
  return id;
};
const hashOf = (req: ResolvedEditOp, key: string): string | undefined => {
  const v = req.params[key];
  if (!present(v)) return undefined;
  if (typeof v !== 'string') return bad(req.file, 'The clip’s fingerprint is not readable.');
  return v;
};

const LANES = new Set(['storyline', 'overlay', 'audio']);

/** `clip.retime` — the new length of a clip (trim the end) and/or where a standalone clip starts (move it). */
const retime: EditOp = {
  id: 'clip.retime',
  scope: 'artboard',
  artboards: heldArtboards,
  apply(source, req) {
    const p = req.params;
    const patch: { durationInFrames?: number; from?: number } = {};
    if (present(p.durationInFrames))
      patch.durationInFrames = frames(req.file, p.durationInFrames, 'durationInFrames', 1);
    if (present(p.from)) patch.from = frames(req.file, p.from, 'from', 0);
    if (patch.durationInFrames === undefined && patch.from === undefined)
      return bad(req.file, 'There is nothing to trim or move.');
    const ab = artboardOf(req);
    const r = applyRetimeSequenceByClip(
      req.file,
      source,
      ab,
      stableIdOf(req),
      hashOf(req, 'contentHash'),
      patch
    );
    // The video is as long as its clips: a trim closes the gap and the total follows (the old route's fit).
    const fit = applyFitTotalToContent(req.file, r.source, ab);
    return { source: fit.source, detail: { total: fit.total } };
  },
};

/** `clip.move` — a series beat goes before or after another beat (the drag-to-reorder commit). */
const move: EditOp = {
  id: 'clip.move',
  scope: 'artboard',
  artboards: heldArtboards,
  apply(source, req) {
    const p = req.params;
    const ref = p.refStableId;
    if (typeof ref !== 'string' || !ref || ref.length > 256)
      return bad(req.file, 'The move names no place to drop.');
    if (p.position !== 'before' && p.position !== 'after')
      return bad(req.file, 'A clip can go before or after another clip.');
    const r = applySeriesMove(
      req.file,
      source,
      artboardOf(req),
      stableIdOf(req),
      hashOf(req, 'contentHash'),
      ref,
      hashOf(req, 'refContentHash'),
      p.position
    );
    return { source: r.source, detail: { stableId: r.stableId } };
  },
};

/** `clip.insert` — footage dropped on the timeline: a beat at `index`, or an overlay / audio clip at `from`. */
const insert: EditOp = {
  id: 'clip.insert',
  scope: 'artboard',
  artboards: heldArtboards,
  apply(source, req) {
    const p = req.params;
    if (typeof p.lane !== 'string' || !LANES.has(p.lane))
      return bad(req.file, 'Footage lands on the video, a layer above it, or the music.');
    if (present(p.mediaTag) && typeof p.mediaTag !== 'string')
      return bad(req.file, 'The footage has no readable kind.');
    if (present(p.src) && typeof p.src !== 'string')
      return bad(req.file, 'The footage has no readable path.');
    const ph = p.placeholder as { prompt?: unknown; kind?: unknown } | null | undefined;
    const r = applyInsertClipAt(req.file, source, artboardOf(req), {
      lane: p.lane as 'storyline' | 'overlay' | 'audio',
      ...(present(p.index) ? { index: frames(req.file, p.index, 'index', 0) } : {}),
      ...(present(p.from) ? { from: frames(req.file, p.from, 'from', 0) } : {}),
      durationInFrames: frames(req.file, p.durationInFrames, 'durationInFrames', 1),
      mediaTag: (p.mediaTag as string | null | undefined) ?? null,
      src: (p.src as string | null | undefined) ?? null,
      placeholder:
        ph && typeof ph === 'object' && typeof ph.prompt === 'string'
          ? { prompt: ph.prompt, kind: typeof ph.kind === 'string' ? ph.kind : 'veo' }
          : null,
    });
    return { source: r.source, detail: { stableId: r.stableId } };
  },
};

export const CLIP_GESTURE_OPS: readonly EditOp[] = [retime, move, insert];
