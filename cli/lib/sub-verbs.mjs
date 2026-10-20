// sub-verbs.mjs — `maude design <verb> <sub>` forms for verbs whose read-only steps are flags.
//
// The AI chat auto-allows a verb with a prefix rule (`Bash(maude design <verb>:*)`,
// apps/studio/actions/verbs.ts). A prefix rule can't name a step that is a flag AFTER a positional
// (`ds-upgrade <ds> --analyse`), and it can't see what follows it. So a read-only step gets a
// sub-verb (`ds-upgrade analyse <ds>`), the tier table auto-allows exactly that prefix, and this
// module turns it back into the helper's flag form — refusing any step flag after the sub-verb,
// so `ds-upgrade analyse x --apply p.json` can't ride the auto rule into a write.
//
// Lead answer (c), decision:maude/v2-2.4b-held-and-prompting-verbs. Leaf module: no imports.

/** A verb whose helper takes the sub-verb as its own first word (`history list`): nothing to map,
 *  the helper itself refuses any word or flag its sub-verb doesn't take. */
const NATIVE = Object.freeze({ native: true });

/** verb → sub-verb → { step: the flag it maps to, plan: whether a plan-file word follows the ds }
 *  — or NATIVE. */
export const SUB_VERBS = {
  'ds-upgrade': {
    analyse: { step: '--analyse', plan: false },
    plan: { step: '--plan-mechanical', plan: false },
    validate: { step: '--validate', plan: true },
  },
  // V2-2.4b (contract V2-1.11 §5.3). Each sub-verb has its own tier entry.
  history: {
    list: NATIVE,
    show: NATIVE,
    diff: NATIVE,
    object: NATIVE, // S1.16
    restore: NATIVE,
    undo: NATIVE,
    name: NATIVE,
  },
  // S9.7b — the write sub-verbs are prompt tier (verbs.ts `comments …` entries); only `list` is auto.
  comments: { list: NATIVE, reply: NATIVE, resolve: NATIVE, reopen: NATIVE, add: NATIVE },
  // S1.17 (S1-trash.md): `list` reads, `restore` brings one item back, `clear` is the owner's (human tier).
  trash: { list: NATIVE, restore: NATIVE, clear: NATIVE },
  exports: { list: NATIVE, again: NATIVE },
  // S5.4 (V2-1.15 §5.10): the AI runs — `list` reads, `stop` stops one of your own runs.
  runs: { list: NATIVE, stop: NATIVE },
  // S11.11: `status` reads; `resync` re-compares every file with the cloud copy (shared → prompt).
  sync: { status: NATIVE, resync: NATIVE },
  // S7.6c (V2-1.10 §5.7): a video's captions — `list` reads, `add` / `export` write in the project.
  captions: { add: NATIVE, list: NATIVE, export: NATIVE },
  // S10.3 (S10 §2.4): the design-system reads; the helper (ds/ds-verb.ts) refuses a write flag
  // after them. Every other `ds` sub-verb falls to the `ds` entry and prompts.
  // S10.19: `check-system` reads the system and keeps one runtime answer (_state/ds-check/<ds>.json).
  ds: { status: NATIVE, usage: NATIVE, revisions: NATIVE, 'check-system': NATIVE },
};

const STEP_FLAGS = {
  'ds-upgrade': [
    '--analyse',
    '--plan-mechanical',
    '--validate',
    '--stage',
    '--apply',
    // S10.15b: the proof, the discard and the cancel are steps as well
    '--prove',
    '--discard',
    '--cancel',
    '--status',
  ],
};

/** Flags that take a value (so the value isn't read as a positional). */
const VALUE_FLAGS = new Set(['--root']);

/**
 * `rest` = the words after the verb. Returns `{ args }` (what to hand the helper) or
 * `{ error }` (exit 2). Anything that isn't a sub-verb passes through unchanged.
 */
export function subVerbArgs(verb, rest) {
  const map = SUB_VERBS[verb];
  const sub = map && Object.hasOwn(map, rest[0] ?? '') ? map[rest[0]] : null;
  if (!sub || sub.native) return { args: rest };
  const name = rest[0];
  const steps = STEP_FLAGS[verb] ?? [];
  const positional = [];
  const flags = [];
  const words = rest.slice(1);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const bare = w.split('=')[0];
    if (steps.includes(bare)) {
      return {
        error: `maude design ${verb} ${name}: the sub-verb sets the step — drop ${bare} (use \`maude design ${verb} <ds> ${bare} …\` for another step)`,
      };
    }
    if (w.startsWith('--')) {
      flags.push(w);
      if (VALUE_FLAGS.has(w) && i + 1 < words.length) flags.push(words[++i]);
    } else positional.push(w);
  }
  const want = sub.plan ? 2 : 1;
  if (positional.length !== want) {
    return {
      error: `usage: maude design ${verb} ${name} <ds>${sub.plan ? ' <plan.json>' : ''} [--root <project>]`,
    };
  }
  const [ds, plan] = positional;
  return { args: sub.plan ? [ds, ...flags, sub.step, plan] : [ds, ...flags, sub.step] };
}
