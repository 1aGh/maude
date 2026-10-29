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
  // V2-4.5b — ⌥⌘P pressed with the shell focused: the canvas router asks for Preview / back (Q1).
  'mode.preview': { key: 'p', code: 'KeyP', metaKey: true, altKey: true },
  // S3.11 — the Inspect panel's Edit button (shell): the canvas replays ↵ so inspect-overlay's key handler is
  // the one implementation (it checks the mode, the role and that something is inspected).
  'inspect.edit': { key: 'Enter', code: 'Enter' },
  // S3.14 (G6) — esc pressed with the shell focused: the canvas climbs ITS ladder (the armed tool, the
  // selection, a stroke — bridge/esc-ladder.ts) and only then asks the shell to step the mode back.
  'ui.step-back': { key: 'Escape', code: 'Escape' },
  // p8-sweep-static — ⌘K rows whose only implementation is a canvas key handler: ⌘D duplicates, ⌫ removes and
  // ⇧↵ selects the parent (use-keyboard-discipline.tsx); ⌥⌘1 goes to the first artboard (canvas-lib's viewport
  // keydown). Without these the row posted a run-action nothing answered.
  'object.duplicate': { key: 'd', code: 'KeyD', metaKey: true },
  'object.remove': { key: 'Backspace', code: 'Backspace' },
  'object.select-parent': { key: 'Enter', code: 'Enter', shiftKey: true },
  'view.jump-artboard': { key: '1', code: 'Digit1', metaKey: true, altKey: true },
});

/** A toolbar key (V2-4.5b, `tool.<id>` from MODE_TOOLS): one letter, optionally ⇧. */
const TOOL_CHORD = /^(⇧)?([A-Z])$/;

/**
 * V2-4.5b — a tool key pressed with the shell focused (`run-action {id:'tool.key', params:{key}}`):
 * the canvas replays it so its input router decides — arm here, add one, open a panel, or ask the
 * shell for the other mode. Only a bare letter (or ⇧ + letter) is accepted.
 * @returns true when `id` is the tool-key replay (whether or not the chord was valid).
 */
export function replayToolKey(id: unknown, params: unknown, doc: Document = document): boolean {
  if (id !== 'tool.key') return false;
  const chord = (params as { key?: unknown } | null)?.key;
  const m = typeof chord === 'string' ? TOOL_CHORD.exec(chord) : null;
  if (!m) return true;
  const letter = m[2] as string;
  (doc.body ?? doc).dispatchEvent(
    new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: m[1] ? letter : letter.toLowerCase(),
      code: `Key${letter}`,
      shiftKey: !!m[1],
    })
  );
  return true;
}

/** Replay `id`'s chord on the document body. @returns true when `id` is a replayed action. */
export function replayActionKey(id: unknown, doc: Document = document): boolean {
  if (typeof id !== 'string' || !Object.hasOwn(REPLAY_KEYS, id)) return false;
  (doc.body ?? doc).dispatchEvent(
    new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...REPLAY_KEYS[id] })
  );
  return true;
}
