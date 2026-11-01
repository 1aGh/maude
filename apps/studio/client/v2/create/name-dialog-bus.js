// client/v2/create/name-dialog-bus.js — R3 (6): every "make a canvas that needs a name" door asks the same small
// centered dialog, right away. A request is an event the always-mounted NameDialogHost hears; the door that
// asked (⌘K, ⌘N, the menu, the Canvases panel's "+", a folder's "+") need not know where the dialog lives.
//
//   kind 'canvas'  New canvas — a blank canvas, opened with the size picker up (R2-P2)
//   kind 'brief'   New brief canvas — a canvas to write a brief on, for AI to draft from
//
// `target` ({ path, name }) is a folder's "+": the canvas is made, then moved in.

export const NAME_DIALOG_EVENT = 'maude:name-dialog';

export const NAME_DIALOG_KINDS = Object.freeze({
  canvas: Object.freeze({
    title: 'Create canvas',
    label: 'Canvas name',
    defaultName: 'Untitled canvas',
    confirm: 'Create',
  }),
  brief: Object.freeze({
    title: 'Create brief canvas',
    label: 'Brief canvas name',
    defaultName: 'Untitled brief',
    confirm: 'Create',
  }),
});

let pending = null;

/** Ask for the dialog. Remembered until a host takes it, so a door that fires before mount is not lost. */
export function requestNameDialog(req, target = globalThis.window) {
  if (!req || !NAME_DIALOG_KINDS[req.kind]) return;
  pending = req;
  target?.dispatchEvent?.(new CustomEvent(NAME_DIALOG_EVENT, { detail: req }));
}

/** The host took the request. @returns the waiting request, or null. */
export function takeNameDialogRequest() {
  const was = pending;
  pending = null;
  return was;
}
