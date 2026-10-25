// client/clipboard-relay.ts — the shell half of V2-clipboard-objects: the object / artboard clipboard
// LIVES HERE (decision `maude/v2-clipboard-objects-split`), as a handle only — the copied text stays on
// the server (edit-ops/clipboard.ts). The canvas asks for Cut / Copy / Paste with ordinary `dgn:'edit-op'`
// requests; the shell's edit-op relay passes each through `shapeClipRequest` before forwarding it and
// through `noteClipResult` after.
//
//   copy / cut   forwarded as is; an ok answer's `detail.clip` handle becomes the shell's clipboard.
//   paste        the shell names ITS handle (`params.clip`), overwriting whatever the canvas sent — a
//                canvas can never choose what is pasted. Nothing held → refused here, nothing sent.
//   another canvas  a paste of a clip copied in ANOTHER canvas is not run on the canvas's word: the
//                canvas iframe is untrusted (DDR-054, the C4 frame scope), and planted code there must not
//                pull a different canvas's content into its own file. The shell answers `queued` (the
//                canvas records nothing) and asks in its own toast — "Paste 2 objects from Home?" ·
//                Paste — a click on trusted chrome; only then does the shell run the edit-op itself.

import type { EditOpRequest, EditOpResult } from '../edit-ops/types.ts';

export interface ClipHandle {
  id: string;
  kind: 'objects' | 'artboards';
  count: number;
  /** designRoot-relative canvas the clip was read from */
  from: string;
}

export const CLIP_COPY_OPS: ReadonlySet<string> = new Set([
  'object.copy',
  'object.cut',
  'artboard.copy',
]);
export const CLIP_PASTE_OP = 'canvas.paste';
export const NOTHING_TO_PASTE = 'Nothing to paste. Copy an object or an artboard first.';

const CLIP_ID_RE = /^c_[0-9a-f]{16}$/;

let held: ClipHandle | null = null;

/** The handle the shell holds (tests, the menus' "can paste"). */
export function heldClip(): ClipHandle | null {
  return held;
}

/** Tests only. */
export function _setHeldClip(h: ClipHandle | null): void {
  held = h;
}

/** `ui/Home.tsx` / `.design/ui/Home.tsx` → the same key. */
const canvasKey = (f: string) => f.replace(/^\.design\//, '').replace(/^\/+/, '');

/** "Home" for `ui/Home.tsx`. */
export const canvasName = (f: string) =>
  (canvasKey(f).split('/').pop() ?? f).replace(/\.(tsx|jsx)$/, '');

const what = (h: ClipHandle) =>
  h.kind === 'artboards'
    ? h.count === 1
      ? 'the artboard'
      : `${h.count} artboards`
    : h.count === 1
      ? 'the object'
      : `${h.count} objects`;

export type ClipShape =
  | { kind: 'forward'; body: EditOpRequest }
  | { kind: 'reply'; result: EditOpResult }
  | { kind: 'confirm'; body: EditOpRequest; line: string; reply: EditOpResult };

/** What the relay does with one canvas edit-op request. */
export function shapeClipRequest(body: EditOpRequest): ClipShape {
  if (body.op !== CLIP_PASTE_OP) return { kind: 'forward', body };
  const { clip: _theirs, ...params } = body.params ?? {};
  if (!held)
    return { kind: 'reply', result: { ok: false, code: 'invalid', message: NOTHING_TO_PASTE } };
  const out: EditOpRequest = { ...body, params: { ...params, clip: held.id } };
  if (canvasKey(held.from) === canvasKey(body.file)) return { kind: 'forward', body: out };
  return {
    kind: 'confirm',
    body: out,
    line: `Paste ${what(held)} copied in ${canvasName(held.from)}?`,
    // the canvas records nothing for this ask (no write id); the shell's own run records the ⌘Z
    reply: { ok: true, actionId: null, writeId: '', rev: '', refs: [], queued: true },
  };
}

/** After the server answered: a copy / cut's handle becomes the clipboard. */
export function noteClipResult(body: EditOpRequest, result: EditOpResult): void {
  if (!result.ok || !CLIP_COPY_OPS.has(body.op)) return;
  const h = (result.detail as { clip?: Partial<ClipHandle> } | undefined)?.clip;
  if (
    !h ||
    typeof h.id !== 'string' ||
    !CLIP_ID_RE.test(h.id) ||
    (h.kind !== 'objects' && h.kind !== 'artboards') ||
    typeof h.count !== 'number' ||
    typeof h.from !== 'string'
  )
    return;
  held = { id: h.id, kind: h.kind, count: h.count, from: h.from };
}
