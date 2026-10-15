// canvas-replay-keys.ts — V2-4.2: the canvas actions the shell's project menu runs through the
// `run-action` lane whose only implementation today is a key handler inside the canvas
// (use-keyboard-discipline.tsx). The menu row does not get a second implementation: the canvas
// replays the action's own chord on its document and the SAME handler runs — with the same guards
// (browse tool, read-only canvas, selection) it has for the key.
//
// Erasable TypeScript only; no imports — it ships in the canvas bundle.

/** action id → the keydown the canvas's key handler answers. */
export const REPLAY_KEYS: Readonly<Record<string, KeyboardEventInit>> = Object.freeze({
  'select.all': { key: 'a', metaKey: true },
  'edit.copy-properties': { key: 'c', metaKey: true, altKey: true },
  'edit.paste-properties': { key: 'v', metaKey: true, altKey: true },
});

/** Replay `id`'s chord on the document body. @returns true when `id` is a replayed action. */
export function replayActionKey(id: unknown, doc: Document = document): boolean {
  if (typeof id !== 'string' || !Object.hasOwn(REPLAY_KEYS, id)) return false;
  (doc.body ?? doc).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...REPLAY_KEYS[id] })
  );
  return true;
}
