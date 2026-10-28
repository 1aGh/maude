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

import { bashMayWrite } from '../../../cli/lib/bash-guard.mjs';
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

/** The design verbs in the hook manifest's shape (`design <verb>`), for `bashMayWrite`. */
const VERB_TABLE = MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => ({
  verb: `design ${v.verb}`,
  effect: v.effect,
}));

/**
 * V2-8.16 S7 — does this shell call open the run's claim-only window? A write verb does (above); so
 * does ANY call that is not provably a read (`bashMayWrite`, cli/lib/bash-guard.mjs — the design
 * hook's own reader): the agent cut a shot with `python3 - <<'EOF' … open(p,'w') … EOF`, which no
 * guard rule names, and the change landed outside the run. The window is the call's own (tool_call →
 * completed, shut while its card waits), so the A1 bound holds: only an outside-the-app save made
 * WHILE an AI call runs can fold into the run; a save in the Maude window is never stageable.
 */
export function shellOpensWindow(command: unknown): boolean {
  return runsDesignWriteVerb(command) || bashMayWrite(command, VERB_TABLE);
}
