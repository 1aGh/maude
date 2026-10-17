// client/v2/left-panel/left-panel-bus.js — V2-4.4a: "open the Trash list" from outside the Canvases
// panel (⌘K "Trash"). The panel may not be mounted when the request comes (the Layers tab is
// showing), so a request is remembered until the Canvases panel mounts and takes it; a mounted panel
// hears the event at once.
//
// S1.2 adds the same two-part shape for the registry actions that act on the OPEN canvas but whose
// state lives in the panel — pin, unpin, sort, rename in place (`canvases.pin` · `canvases.unpin` ·
// `canvases.sort` · `canvas.rename`): `requestCanvasesOp` queues and notifies, the panel drains the queue
// on mount and on every event. And `dispatchCanvasOp` is the one-way line to the shell's tab hook for the
// two that need its closures (`canvas.copy-link`, `canvas.trash`).

export const OPEN_TRASH_EVENT = 'maude:open-trash';
let pending = false;

/** Ask the Canvases panel to show the Trash list (the caller also brings the panel up). */
export function requestTrash(target = globalThis.window) {
  pending = true;
  target?.dispatchEvent?.(new CustomEvent(OPEN_TRASH_EVENT));
}

/** The panel took the request. @returns whether one was waiting. */
export function takeTrashRequest() {
  const was = pending;
  pending = false;
  return was;
}

export const CANVASES_OP_EVENT = 'maude:canvases-op';
let ops = [];

/**
 * Ask the Canvases panel to do `op`: `{ op: 'pin', path, pinned }`, `{ op: 'sort' }` or
 * `{ op: 'rename', path }`. Remembered until a mounted panel drains it.
 */
export function requestCanvasesOp(op, target = globalThis.window) {
  ops.push(op);
  target?.dispatchEvent?.(new CustomEvent(CANVASES_OP_EVENT));
}

/** Everything waiting, oldest first; the queue is empty afterwards. */
export function takeCanvasesOps() {
  const out = ops;
  ops = [];
  return out;
}

export const CANVAS_OP_EVENT = 'maude:canvas-op';

/** Tell the shell's tab hook to run `op` ('copy-link' | 'trash') on `path`. */
export function dispatchCanvasOp(op, path, label, target = globalThis.window) {
  target?.dispatchEvent?.(new CustomEvent(CANVAS_OP_EVENT, { detail: { op, path, label } }));
}
