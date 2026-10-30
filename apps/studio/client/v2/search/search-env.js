// client/v2/search/search-env.js — V2-4.6: what ⌘K needs from the shell that is not a registry row.
//
// The shell binds it (hooks/use-palette-and-panels.jsx, like `menuRunner.bind`); the palette reads it
// when it opens. Unbound, every method is a no-op and Ask AI is off — a surface with no shell (a test,
// a stray mount) cannot open canvases or call the AI by accident.

const NONE = Object.freeze({
  /** () => boolean — Ask AI is a desktop thing (the chat panel is native-only) */
  canAskAI: () => false,
  /** (query, { send?, origin }?) => void — `send` is honoured only for the DS origins (ASK_AI_SEND_ORIGINS) */
  askAI: () => {},
  /** (path, artboardId|null) => void — open a canvas (and select an artboard in it) */
  openCanvas: () => {},
  designRel: '.design',
  /** S1.5, desktop only (search-projects.js `desktopProjectsEnv`): (q, {signal}) => Promise<{groups}|null>.
   *  Null here — a browser tab has no other projects to ask, so ⌘K groups nothing by project. */
  searchProjects: null,
  /** (row) => void — ↵ on another project's row: the shell switches to (or opens) its tab */
  openSearchResult: () => {},
  /** S1.23 — this project's name, for a canvas row's meta line ("Alligators brand · 2026/dresy · 12 artboards") */
  projectName: '',
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
 *  composer — patch request). `detail: { text, send?, origin? }`. */
export const ASK_AI_EVENT = 'maude:ask-ai';

/** The ask waiting for a chat panel that mounts after the event fired (`{ text, send?, origin? }`). */
export const ASK_AI_PENDING_KEY = '__maudeAskAiPending';

/**
 * S10.16c — the only origins whose `send: true` is honoured. These are the design-system hosts: a person pressed
 * Make / Switch and restyle / Upgrade / Review in a sheet, and the brief they could read starts the run as their
 * own message. Any other origin — ⌘K, the templates, the empty canvas, a retry — only FILLS the composer, and a
 * `send` it asks for is dropped here AND again by the subscriber (the event is open to any script in the shell).
 */
export const ASK_AI_SEND_ORIGINS = Object.freeze([
  'ds-make',
  'ds-upgrade',
  'ds-restyle',
  'ds-review',
]);

const ORIGIN_RE = /^[a-z][a-z0-9-]{0,31}$/;

/** `{ send?, origin? }` → the clean `{ send: boolean, origin: string | null }`. */
export function askAIOpts(opts) {
  const origin =
    typeof opts?.origin === 'string' && ORIGIN_RE.test(opts.origin) ? opts.origin : null;
  const send = opts?.send === true && origin !== null && ASK_AI_SEND_ORIGINS.includes(origin);
  return { send, origin };
}

const detailOf = (text, opts) => {
  const { send, origin } = askAIOpts(opts);
  return { text, ...(origin ? { origin } : {}), ...(send ? { send: true } : {}) };
};

/** Hand `text` to the AI chat: park it, then announce it. The panel takes it from whichever comes first.
 *  `opts` ({ send, origin }) rides along; see ASK_AI_SEND_ORIGINS. */
export function sendToAskAI(text, target = globalThis, opts = undefined) {
  const detail = detailOf(text, opts);
  target[ASK_AI_PENDING_KEY] = detail;
  target.dispatchEvent?.(new CustomEvent(ASK_AI_EVENT, { detail }));
}

/** Longest query the composer takes from ⌘K (a search box line, not a document). */
export const ASK_AI_MAX = 2000;

/**
 * The AI chat composer's side: take a parked ask (the panel mounted after ⌘K fired) and every later one,
 * hand each to `onText(text, { send, origin })` once. This only REPORTS the ask: whether it is sent is the
 * caller's (`ai/use-ask-ai.js` — the origin list is re-checked here, then the composer's gates).
 * `accepts` (optional): a composer whose chat is not in front declines, leaving the ask for the one that is.
 * @returns unsubscribe
 */
export function subscribeAskAI(onText, target = globalThis, { accepts } = {}) {
  const take = (raw) => {
    if (accepts && !accepts()) return;
    target[ASK_AI_PENDING_KEY] = undefined;
    const d = typeof raw === 'string' ? { text: raw } : raw;
    const text = d?.text;
    if (typeof text === 'string' && text.trim()) onText(text.slice(0, ASK_AI_MAX), askAIOpts(d));
  };
  if (target[ASK_AI_PENDING_KEY]) take(target[ASK_AI_PENDING_KEY]);
  const on = (e) => take(e?.detail);
  target.addEventListener?.(ASK_AI_EVENT, on);
  return () => target.removeEventListener?.(ASK_AI_EVENT, on);
}
