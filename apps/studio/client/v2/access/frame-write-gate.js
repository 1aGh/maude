// client/v2/access/frame-write-gate.js — gate-b-c4h: the bridge half of "a canvas that imports another
// canvas opens read-only".
//
// The server refuses every write the frame of such a canvas sends itself (access/frame.ts
// `frameAccess`). But canvas code also asks the SHELL to write for it — an edit op, an inline text edit,
// a reorder, a comment, an insert … (the dgn bridge, bridge/dgn-protocol.ts) — and the shell writes on
// the main origin with the viewer's own access, where the frame's narrowing does not reach. Mallory's
// planted A could post `edit-op` carrying B's text and the shell would write it into A, where she reads.
//
// So ONE window-level listener, in the capture phase (at the target, capture listeners run before every
// non-capture `message` listener the bridge hosts register, whatever their order), drops every
// canvas→shell message from such a frame unless its type is on READ_ONLY_FRAME_TYPES: looking, selecting,
// navigating, presence, the render lifecycle — nothing that leads to a write. Fail closed: a new dgn
// type is a write until it is listed here.
//
// Which frame: the shell-owned `src` attribute of the iframe whose window sent it (`canvas` +
// `designRel` params, client/canvas-url.js). Canvas code can navigate its own document, never the
// attribute. Which canvases: the index's `canvasImportsCanvases` (setImportingCanvases, from
// hooks/use-project-data.jsx on every tree load).

/** Canvas→shell types a read-only (importing) frame may still send: none of them writes. */
export const READ_ONLY_FRAME_TYPES = Object.freeze(
  new Set([
    // render lifecycle
    'loaded',
    'canvas-rendered',
    'canvas-failed',
    'canvas-mounted',
    'render-error',
    'render-ok',
    'canvas-expired',
    'canvas-notice',
    // looking and selecting
    'select',
    'select-set',
    'clear-select',
    'annotation-selection',
    'active-artboard',
    'layers-tree',
    'artboards',
    'artboard-empty',
    'artboard-anchor',
    'open-inspector',
    'copy-style',
    'comment-click',
    'view-only-gesture',
    'viewport-zoom',
    'annotations-visibility',
    'tool-cursor',
    'toolbar-rect',
    'tool-panel-open',
    'mode-changed',
    'mode-request',
    'space-tap',
    'key',
    'embed-escape',
    'link-follow',
    // the design-system review overlay reads, never writes
    'ds-review',
    'ds-rects-result',
    'ds-pins-want',
    // timeline playback and presence
    'timeline-comps',
    'timeline-frame',
    'timeline-ended',
    'timeline-playing',
    'timeline-peers',
    'peers',
    'hold-view',
    'present-position',
    'present-run',
    'present-follow-state',
    'present-media',
    // exports the viewer started (a capture of what they can see)
    'open-export',
    'export-history-request',
    'export-selection',
    'export-capture-progress',
    'export-capture-done',
    'export-capture-error',
  ])
);

let importing = {};
let installed = false;

/** The index's `canvasImportsCanvases` (repo-relative canvas → imported canvases). */
export function setImportingCanvases(map) {
  importing = map && typeof map === 'object' ? map : {};
}

/** The repo-relative canvas an iframe `src` frames, or null. */
export function canvasOfFrameSrc(src) {
  try {
    const u = new URL(src, 'http://frame.invalid');
    const canvas = u.searchParams.get('canvas');
    if (!canvas) return null;
    const designRel = (u.searchParams.get('designRel') || '.design').replace(/^\/+|\/+$/g, '');
    return `${designRel}/${canvas}`;
  } catch {
    return null;
  }
}

/** Is `path` (repo-relative) a canvas whose frame is read-only because it imports another canvas? */
export function importsCanvas(path, map = importing) {
  const list = path ? map?.[path] : null;
  return Array.isArray(list) && list.length > 0;
}

/**
 * Should the shell drop this canvas→shell message? Only a dgn message from a frame of an importing
 * canvas whose type is not on READ_ONLY_FRAME_TYPES. `frames` lists the shell's canvas iframes.
 */
export function refusesRelay(e, frames, map = importing) {
  const m = e?.data;
  if (!m || typeof m !== 'object' || typeof m.dgn !== 'string') return false;
  if (READ_ONLY_FRAME_TYPES.has(m.dgn)) return false;
  if (!e.source) return false;
  for (const f of frames) {
    let win = null;
    try {
      win = f.contentWindow;
    } catch {
      win = null;
    }
    if (win !== e.source) continue;
    return importsCanvas(canvasOfFrameSrc(f.getAttribute('src') || ''), map);
  }
  return false;
}

/** Install the gate once (idempotent). */
export function installFrameWriteGate(win = globalThis.window) {
  if (installed || !win?.addEventListener) return;
  installed = true;
  win.addEventListener(
    'message',
    (e) => {
      const frames = win.document ? win.document.querySelectorAll('iframe') : [];
      if (refusesRelay(e, frames)) e.stopImmediatePropagation();
    },
    { capture: true }
  );
}

/** Test seam. */
export function _resetFrameWriteGate() {
  installed = false;
  importing = {};
}
