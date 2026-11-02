// editing/clipboard.ts — the canvas half of V2-clipboard-objects (14 Editing: the object menu's Cut ⌘X ·
// Copy ⌘C · Paste ⌘V, the artboard menu's Copy ⌘C · Paste ⌘V). Every entry — a menu row, a chord, the
// project menu's Edit › Cut / Copy / Paste (`run-action`), a native ⌘V paste — runs `runClipAction`, which
// asks the shell with an ordinary edit-op (`runEditOp`, the one dispatch route; no new write path):
//
//   object.copy / artboard.copy   a read: nothing is written, nothing goes on the undo stack. The shell
//                                 keeps the handle the server answers (client/clipboard-relay.ts).
//   object.cut / canvas.paste     a write: ONE legacy revert record on THIS canvas's undo stack (the same
//                                 `editOpRecord` every edit-op pushes; on an op-log home the kernel
//                                 action is the undo and nothing is pushed here).
//
// The canvas never holds the copied text: a paste names nothing, the shell names its own handle. A copy
// also leaves a one-line marker on the system clipboard (best effort) so ⌘V — WebKit's own paste event
// — knows the next paste is ours and not a picture or a Figma frame (editing/paste-bar.tsx claims those).

import type { EditOpResult, ElementRef } from '../edit-ops/types.ts';
import type { CommandRecord } from '../undo-stack.ts';
import { type EditOpAsk, editOpRecord, runEditOp } from './edit-op.ts';
import { refusalLine } from './object-ops.ts';

export const CLIP_ACTIONS = ['object.copy', 'object.cut', 'artboard.copy', 'canvas.paste'] as const;
export type ClipAction = (typeof CLIP_ACTIONS)[number];

export const isClipAction = (id: unknown): id is ClipAction =>
  typeof id === 'string' && (CLIP_ACTIONS as readonly string[]).includes(id);

/** What the clipboard acts on: the selected objects, else the selected artboards. */
export interface ClipCtx {
  objects: ElementRef[];
  artboards: string[];
  /** artboard paste: where the first copy lands (world px), beside the row */
  at?: { x: number; y: number };
}

export interface ClipDeps {
  run?: (ask: EditOpAsk) => Promise<EditOpResult>;
  toast?: (message: string, kind?: 'info' | 'error') => void;
  record?: (rec: CommandRecord) => void;
  /** select what a paste created, once the canvas shows it */
  select?: (created: ElementRef[], kind: 'objects' | 'artboards') => void;
  /** the system-clipboard marker (best effort), after the server answered */
  mark?: (text: string) => void;
  /** r1 item 13 — the marker written NOW, inside the key's / click's own handling; true when it landed
   *  (then `mark` is skipped). A clipboard write past an await is refused in the canvas frame. */
  markNow?: (text: string) => boolean;
}

/** The marker a copy leaves on the system clipboard; a paste whose text carries it is ours. */
export const CLIP_MARK = 'maude-clip';
export function clipMarker(count: number, kind: 'objects' | 'artboards'): string {
  const what =
    kind === 'artboards'
      ? count === 1
        ? '1 artboard'
        : `${count} artboards`
      : count === 1
        ? '1 object'
        : `${count} objects`;
  return `Maude · ${what} · paste on a canvas (${CLIP_MARK})`;
}
export const isClipMarker = (text: string | null | undefined): boolean =>
  typeof text === 'string' && text.endsWith(`(${CLIP_MARK})`);

/** Edit › Copy / Cut / Paste (the project menu, ⌘K) as the clipboard action for this selection. */
export function clipActionForEdit(
  id: string,
  ctx: Pick<ClipCtx, 'objects' | 'artboards'>
): ClipAction | null {
  if (id === 'edit.paste') return 'canvas.paste';
  if (id === 'edit.copy')
    return ctx.objects.length ? 'object.copy' : ctx.artboards.length ? 'artboard.copy' : null;
  if (id === 'edit.cut') return ctx.objects.length ? 'object.cut' : null;
  return null;
}

const LABEL: Record<ClipAction, string> = {
  'object.copy': 'Copy',
  'artboard.copy': 'Copy',
  'object.cut': 'Cut',
  'canvas.paste': 'Paste',
};

export async function runClipAction(
  action: ClipAction,
  ctx: ClipCtx,
  deps: ClipDeps = {}
): Promise<EditOpResult | null> {
  // ⌘C on an artboard selection copies the artboards (the menu's Copy row is the artboard's own)
  const op: ClipAction =
    action === 'object.copy' && ctx.objects.length === 0 && ctx.artboards.length
      ? 'artboard.copy'
      : action;
  let ask: EditOpAsk;
  if (op === 'artboard.copy') {
    if (ctx.artboards.length === 0) return null;
    ask = { op, targets: [], params: { artboards: [...ctx.artboards] } };
  } else if (op === 'canvas.paste') {
    const anchor = ctx.objects[0];
    const artboard = ctx.artboards[0] ?? anchor?.artboard;
    ask = {
      op,
      targets: anchor ? [anchor] : [],
      params: {
        ...(artboard ? { artboard } : {}),
        ...(ctx.at ? { at: { x: ctx.at.x, y: ctx.at.y } } : {}),
      },
    };
  } else {
    if (ctx.objects.length === 0) return null;
    ask = { op, targets: [...ctx.objects] };
  }
  // r1 item 13 — the marker goes on the clipboard BEFORE the server round trip: the person's key or click is
  // still being handled here, and a clipboard write after the await is refused (WebKit, and Chromium in the
  // cross-origin canvas frame). Without it ⌘V never knew the paste was ours.
  const early =
    op === 'artboard.copy'
      ? clipMarker(ctx.artboards.length, 'artboards')
      : op === 'object.copy' || op === 'object.cut'
        ? clipMarker(ctx.objects.length, 'objects')
        : null;
  const markedNow = early !== null && deps.markNow?.(early) === true;
  const run = deps.run ?? ((a: EditOpAsk) => runEditOp(a));
  const result = await run(ask);
  if (!result.ok) {
    deps.toast?.(refusalLine(result), 'error');
    return result;
  }
  const clip = (result.detail as { clip?: { count?: unknown; kind?: unknown } } | undefined)?.clip;
  if (
    !markedNow &&
    clip &&
    typeof clip.count === 'number' &&
    (clip.kind === 'objects' || clip.kind === 'artboards')
  )
    deps.mark?.(clipMarker(clip.count, clip.kind));
  // a write (cut, paste) is ONE step on this canvas's undo stack; a copy wrote nothing
  if (
    (op === 'object.cut' || op === 'canvas.paste') &&
    result.actionId === null &&
    result.writeId
  ) {
    const rec = editOpRecord(result.writeId, LABEL[op]);
    if (rec) deps.record?.(rec);
  }
  if (op === 'canvas.paste' && result.created?.length) {
    const boards = result.created.every((r) => r.artboard === r.element);
    deps.select?.(result.created, boards ? 'artboards' : 'objects');
  }
  return result;
}

/**
 * r1 item 13 — the marker written synchronously through the frame's OWN copy event: `execCommand('copy')`
 * inside a user gesture fires `copy`, whose `clipboardData.setData` needs no clipboard permission (the async
 * `navigator.clipboard` does, and is refused in the canvas frame). WebKit enables Copy with no text selected
 * only when `beforecopy` is cancelled, so that is cancelled too. Both listeners are one-shot. True when the
 * copy event carried the marker.
 */
export function writeClipMarkerNow(
  text: string,
  doc: Document | undefined = globalThis.document
): boolean {
  if (!doc || typeof doc.execCommand !== 'function') return false;
  let wrote = false;
  const before = (e: Event) => e.preventDefault();
  const copy = (e: Event) => {
    const data = (e as ClipboardEvent).clipboardData;
    if (!data) return;
    data.setData('text/plain', text);
    e.preventDefault();
    e.stopImmediatePropagation();
    wrote = true;
  };
  doc.addEventListener('beforecopy', before, true);
  doc.addEventListener('copy', copy, true);
  try {
    doc.execCommand('copy');
  } catch {
    /* refused */
  } finally {
    doc.removeEventListener('beforecopy', before, true);
    doc.removeEventListener('copy', copy, true);
  }
  return wrote;
}

/** Best-effort system-clipboard write (a blocked clipboard leaves ⌘V to the menus). */
export function writeClipMarker(text: string): void {
  try {
    void globalThis.navigator?.clipboard?.writeText?.(text)?.catch?.(() => {});
  } catch {
    /* clipboard API absent */
  }
}
