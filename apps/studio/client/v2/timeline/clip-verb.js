// client/v2/timeline/clip-verb.js — the Timeline's clip verbs ride the one edit-op dispatcher
// (S7.6; decisions `maude/v2-S7-clip-ops-through-edit-op` + `maude/v2-S7-timeline-undo-is-project-undo`).
//
// A clip verb (split, speed, trim-in, remove, …) is `POST /_api/edit-op { op: 'clip.<verb>' }`. Its
// answer carries a `writeId`, never a `seq`: the timeline-local revert stack is retired, and the
// shell posts `record-edit { op: 'edit-op', writeId, label }` to the active canvas so the ONE canvas
// undo stack (⌘Z = `edit.undo`) takes back exactly that verb and ⇧⌘Z re-applies it (the S2-edit-ops
// §5 `revert {writeId}` record — a three-way revert, so a teammate's later change elsewhere survives).
// Routes that still answer a `seq` (the v1 clip routes not yet folded) record the existing
// `reorder` record onto the same stack, so nothing undoes from a second log.
//
// No DOM: `runClipVerb` takes its `fetch` and its `record` sink from the hook
// (client/hooks/use-photo-and-timeline.jsx), so the one flow is what the tests drive.

/** What the toast and the undo row call each verb. */
export const CLIP_VERB_LABELS = {
  speed: 'set speed',
  'trim-in': 'trim in-point',
  audio: 'clip audio',
  'detach-audio': 'detach audio',
  framing: 'crop clip',
  grade: 'grade clip',
  transition: 'edit transition',
  split: 'split clip',
  'insert-transition': 'add transition',
  'remove-transition': 'remove transition',
  'set-text': 'edit text',
  'to-overlay': 'move to overlay layer',
  'to-storyline': 'move to storyline',
  'layer-order': 'reorder layers',
  'resolve-placeholder': 'fill placeholder',
  remove: 'remove clip',
};

export const clipVerbLabel = (verb) => CLIP_VERB_LABELS[verb] || verb;

/**
 * The `/_api/edit-op` body for one clip verb on the clip `{ stableId, contentHash? }` of the video
 * artboard `artboardId` (absent = the canvas's only comp). The verb's own params ride along.
 */
export function clipVerbRequest({ canvas, artboardId, clip, verb, params }) {
  const p = { ...(params && typeof params === 'object' ? params : {}) };
  if (artboardId) p.artboard = artboardId;
  p.stableId = clip.stableId;
  if (typeof clip.contentHash === 'string' && clip.contentHash) p.contentHash = clip.contentHash;
  return { file: canvas, op: `clip.${verb}`, targets: [], params: p };
}

/**
 * The `record-edit` payload a landed edit-op pushes onto the canvas undo stack, or null (refused,
 * or nothing was written — `rev` unchanged is still a write record, so it is kept: undoing a no-op
 * is a no-op). Only `writeId` is read; a `seq` here means an old server and records nothing.
 */
export function editOpUndoPayload(answer, label) {
  if (answer?.ok !== true) return null;
  if (typeof answer.writeId !== 'string' || !answer.writeId) return null;
  return { op: 'edit-op', writeId: answer.writeId, label };
}

/** The `record-edit` payload for a v1 clip route that still answers a server revert `seq`. */
export function seqUndoPayload(canvas, seq, label) {
  if (typeof canvas !== 'string' || !canvas || typeof seq !== 'number') return null;
  return { op: 'reorder', canvas, seq, label };
}

/** `GET /_api/comp-clips` for the canvas (and its video artboard, when the panel knows it). */
export function compClipsUrl(canvas, artboardId) {
  return `/_api/comp-clips?canvas=${encodeURIComponent(canvas)}${artboardId ? `&artboardId=${encodeURIComponent(artboardId)}` : ''}`;
}

/** One line for a refusal: the dispatcher's `message`, an old server's `error`. */
export const refusalText = (j) => (j && (j.message || j.error)) || 'failed';

/**
 * One clip verb, end to end: read the comp's clips, resolve `clipRef` (`resolveClip(cc, clipRef)`),
 * run `clip.<verb>` through `/_api/edit-op`, and on success hand `record` the undo payload.
 * Resolves the answer (`{ ok, … }`), or null when the clip is not on the timeline any more.
 * Never rejects on a refusal; a network failure rejects (the hook toasts it).
 */
export async function runClipVerb({
  fetch: get,
  canvas,
  artboardId,
  clipRef,
  verb,
  params,
  resolveClip,
  record,
}) {
  const cc = await get(compClipsUrl(canvas, artboardId))
    .then((r) => r.json())
    .catch(() => ({}));
  const clip = resolveClip(cc, clipRef);
  if (!clip?.stableId) return null;
  const res = await get('/_api/edit-op', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(clipVerbRequest({ canvas, artboardId, clip, verb, params })),
  });
  const j = await res.json().catch(() => ({ ok: false, message: 'That edit did not go through.' }));
  if (j?.ok === true) {
    const payload = editOpUndoPayload(j, clipVerbLabel(verb));
    if (payload) record(payload);
  }
  return j;
}
