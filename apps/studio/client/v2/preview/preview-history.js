// client/v2/preview/preview-history.js — S3.10a: Preview's per-window back stack (S3-links-format §5 "Back").
//
// Following a link pushes where you were; `preview.back` ("‹ Homepage" in the PreviewBar) pops one entry
// and goes there. Shell memory only (never persisted), at most 50 entries, one stack per window (a module
// singleton — each window is its own realm). Leaving Preview clears it. Esc is unchanged: it leaves Preview,
// it does not go back.
//
// An entry is `{ canvas, artboard, name }`: the tab path you were on, the artboard the followed link sat on
// (the camera comes back framed on it — the shell has no camera read from the untrusted canvas, and no new
// shell → canvas message is allowed, S3-links-format §9), and the canvas's display name for the bar.

export const BACK_MAX = 50;

export function createPreviewHistory(max = BACK_MAX) {
  let stack = [];
  const subs = new Set();
  const emit = () => {
    for (const fn of [...subs]) fn();
  };
  return {
    /** @param {{ canvas: string, artboard: string | null, name: string }} entry */
    push(entry) {
      if (!entry || typeof entry.canvas !== 'string' || !entry.canvas) return;
      stack = [
        ...stack,
        { canvas: entry.canvas, artboard: entry.artboard ?? null, name: entry.name || '' },
      ].slice(-max);
      emit();
    },
    /** The entry to go back to, removed; null when there is none. */
    pop() {
      if (!stack.length) return null;
      const top = stack[stack.length - 1];
      stack = stack.slice(0, -1);
      emit();
      return top;
    },
    peek() {
      return stack.length ? stack[stack.length - 1] : null;
    },
    clear() {
      if (!stack.length) return;
      stack = [];
      emit();
    },
    size() {
      return stack.length;
    },
    /** useSyncExternalStore-shaped */
    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    get() {
      return stack;
    },
  };
}

/** This window's stack. */
export const previewHistory = createPreviewHistory();
