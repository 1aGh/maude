/**
 * @file       annotations/ui/editor-channel.ts — the text toolbar ⇄ the open editor
 * @scope      apps/studio/annotations/ui/editor-channel.ts
 * @purpose    DDR-242 AD8 (Task 21): the edit-mode context toolbar drives the
 *             open text editor's formatting (bold, size, align…) and mirrors
 *             its live state. They used to talk through document CustomEvents
 *             (`maude:editor-format` / `-state` / `-request`); this is the same
 *             conversation as a typed in-module channel. The editor keeps the
 *             formatting local until commit — writing the element mid-edit
 *             would re-render the editor under the caret.
 */

export type FormatKey = 'bold' | 'italic' | 'underline' | 'strike' | 'fontSize' | 'align';

export interface FormatCommand {
  key: FormatKey;
  value?: unknown;
}

export interface FormatState {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  fontSize?: number;
  align?: string;
}

type Listener<T> = (v: T) => void;

function channel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    send(v: T) {
      for (const l of [...listeners]) l(v);
    },
    listen(l: Listener<T>): () => void {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
  };
}

/** Toolbar → editor: toggle / set a format. */
export const formatCommands = channel<FormatCommand>();

/** Editor → toolbar: the editor's live format. The last value is kept for a toolbar mounting later. */
const stateChannel = channel<FormatState | null>();
let lastState: FormatState | null = null;
export const formatState = {
  publish(s: FormatState | null) {
    lastState = s;
    stateChannel.send(s);
  },
  /** Subscribe; called at once with the current state (a toolbar opening after the editor). */
  listen(l: Listener<FormatState | null>): () => void {
    l(lastState);
    return stateChannel.listen(l);
  },
};
