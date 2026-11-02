// client/v2/shell/insets-now.js — P8 C5: the occluded insets the shell last sent the canvas, readable by shell
// surfaces that centre on the FREE canvas (the empty block, 05 es-canvas-ai). One value, one subscriber list;
// `use-occluded-insets.js` is the only writer (it publishes whatever it sends), nothing here measures.

const ZERO = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
let current = ZERO;
const subs = new Set();

/** `get` is stable between changes (useSyncExternalStore); `subscribe` returns its unsubscribe. */
export const insetsNow = {
  get: () => current,
  subscribe(fn) {
    subs.add(fn);
    return () => subs.delete(fn);
  },
};

/** Publish the insets just sent; a value equal to the last one wakes nobody. */
export function setShellInsets(next) {
  const n = {
    top: next?.top | 0,
    right: next?.right | 0,
    bottom: next?.bottom | 0,
    left: next?.left | 0,
  };
  if (
    n.top === current.top &&
    n.right === current.right &&
    n.bottom === current.bottom &&
    n.left === current.left
  )
    return;
  current = Object.freeze(n);
  for (const fn of [...subs]) fn();
}
