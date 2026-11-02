// client/v2/code/code-bus.js — S11.7: the lines between a registry action and the surface that owns its state.
//
//   canvas.view-code    ⌘K / the row menu  → `requestViewCode()`   the Viewport opens the code view
//   canvas.copy-error   the registry       → `runErrorOp('copy')`  the mounted broken-canvas card copies
//   canvas.ask-ai-fix   the registry       → `runErrorOp('ask-ai')` the card fills the AI chat composer
//   canvas.last-good    the registry       → `runErrorOp('last-good')` the card goes back (S1.13)
//
// The three card actions only mean something while a card is showing, so they act on the card that is
// mounted and do nothing otherwise (`runErrorOp` says whether one answered). The view-code request is
// remembered until the Viewport mounts and takes it — same shape as left-panel-bus.js.

export const VIEW_CODE_EVENT = 'maude:view-code';
let pendingView = null;

/** Ask for the code view of `canvas` (design-root-relative; omit for the open canvas). */
export function requestViewCode(req = {}, target = globalThis.window) {
  pendingView = { canvas: typeof req.canvas === 'string' ? req.canvas : null };
  target?.dispatchEvent?.(new CustomEvent(VIEW_CODE_EVENT));
}

/** The request waiting for the Viewport (and clears it), or null. */
export function takeViewCodeRequest() {
  const was = pendingView;
  pendingView = null;
  return was;
}

/** A mounted Viewport hears a request at once. @returns unsubscribe */
export function subscribeViewCode(onRequest, target = globalThis.window) {
  const on = () => {
    const r = takeViewCodeRequest();
    if (r) onRequest(r);
  };
  target?.addEventListener?.(VIEW_CODE_EVENT, on);
  const waiting = takeViewCodeRequest();
  if (waiting) onRequest(waiting);
  return () => target?.removeEventListener?.(VIEW_CODE_EVENT, on);
}

/** @type {Map<symbol, Record<string, () => void>>} */
const cards = new Map();

/** The mounted broken-canvas card offers its three actions. @returns unregister */
export function registerErrorCard(handlers) {
  const key = Symbol('error-card');
  cards.set(key, handlers);
  return () => cards.delete(key);
}

/** Run `op` ('copy' | 'ask-ai' | 'last-good') on the newest mounted card. @returns whether one answered */
export function runErrorOp(op) {
  const handlers = [...cards.values()].at(-1);
  const fn = handlers?.[op];
  if (typeof fn !== 'function') return false;
  fn();
  return true;
}

/** Tests only. */
export function resetCodeBusForTest() {
  pendingView = null;
  cards.clear();
}
