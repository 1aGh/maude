// Does a shell command run a `maude design <verb>` that WRITES to the project? (p8-t-video-3)
//
// A Maude chat's run opens its stage on the turn's first EDIT tool call (acp/index.ts `onUpdate`). An agent that
// edits through the shell — `maude design reel-place …`, `annotate`, `ds …` — reports kind `execute`, so without
// this the stage never opened: each write the verb made landed as its own "changed outside the app" action and
// the run published nothing (no "Made by AI", no one-step Undo). The verb table (actions/verbs.ts) is the one
// list of which verb writes: any effect other than `none` counts, the same rule the design plugin's own hook
// uses to bind a Bash write to its run (cli/lib/design-hook.mjs `writeVerbs`).

import { MAUDE_VERBS } from '../actions/verbs.ts';

const DESIGN_VERB_RE = /(?:^|[\s;&|(`])maude\s+design\s+([a-z][a-z0-9-]*)(?:\s+([a-z][a-z0-9-]*))?/g;

const DESIGN_EFFECT = new Map<string, string>(
  MAUDE_VERBS.filter((v) => v.scope === 'design').map((v) => [v.verb, v.effect])
);

/** True when `command` runs at least one `maude design` verb whose effect is not `none`. */
export function runsDesignWriteVerb(command: unknown): boolean {
  if (typeof command !== 'string' || !command.includes('maude')) return false;
  for (const m of command.matchAll(DESIGN_VERB_RE)) {
    const word = m[1] as string;
    const sub = m[2];
    // a two-word entry (`exports again`) is matched before its verb's own entry
    const effect = (sub && DESIGN_EFFECT.get(`${word} ${sub}`)) || DESIGN_EFFECT.get(word);
    if (effect !== undefined && effect !== 'none') return true;
  }
  return false;
}
