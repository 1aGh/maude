// client/v2/ai/needs-you-toast.js — S5.13: the in-app toasts of the AI chat (03 `ai-needs-hidden`,
// `ai-panel-closed`). Pure builders: the notice object `notify()` (notifications.tsx) takes. The caller decides
// WHEN (the panel is folded, or the chat is not the one in front); these only decide the words.
//
//   needsYouNotice({ id, canvas, line, onOpen })   "AI needs you on Uniformy-2027 — replace 4 team photos?" · Open
//   doneNotice({ id, text, run, artboards, onShow, onUndo })
//                                                  "Done — Post 1:1 is greener. The logo stays white." · Show
//                                                  "Done — Desktop, Tablet and Mobile are updated." · Undo  (01 cf-ai-done)
//
// The question is quoted, never the answer options; the toast stays until it is answered (no auto-dismiss
// timer shorter than the question lives — Needs you has no timeout, D7).

import { changedSomething, describeResult } from './run-model.js';

/** Open the AI chat panel on a chat. The shell listens (lead patch); ChatPanel switches to the chat. */
export const OPEN_AI_EVENT = 'maude:open-ai';

/**
 * `canvas` (optional, S5.18 G4): the canvas the chat is about. A "needs you" toast's Open lands on the canvas that
 * needs you, not just the chat — the shell opens it (app.jsx, same event).
 */
export function openAiChat(chatId, { canvas = null, target = globalThis } = {}) {
  target.dispatchEvent?.(
    new CustomEvent(OPEN_AI_EVENT, { detail: { chat: chatId ?? null, canvas: canvas || null } })
  );
}

/** ".design/ui/Uniformy-2027.tsx" → "Uniformy-2027". */
export function canvasTitle(canvas) {
  if (typeof canvas !== 'string' || !canvas) return null;
  const base = canvas.split('/').pop() ?? canvas;
  return base.replace(/\.(tsx|jsx|html)$/i, '') || null;
}

const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export function needsYouNotice({ id, canvas, line, onOpen }) {
  const where = canvasTitle(canvas);
  const q = clip(
    String(line ?? '')
      .replace(/\s+/g, ' ')
      .trim(),
    120
  );
  const lead = where ? `AI needs you on ${where}` : 'AI needs you';
  return {
    id,
    title: q ? `${lead} — ${q.charAt(0).toLowerCase()}${q.slice(1)}?` : lead,
    kind: 'info',
    // 03 ai-needs-hidden: the one-line island pill, help glyph first (the kit Toast, CONTRACT §4)
    icon: 'help',
    group: 'ai-needs-you',
    // A question has no deadline: the toast outlives the default 10 s and goes when it is answered.
    duration: 600_000,
    action: { label: 'Open', onClick: onOpen },
  };
}

/** The first sentence of an assistant reply, as the "Done — …" toast line. */
export function doneLine(text) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  // 03 ai-panel-closed: "Done — Post 1:1 is greener. The logo stays white." — the reply's first two sentences when
  // they fit one toast line; a longer reply is quoted by its first sentence.
  const sentences = t.split(/(?<=[.!?])\s/);
  const two = sentences.slice(0, 2).join(' ');
  const first = sentences.length > 1 && two.length <= 80 ? two : (sentences[0] ?? t);
  // The reply names its own result ("Done — Post 1:1 is greener…", rule `ai-describes-the-result`); the
  // toast quotes its first sentence and invents no "Done" of its own.
  return clip(first, 140);
}

/**
 * The words of the done toast (P8 C3, 01 cf-ai-done / 03 ai-panel-closed). A reply that opens with "Done" names its
 * own result and is quoted; any other reply ("Drafting the landing page — …") is the AI talking about its work, not
 * the result, so the line comes from the WORK: the artboards the run changed ("Done — Desktop, Tablet and Mobile
 * are updated."), the same sentence the panel's result card carries.
 */
export function doneToastLine(text, run, artboards) {
  const own = doneLine(text);
  if (own && /^done\b/i.test(own)) return own;
  if (run && changedSomething(run)) return describeResult(run, artboards);
  return own;
}

export function doneNotice({ id, text, run = null, artboards = [], onShow, onUndo = null }) {
  const line = doneToastLine(text, run, artboards);
  if (!line) return null;
  // 01 cf-ai-done: when the run changed something the one verb is Undo (the run's whole change comes back);
  // 03 ai-panel-closed: a run that only answered has nothing to undo, so the pill offers Show.
  // 03 ai-panel-closed (the owning board): an ask about named artboards ("Make it greener" on Post 1:1) offers Show;
  // a whole-canvas draft (scope '*') is the first-draft finish and offers Undo.
  const scoped = Array.isArray(run?.scope?.artboards) && run.scope.artboards.length > 0;
  const undo = typeof onUndo === 'function' && !!run && changedSomething(run) && !scoped;
  return {
    id,
    title: line,
    kind: 'success',
    icon: 'spark',
    action: undo ? { label: 'Undo', onClick: onUndo } : { label: 'Show', onClick: onShow },
  };
}
