// client/v2/left-panel/left-panel-bus.js — V2-4.4a: "open the Trash list" from outside the Canvases
// panel (⌘K "Trash"). The panel may not be mounted when the request comes (the Layers tab is
// showing), so a request is remembered until the Canvases panel mounts and takes it; a mounted panel
// hears the event at once.

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
