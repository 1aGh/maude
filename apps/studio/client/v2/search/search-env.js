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
  /** S1.5, desktop only (search-projects.js `desktopProjectsEnv`): (q, {signal}) => Promise<{groups}|null>.
   *  Null here — a browser tab has no other projects to ask, so ⌘K groups nothing by project. */
  searchProjects: null,
  /** (row) => void — ↵ on another project's row: the shell switches to (or opens) its tab */
  openSearchResult: () => {},
  /** { pid, name } of this tab's project — the "this tab" group's header */
  ownProject: null,
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

/** Longest query the composer takes from ⌘K (a search box line, not a document). */
export const ASK_AI_MAX = 2000;

/**
 * The AI chat composer's side: take a parked query (the panel mounted after ⌘K fired) and every
 * later one, hand each to `onText` once. Only fills the composer — the person still sends it.
 * @returns unsubscribe
 */
export function subscribeAskAI(onText, target = globalThis) {
  const take = (text) => {
    target[ASK_AI_PENDING_KEY] = undefined;
    if (typeof text === 'string' && text.trim()) onText(text.slice(0, ASK_AI_MAX));
  };
  if (target[ASK_AI_PENDING_KEY]) take(target[ASK_AI_PENDING_KEY]);
  const on = (e) => take(e?.detail?.text);
  target.addEventListener?.(ASK_AI_EVENT, on);
  return () => target.removeEventListener?.(ASK_AI_EVENT, on);
}
