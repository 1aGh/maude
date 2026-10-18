// client/v2/empty/all-trashed-relay.js — S11.5: the shell tells the open canvas which outlines to keep.
//
// Parent → iframe only (the canvas never answers and never says what is in the Trash). The message is
// `{ dgn: 'trashed-artboards', canvas, items: [{ id, label, rect: {x,y,w,h} | null }] }`, built by
// `loadGhosts` (all-trashed-model.js) from the server's own Trash list. The canvas draws a dashed outline at each
// `rect` (artboard-ghosts-overlay.tsx), with no hit area.
//
// Which frame: the iframe whose `data-path` is the canvas (`<designRel>/<canvasPath>`). A frame that has just
// loaded does not listen yet, so it is told again on `loaded` / `canvas-rendered`; an unchanged answer is not
// re-sent to a frame that already has it, and a frame that had outlines is told when they are gone.

const FRAME = 'iframe[data-testid="canvas-frame"]';

export function createGhostLane({ doc = globalThis.document, win = globalThis.window } = {}) {
  let want = null; // { file: repo-relative path of the canvas, canvas: design-relative, items }
  const spoken = new WeakMap(); // Window → the JSON last sent to it
  const frames = () => [...(doc?.querySelectorAll?.(FRAME) ?? [])];
  const pathOf = (f) => f.getAttribute('data-path') || f.dataset?.path || '';

  const tell = (frame, force = false) => {
    const target = frame.contentWindow;
    if (!target) return;
    const mine = want && pathOf(frame) === want.file;
    const items = mine ? want.items : [];
    const canvas = mine ? want.canvas : '';
    const json = JSON.stringify({ canvas, items });
    const before = spoken.get(target);
    if (!force && before === json) return;
    // a frame never spoken to with nothing to say stays quiet; one that had outlines is told they are gone
    if (before === undefined && items.length === 0) return;
    spoken.set(target, json);
    try {
      // A literal `{ dgn }` (not postToCanvas) so the bridge inventory sees this send site.
      target.postMessage({ dgn: 'trashed-artboards', canvas, items }, '*');
    } catch {
      /* detached */
    }
  };
  const tellAll = () => {
    for (const f of frames()) tell(f);
  };

  const onMessage = (e) => {
    const dgn = e.data?.dgn;
    if (dgn !== 'loaded' && dgn !== 'canvas-rendered') return;
    const frame = frames().find((f) => f.contentWindow === e.source);
    if (frame) {
      spoken.delete(frame.contentWindow);
      tell(frame, true);
    }
  };
  win?.addEventListener?.('message', onMessage);

  return {
    /** `file` = the canvas as the tab names it (repo-relative), `canvas` = design-relative; `items` null = none. */
    set(file, canvas, items) {
      want = file && items?.length ? { file, canvas, items } : null;
      tellAll();
    },
    stop() {
      win?.removeEventListener?.('message', onMessage);
      want = null;
    },
  };
}
