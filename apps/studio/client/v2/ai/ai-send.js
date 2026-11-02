// client/v2/ai/ai-send.js — S6.3: "send this sentence to the AI chat" as ONE event, for a caller outside the panel
// (Home's first draft, the empty project's prompt). The relay drives the panel's OWN controls — the header's
// New chat, the composer field, its send button — so the sentence takes the composer path and nothing is
// re-implemented: the context block, attachments, the connect gate (the first send with no Claude opens S5's
// ConnectSheet, the prompt is kept), offline queueing and the run registry all behave as for a typed message.
//
//   sendToAi({ prompt, scope: { canvas }, newChat })   → true when the detail is well-formed
//   relayAiSend(island, detail, env)                    → { ok: true } | { ok: false, reason }   (AiChatIsland.jsx)
//
// The detail is UNTRUSTED (it may come from a parked Home intent): it is re-validated here, the prompt is capped at
// the same 4000 characters Rust caps it at, the canvas must look like a canvas path, and the sentence only ever
// reaches the composer as typed text — it is never put in a URL, a selector or HTML.

import { CANVAS_EXT_RE } from '../../shell/constants.js';
import { composerField } from './panel-focus.js';

/** Fired on `window`: the AI chat panel takes the sentence as a new message. `detail`: see `parseAiSend`. */
export const AI_SEND_EVENT = 'maude:ai-send';

/** The detail waiting for a panel that mounts after the event fired (it takes it on mount). */
export const AI_SEND_PENDING_KEY = '__maudeAiSendPending';

/** Rust's cap on an intent's sentence (`validate_intent`); the relay holds the same line. */
export const AI_SEND_MAX = 4000;

/** The line when the chat could not take the sentence (what happened · what is safe · one verb, CONTRACT §4). */
export const AI_SEND_FAILED =
  'The AI chat did not take that. Your canvas is ready. Ask again in the AI chat.';

/** How long the relay waits for the panel, the new chat and the canvas before it gives up. */
export const AI_SEND_TIMEOUT_MS = 4000;

const okCanvasPath = (p) =>
  typeof p === 'string' &&
  p.length > 0 &&
  p.length <= 512 &&
  CANVAS_EXT_RE.test(p) &&
  !p.split('/').includes('..') &&
  ![...p].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

/**
 * `{ prompt, scope?: { canvas }, newChat? }` → the clean detail, or null.
 * @returns {{ prompt: string, canvas: string | null, newChat: boolean } | null}
 */
export function parseAiSend(detail) {
  if (!detail || typeof detail !== 'object') return null;
  const prompt = typeof detail.prompt === 'string' ? detail.prompt.trim() : '';
  if (!prompt || [...prompt].length > AI_SEND_MAX) return null;
  const raw = detail.scope?.canvas;
  if (raw != null && !okCanvasPath(raw)) return null;
  return { prompt, canvas: raw ?? null, newChat: detail.newChat === true };
}

/** Hand a sentence to the AI chat. The panel takes it from whichever comes first: the event, or its mount. */
export function sendToAi(detail, target = globalThis) {
  const d = parseAiSend(detail);
  if (!d) return false;
  target[AI_SEND_PENDING_KEY] = d;
  target.dispatchEvent?.(new CustomEvent(AI_SEND_EVENT, { detail: d }));
  return true;
}

/** The panel's side: the parked detail (if any), once. */
export function takePendingAiSend(target = globalThis) {
  const d = target[AI_SEND_PENDING_KEY];
  target[AI_SEND_PENDING_KEY] = undefined;
  return parseAiSend(d);
}

const isShown = (island) =>
  !!island && island.style?.display !== 'none' && island.getAttribute?.('aria-hidden') !== 'true';

/** The path of the canvas the shell shows now (viewport.jsx tags the one active frame). */
const activeCanvasPath = (doc) =>
  doc?.querySelector?.('iframe[data-testid="canvas-frame"]')?.getAttribute?.('data-path') ?? null;

/** A React-controlled textarea only hears a value set through the prototype setter plus an `input` event. */
function setFieldText(field, text) {
  const proto = field.ownerDocument?.defaultView?.HTMLTextAreaElement?.prototype;
  const set = proto && Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (set) set.call(field, text);
  else field.value = text;
  field.dispatchEvent(
    new (field.ownerDocument?.defaultView?.Event ?? Event)('input', { bubbles: true })
  );
}

/**
 * Put `d.prompt` in the AI chat and send it.
 *   1. open the panel if it is folded (the shell's own `maude:open-ai`);
 *   2. `newChat`: press the header's New chat and wait for the fresh field; otherwise the open chat must be empty
 *      (a draft the person is typing is never overwritten);
 *   3. wait until the shell shows `d.canvas` — the context block is frozen at send, so a send before the canvas
 *      is in front would attach the wrong one (the sentence is then left in the field, unsent);
 *   4. type the sentence and press send.
 * @param {HTMLElement | null} island  the `.ai-island` root
 * @param {{ prompt: string, canvas: string | null, newChat: boolean }} d  a `parseAiSend` result
 * @param {{ doc?: Document, wait?: (ms: number) => Promise<void>, now?: () => number, timeoutMs?: number,
 *           openPanel?: () => void }} [env]
 * @returns {Promise<{ ok: true } | { ok: false, reason: 'panel' | 'chat' | 'draft' | 'canvas' | 'send' }>}
 */
export async function relayAiSend(island, d, env = {}) {
  const doc = env.doc ?? island?.ownerDocument ?? globalThis.document;
  const wait = env.wait ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  const now = env.now ?? Date.now;
  const limit = env.timeoutMs ?? AI_SEND_TIMEOUT_MS;
  const t0 = now();
  const until = async (probe) => {
    for (;;) {
      const v = probe();
      if (v) return v;
      if (now() - t0 > limit) return null;
      await wait(16);
    }
  };
  if (!island) return { ok: false, reason: 'panel' };

  if (!isShown(island)) {
    (
      env.openPanel ??
      (() =>
        globalThis.dispatchEvent?.(new CustomEvent('maude:open-ai', { detail: { chat: null } })))
    )();
    if (!(await until(() => isShown(island)))) return { ok: false, reason: 'panel' };
  }

  let field = composerField(island);
  if (d.newChat) {
    const before = field;
    island.querySelector('[data-testid="ai-chat-new"]')?.click();
    field = await until(() => {
      const f = composerField(island);
      return f && f !== before ? f : null;
    });
  } else {
    field = field ?? (await until(() => composerField(island)));
    if (field?.value.trim()) return { ok: false, reason: 'draft' };
  }
  if (!field) return { ok: false, reason: 'chat' };

  const canvasReady = d.canvas ? await until(() => activeCanvasPath(doc) === d.canvas) : true;
  // two ticks: React commits the new canvas into the chat's context before the field is read at send
  await wait(16);
  await wait(16);
  setFieldText(field, d.prompt);
  if (!canvasReady) return { ok: false, reason: 'canvas' };

  const send = await until(() => {
    const b = field.closest('.chat-panel')?.querySelector('.chat-send');
    return b && !b.disabled ? b : null;
  });
  if (!send) return { ok: false, reason: 'send' };
  send.click();
  return { ok: true };
}

let chain = Promise.resolve();

/** One relay at a time: two sends in the same tick take turns and never share a field. */
export function queueAiSend(island, d, env) {
  const run = chain.then(() => relayAiSend(island, d, env));
  chain = run.catch(() => {});
  return run;
}
