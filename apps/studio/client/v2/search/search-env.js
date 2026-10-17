// client/v2/search/search-env.js — V2-4.6: what ⌘K needs from the shell that is not a registry row.
//
// The shell binds it (hooks/use-palette-and-panels.jsx, like `menuRunner.bind`); the palette reads it
// when it opens. Unbound, every method is a no-op and Ask AI is off — a surface with no shell (a test,
// a stray mount) cannot open canvases or call the AI by accident.

const NONE = Object.freeze({
  /** () => boolean — Ask AI is a desktop thing (the chat panel is native-only) */
  canAskAI: () => false,
  /** (query) => void */
  askAI: () => {},
  /** (path, artboardId|null) => void — open a canvas (and select an artboard in it) */
  openCanvas: () => {},
  designRel: '.design',
});

let current = NONE;
let owner = null;

/** @returns an unbind function that only unbinds its own binding. */
export function bindPaletteEnv(env) {
  owner = env;
  current = Object.freeze({ ...NONE, ...env });
  return () => {
    if (owner === env) {
      owner = null;
      current = NONE;
    }
  };
}

export function getPaletteEnv() {
  return current;
}

/** Event the AI chat panel listens for to take a query as its first message (ChatPanel owns the
 *  composer — patch request). `detail: { text }`. */
export const ASK_AI_EVENT = 'maude:ask-ai';

/** The text waiting for a chat panel that mounts after the event fired. */
export const ASK_AI_PENDING_KEY = '__maudeAskAiPending';

/** Hand `text` to the AI chat: park it, then announce it. The panel takes it from whichever comes first. */
export function sendToAskAI(text, target = globalThis) {
  target[ASK_AI_PENDING_KEY] = text;
  target.dispatchEvent?.(new CustomEvent(ASK_AI_EVENT, { detail: { text } }));
}
