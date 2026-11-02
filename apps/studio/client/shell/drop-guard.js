// Document-level drop guard for the shell (DDR-150 dogfood #7, V2-3.6 N-M2).
//
// A drop the page does not take is the browser's to handle, and WebKit's
// default for a dropped file OR LINK is to load it in the TOP frame. A file
// replaced the app with file:// (DDR-150); a link dropped from a canvas ("drag
// this onto the board") navigated the window to whatever it named, where an
// inline script ran with Tauri's IPC present before the native guard bounced it
// (N-M2). So the shell takes every drag: dragover + drop defaults are cancelled
// for every drag type. Component handlers (the TimelinePanel's onDrop, tab and
// layer reordering) still run first — this listener is on the document, in the
// bubble phase, and only blocks the browser fallback.
//
// The one exception: a non-file drag over an editable field, whose default is
// to INSERT the dragged text (dropping a URL into an input is legitimate, and
// inserting never navigates).
//
// A drop onto the canvas IFRAME is that document's event, not this one — the
// canvas origin refuses to be a top-level page instead (canvas-top-level.ts).

function isEditable(target) {
  const el = target && target.nodeType === 1 ? target : target?.parentElement;
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = (el.tagName || '').toUpperCase();
  if (tag === 'TEXTAREA') return !el.disabled && !el.readOnly;
  if (tag === 'INPUT') {
    const type = (el.type || 'text').toLowerCase();
    const texty = ['text', 'search', 'url', 'email', 'tel', 'password', 'number'];
    return texty.includes(type) && !el.disabled && !el.readOnly;
  }
  return false;
}

/** Should the shell cancel this dragover/drop's default action? */
export function shouldCancelDrag(e) {
  const types = Array.from(e.dataTransfer?.types ?? []);
  if (types.includes('Files')) return true;
  return !isEditable(e.target);
}

/** Install the guard on `doc`; returns the uninstaller. */
export function installDropGuard(doc) {
  const onDrag = (e) => {
    if (shouldCancelDrag(e)) e.preventDefault();
  };
  doc.addEventListener('dragover', onDrag);
  doc.addEventListener('drop', onDrag);
  return () => {
    doc.removeEventListener('dragover', onDrag);
    doc.removeEventListener('drop', onDrag);
  };
}
