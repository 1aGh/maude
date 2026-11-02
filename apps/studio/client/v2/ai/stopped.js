// stopped.js — S5.14: the pure half of the quit dialog and the "Stopped" divider + Keep going
// (V2-1.15 §5.8–§5.9, 03 `ai-quit`). No DOM, no fetch: every rule here is a unit test
// (test/v2-ai-quit.test.ts).

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "6 Oct, 18:12" — the divider's time (03 `ai-quit`), local time, 24 h. */
export function stoppedTime(ms) {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return '';
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${d.getDate()} ${MONTHS[d.getMonth()]}, ${hh}:${mm}`;
}

/** Which ended runs leave a divider with Keep going: stopped (any reason) or cut off by a crash. */
const CARRY_ON = new Set(['stopped', 'interrupted']);

/** The divider's words for a run (§5.8 "Stopped · <time>" / "Stopped when the app quit · <time>"). */
export function stoppedLine(run) {
  if (!run || !CARRY_ON.has(run.outcome)) return null;
  const by = run.outcome === 'interrupted' ? 'crash' : run.stoppedBy;
  const lead =
    by === 'quit'
      ? 'Stopped when the app quit'
      : by === 'close-tab'
        ? 'Stopped when the tab closed'
        : by === 'crash'
          ? 'Stopped when Maude quit unexpectedly'
          : by === 'sleep'
            ? 'Stopped while the Mac slept'
            : 'Stopped';
  const at = stoppedTime(run.endedAt ?? run.createdAt);
  return at ? `${lead} · ${at}` : lead;
}

/**
 * The run of `chatId` that shows the divider: the chat's LATEST run of yours, when it ended
 * stopped or interrupted. A newer run (Keep going's `resumeOf`, a new ask) or a live one
 * hides it — Keep going is offered once, never automatically (§5.4 item 12).
 */
export function stoppedRunFor(mine, chatId) {
  if (!chatId || !Array.isArray(mine)) return null;
  const ofChat = mine
    .filter((r) => r && r.chatId === chatId)
    .sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const last = ofChat[ofChat.length - 1];
  return last && last.state === 'ended' && CARRY_ON.has(last.outcome) ? last : null;
}

/** The dialog's words (03 `ai-quit`; the native fallback in quit.rs says the same). */
export function quitDialogText(chats) {
  const n = Number.isInteger(chats) && chats > 0 ? chats : 1;
  return {
    title: 'Quit while AI is working?',
    body: `${n === 1 ? '1 chat stops' : `${n} chats stop`} where they are. Everything AI finished so far is kept as a version, and each chat can carry on next time.`,
    primary: 'Quit',
    secondary: 'Cancel',
  };
}

/** A `quit://ask` payload the dialog accepts: `{nonce: int ≥ 1, chats: int ≥ 1}`, else null. */
export function parseQuitAsk(payload) {
  const nonce = payload?.nonce;
  const chats = payload?.chats;
  if (!Number.isSafeInteger(nonce) || nonce < 1) return null;
  if (!Number.isSafeInteger(chats) || chats < 1 || chats > 999) return null;
  return { nonce, chats };
}
