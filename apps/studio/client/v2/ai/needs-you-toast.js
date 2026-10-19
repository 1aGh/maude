// client/v2/ai/needs-you-toast.js — S5.13: the in-app toasts of the AI chat (03 `ai-needs-hidden`,
// `ai-panel-closed`). Pure builders: the notice object `notify()` (notifications.tsx) takes. The caller decides
// WHEN (the panel is folded, or the chat is not the one in front); these only decide the words.
//
//   needsYouNotice({ id, canvas, line, onOpen })   "AI needs you on Uniformy-2027 — replace 4 team photos?" · Open
//   doneNotice({ id, text, onShow })               "Done — Post 1:1 is greener. The logo stays white." · Show
//
// The question is quoted, never the answer options; the toast stays until it is answered (no auto-dismiss
// timer shorter than the question lives — Needs you has no timeout, D7).

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
  const first = t.split(/(?<=[.!?])\s/)[0] ?? t;
  // The reply names its own result ("Done — Post 1:1 is greener…", rule `ai-describes-the-result`); the
  // toast quotes its first sentence and invents no "Done" of its own.
  return clip(first, 140);
}

export function doneNotice({ id, text, onShow }) {
  const line = doneLine(text);
  if (!line) return null;
  return { id, title: line, kind: 'success', action: { label: 'Show', onClick: onShow } };
}
