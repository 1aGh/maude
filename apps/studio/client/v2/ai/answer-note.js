// client/v2/ai/answer-note.js — S5.8 (03 AI Chat `ai-question`): a question's answer ends with
// "The canvas didn't change."
//
// The claim is only made when it is certain: the turn is finished and every tool it used is on the
// read-only list. Any other tool (Edit, Write, Bash, a design command, a name this file has never seen)
// means the turn may have changed something, so the note stays off — a missing note is safe, a wrong one
// is not.

export const CANVAS_UNCHANGED = "The canvas didn't change.";

/** Tools that cannot change a file. Claude Code's read-side set. A subagent (Task) can edit, so it is not here. */
const READ_ONLY_TOOLS = new Set([
  'Read',
  'Grep',
  'Glob',
  'LS',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'ToolSearch',
  'NotebookRead',
  'ExitPlanMode',
  'AskUserQuestion',
]);

/**
 * @param {Array<{type:string,toolName?:string,text?:string}>} parts — the assistant message's content
 * @param {boolean} complete — the turn has ended
 */
export function canvasUnchanged(parts, complete) {
  if (!complete || !Array.isArray(parts)) return false;
  let text = false;
  for (const p of parts) {
    if (p?.type === 'text' && String(p.text ?? '').trim()) text = true;
    else if (p?.type === 'tool-call' && !READ_ONLY_TOOLS.has(p.toolName)) return false;
  }
  return text;
}

/** Did the answer already say it (a model that wrote the sentence itself) — no second copy. */
export function alreadySaysUnchanged(parts) {
  const last = [...(parts || [])].reverse().find((p) => p?.type === 'text');
  return /canvas (didn['’]t|did not) change\.?\s*$/i.test(String(last?.text ?? ''));
}
