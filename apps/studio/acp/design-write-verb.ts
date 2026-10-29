// Does a shell command run a `maude design <verb>` that WRITES to the project? (p8-t-video-3)
//
// A Maude chat's run opens its stage on the turn's first EDIT tool call (acp/index.ts `onUpdate`). An agent that
// edits through the shell — `maude design reel-place …`, `annotate`, `ds …` — reports kind `execute`, so without
// this the stage never opened: each write the verb made landed as its own "changed outside the app" action and
// the run published nothing (no "Made by AI", no one-step Undo). The verb table (actions/verbs.ts) is the one
// list of which verb writes: any effect other than `none` counts, the same rule the design plugin's own hook
// uses to bind a Bash write to its run (cli/lib/design-hook.mjs `writeVerbs`).

//
// V2-8.9 round B A1 — the command is read with the SAME tokenizer as the bridge's writer check
// (acp/audience.ts `designCalls`): a verb only named in text (`echo maude design export`) opens nothing,
// one run through `bash -c`, `$(which maude)`, an absolute path or `maude-safe` does.

import { bashBackgrounds, bashMayWrite } from '../../../cli/lib/bash-guard.mjs';
import { MAUDE_VERBS } from '../actions/verbs.ts';
import { designCalls } from './audience.ts';

const DESIGN_EFFECT = new Map<string, string>(
  MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => [v.verb, v.effect])
);

/** True when `command` runs at least one `maude design` verb whose effect is not `none`. */
export function runsDesignWriteVerb(command: unknown): boolean {
  for (const words of designCalls(command)) {
    const word = words[0] as string;
    const sub = words[1];
    // a two-word entry (`exports again`) is matched before its verb's own entry
    const effect = (sub && DESIGN_EFFECT.get(`${word} ${sub}`)) || DESIGN_EFFECT.get(word);
    if (effect !== undefined && effect !== 'none') return true;
  }
  return false;
}

/**
 * p8-a1-claims — every `maude design` verb CLAIMS its own canvas writes before they land (ai/write-claim.ts:
 * a route write names its chat with X-Maude-Chat, a disk write posts its bytes to /_api/agent/write/claim),
 * so for this check every design verb reads as one that writes nothing unclaimed.
 */
export const CLAIMING_VERB_TABLE = MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => ({
  verb: `design ${v.verb}`,
  effect: 'none',
}));

/**
 * Does this shell call open the run's claim-only window — may it write something that cannot claim?
 *
 * Michal 2026-10-29 (A1): attribution by time window is no longer how an AI write is recognized. A call
 * whose only writers are `maude design` verbs opens NOTHING: each verb claims its own bytes, and a write
 * nobody claimed in those seconds is the person's (their outside save never joins the AI run or its Undo).
 *
 * The one named fallback — V2-8.16 S7 interpreter writes: a call that is not provably a read apart from
 * those verbs (`python3 - <<'EOF' … open(p,'w')`, `node -e`, `sed -i`, `bash -c "…"`) cannot claim, so it
 * keeps the per-call window (tool_call → completed, shut while its card waits). Only that call's seconds
 * are attributed by time; `bashMayWrite` (cli/lib/bash-guard.mjs) is the design hook's own reader.
 */
export function shellOpensWindow(command: unknown): boolean {
  return bashMayWrite(command, CLAIMING_VERB_TABLE);
}

/**
 * p8-secfix-hook (V2-8.9 final delta F2) — does the call leave a process writing after it returns?
 * A trailing `&`, `nohup`, `setsid`, `disown` … (`bashBackgrounds`) or Claude Code's
 * `run_in_background`. Its window then stays open until the turn ends, not the call's return +
 * SHELL_SETTLE_MS: `nohup python3 w.py &` returns at once and writes later.
 */
export function shellOutlivesCall(rawInput: unknown): boolean {
  const input = rawInput as { command?: unknown; run_in_background?: unknown } | null | undefined;
  if (!input || typeof input !== 'object') return false;
  return input.run_in_background === true || bashBackgrounds(input.command);
}
